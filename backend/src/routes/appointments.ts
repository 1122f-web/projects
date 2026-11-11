import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError, check, checkMaybe, conflict, notFound } from '../lib/errors.js';
import { serviceClient } from '../lib/supabase.js';
import { config } from '../config.js';
import { createMeetingToken, ensureRoom } from '../services/video.js';
import { idParams, isoDateTime, optionalText, parse, trimmed } from '../lib/validate.js';
import { bookingLimiter } from '../middleware/rateLimit.js';
import { sendSMS } from '../services/sms.js';

export const appointmentsRouter = Router();
appointmentsRouter.use(requireAuth());

export const APPOINTMENT_SELECT = `id, patient_id, doctor_id, starts_at, ends_at, consultation_type, reason, status, fee, service_fee,
  doctor_notes, status_note, cancelled_by, rescheduled_by, previous_starts_at, created_at, updated_at,
  patient:profiles!appointments_patient_id_fkey(id, full_name, avatar_url, timezone, phone),
  doctor:doctor_profiles!appointments_doctor_id_fkey(id, title, clinic_name, clinic_address, city,
    profile:profiles!doctor_profiles_id_fkey(full_name, avatar_url, timezone, phone)),
  review:reviews(id, rating, comment, status, created_at)`;

function firstRelation<T>(relation: T | T[] | null): T | null {
  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

const ACTIVE = ['pending', 'confirmed', 'rescheduled'];

const bookSchema = z.object({
  doctor_id: z.uuid(),
  starts_at: isoDateTime,
  consultation_type: z.enum(['online', 'in_person']),
  reason: trimmed(3, 1000, 'Reason for visit'),
});

/** POST /api/appointments: patient books a slot. Double-booking is rejected by the database. */
appointmentsRouter.post('/', requireRole('patient'), bookingLimiter, async (req, res) => {
  const { db } = authOf(req);
  const body = parse(bookSchema, req.body);
  const id = check(
    await db.rpc('book_appointment', {
      p_doctor_id: body.doctor_id,
      p_starts_at: body.starts_at,
      p_consultation_type: body.consultation_type,
      p_reason: body.reason,
    }),
  );
  
  const appointment = check(await db.from('appointments').select(APPOINTMENT_SELECT).eq('id', id).single());

  if (appointment) {
    const patient = firstRelation(appointment.patient);
    const doctor = firstRelation(appointment.doctor);
    const doctorProfile = firstRelation(doctor?.profile ?? null);
    const patientPhone = patient?.phone;
    const patientName = patient?.full_name || 'Patient';
    const doctorPhone = doctorProfile?.phone;
    const doctorName = `${doctor?.title ?? 'Dr.'} ${doctorProfile?.full_name ?? ''}`.trim();
    const formattedTime = new Date(appointment.starts_at).toLocaleString();

    // 1. Send SMS to Patient
    if (patientPhone) {
      sendSMS({
        to: patientPhone,
        message: `Hello ${patientName}, your appointment with ${doctorName} has been booked for ${formattedTime}.`,
      }).catch((err) => console.error('[SMS Error - Patient]', err));
    }

    // 2. Send SMS to Doctor
    if (doctorPhone) {
      sendSMS({
        to: doctorPhone,
        message: `Hello ${doctorName}, you have a new appointment booking with patient ${patientName} on ${formattedTime}.`,
      }).catch((err) => console.error('[SMS Error - Doctor]', err));
    }
  }

  res.status(201).json(appointment);
});

const listSchema = z.object({
  scope: z.enum(['upcoming', 'past', 'all']).default('all'),
  status: z.enum(['pending', 'confirmed', 'rejected', 'cancelled', 'completed', 'rescheduled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/appointments: the caller's appointments (as patient or as doctor). */
appointmentsRouter.get('/', async (req, res) => {
  const { db, userId, role } = authOf(req);
  const q = parse(listSchema, req.query);
  const now = new Date().toISOString();

  let query = db
    .from('appointments')
    .select(APPOINTMENT_SELECT, { count: 'exact' })
    .eq(role === 'doctor' ? 'doctor_id' : 'patient_id', userId);

  if (q.scope === 'upcoming') {
    query = query.gte('starts_at', now).in('status', ACTIVE).order('starts_at', { ascending: true });
  } else if (q.scope === 'past') {
    query = query.or(`starts_at.lt.${now},status.in.(rejected,cancelled,completed)`).order('starts_at', { ascending: false });
  } else {
    query = query.order('starts_at', { ascending: false });
  }
  if (q.status) query = query.eq('status', q.status);

  const { data, error, count } = await query.range(q.offset, q.offset + q.limit - 1);
  check({ data, error });
  res.json({ total: count ?? 0, items: data });
});

/** GET /api/appointments/:id: details, plus the patient information the doctor needs. */
appointmentsRouter.get('/:id', async (req, res) => {
  const { db, userId } = authOf(req);
  const { id } = parse(idParams, req.params);
  const appointment = checkMaybe(await db.from('appointments').select(APPOINTMENT_SELECT).eq('id', id).maybeSingle());
  if (!appointment) throw notFound('Appointment not found');

  let patientDetails = null;
  if (appointment.doctor_id === userId) {
    patientDetails = checkMaybe(
      await db.from('profiles').select('phone, date_of_birth, gender').eq('id', appointment.patient_id).maybeSingle(),
    );
  }
  const conversation = checkMaybe(
    await db
      .from('conversations')
      .select('id')
      .eq('patient_id', appointment.patient_id)
      .eq('doctor_id', appointment.doctor_id)
      .maybeSingle(),
  );
  res.json({ ...appointment, patient_details: patientDetails, conversation_id: conversation?.id ?? null });
});

const JOIN_OPENS_MINUTES = 15;
const JOIN_CLOSES_MINUTES = 30;
const ROOM_EXPIRES_MINUTES = 60;
const minutesFrom = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000);

/** POST /api/appointments/:id/video */
appointmentsRouter.post('/:id/video', async (req, res) => {
  const { db, userId } = authOf(req);
  const { id } = parse(idParams, req.params);
  if (!config.videoEnabled) throw new HttpError(503, 'Video calls are not set up on this platform yet.', 'video_disabled');

  const appointment = checkMaybe(await db.from('appointments').select(APPOINTMENT_SELECT).eq('id', id).maybeSingle());
  if (!appointment || (appointment.patient_id !== userId && appointment.doctor_id !== userId)) throw notFound('Appointment not found');
  if (appointment.consultation_type !== 'online') throw conflict('This is an in-person appointment.');
  if (appointment.status !== 'confirmed') throw conflict('Video calls are available once the appointment is confirmed.');
  const now = new Date();
  if (now < minutesFrom(appointment.starts_at, -JOIN_OPENS_MINUTES)) {
    throw conflict(`The call opens ${JOIN_OPENS_MINUTES} minutes before the appointment starts.`);
  }
  if (now > minutesFrom(appointment.ends_at, JOIN_CLOSES_MINUTES)) throw conflict('This appointment has ended.');

  const expiresAt = minutesFrom(appointment.ends_at, ROOM_EXPIRES_MINUTES);
  const room = await ensureRoom(`mediconnect-${appointment.id}`, expiresAt);
  check(
    await serviceClient
      .from('video_sessions')
      .upsert({ appointment_id: appointment.id, room_name: room.name, room_url: room.url, expires_at: expiresAt.toISOString() })
      .select('appointment_id')
      .single(),
  );

  const isDoctor = appointment.doctor_id === userId;
  const doctor = firstRelation(appointment.doctor);
  const doctorProfile = firstRelation(doctor?.profile ?? null);
  const patient = firstRelation(appointment.patient);
  const userName = isDoctor ? `${doctor?.title ?? 'Dr.'} ${doctorProfile?.full_name ?? ''}`.trim() : (patient?.full_name ?? 'Patient');
  const token = await createMeetingToken({ roomName: room.name, userId, userName, isOwner: isDoctor, expiresAt });
  res.json({ room_url: room.url, token, expires_at: expiresAt.toISOString() });
});

const statusSchema = z.object({
  status: z.enum(['confirmed', 'rejected', 'cancelled', 'completed']),
  note: optionalText(500),
});

/** POST /api/appointments/:id/status */
appointmentsRouter.post('/:id/status', async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  const body = parse(statusSchema, req.body);
  
  check(await db.rpc('update_appointment_status', { p_appointment_id: id, p_status: body.status, p_note: body.note ?? null }));
  const appointment = check(await db.from('appointments').select(APPOINTMENT_SELECT).eq('id', id).single());

  if (appointment) {
    const patient = firstRelation(appointment.patient);
    const doctor = firstRelation(appointment.doctor);
    const doctorProfile = firstRelation(doctor?.profile ?? null);
    const patientPhone = patient?.phone;
    const patientName = patient?.full_name || 'Patient';
    const doctorPhone = doctorProfile?.phone;
    const doctorName = `${doctor?.title ?? 'Dr.'} ${doctorProfile?.full_name ?? ''}`.trim();
    const formattedTime = new Date(appointment.starts_at).toLocaleString();

    // 1. Notify Patient on Status Change
    if (patientPhone) {
      let patientMsg = `Hello ${patientName}, your appointment status is now: ${body.status}.`;
      if (body.status === 'confirmed') {
        patientMsg = `Hello ${patientName}, your appointment with ${doctorName} on ${formattedTime} is CONFIRMED.`;
      } else if (body.status === 'cancelled') {
        patientMsg = `Hello ${patientName}, your appointment on ${formattedTime} has been CANCELLED.`;
      }

      sendSMS({
        to: patientPhone,
        message: patientMsg,
      }).catch((err) => console.error('[SMS Error - Patient]', err));
    }

    // 2. Notify Doctor on Status Change
    if (doctorPhone) {
      const doctorMsg = `Hello ${doctorName}, appointment with ${patientName} on ${formattedTime} status updated to: ${body.status}.`;
      
      sendSMS({
        to: doctorPhone,
        message: doctorMsg,
      }).catch((err) => console.error('[SMS Error - Doctor]', err));
    }
  }

  res.json(appointment);
});

const rescheduleSchema = z.object({ starts_at: isoDateTime, note: optionalText(500) });

/** POST /api/appointments/:id/reschedule */
appointmentsRouter.post('/:id/reschedule', bookingLimiter, async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  const body = parse(rescheduleSchema, req.body);
  check(
    await db.rpc('reschedule_appointment', { p_appointment_id: id, p_new_starts_at: body.starts_at, p_note: body.note ?? null }),
  );
  const appointment = check(await db.from('appointments').select(APPOINTMENT_SELECT).eq('id', id).single());
  res.json(appointment);
});

const notesSchema = z.object({ notes: z.string().max(4000, 'Notes must be at most 4000 characters').nullable() });

/** PUT /api/appointments/:id/notes */
appointmentsRouter.put('/:id/notes', requireRole('doctor'), async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  const body = parse(notesSchema, req.body);
  check(await db.rpc('set_appointment_notes', { p_appointment_id: id, p_notes: body.notes }));
  res.status(204).end();
});