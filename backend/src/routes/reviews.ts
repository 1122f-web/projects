import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth, requireRole } from '../middleware/auth.js';
import { check, checkMaybe, conflict, notFound } from '../lib/errors.js';
import { idParams, optionalText, parse, trimmed } from '../lib/validate.js';

export const reviewsRouter = Router();
reviewsRouter.use(requireAuth());

const REVIEW_SELECT = `id, appointment_id, patient_id, doctor_id, rating, comment, status, created_at, updated_at,
  doctor:doctor_profiles!reviews_doctor_id_fkey(id, title, profile:profiles!doctor_profiles_id_fkey(full_name, avatar_url)),
  appointment:appointments!reviews_appointment_id_fkey(starts_at)`;

/** GET /api/reviews/mine: reviews written by a patient, or received by a doctor. */
reviewsRouter.get('/mine', async (req, res) => {
  const { db, userId, role } = authOf(req);
  const rows = check(
    await db
      .from('reviews')
      .select(REVIEW_SELECT)
      .eq(role === 'doctor' ? 'doctor_id' : 'patient_id', userId)
      .order('created_at', { ascending: false })
      .limit(100),
  );
  res.json(rows);
});

const createSchema = z.object({
  appointment_id: z.uuid(),
  rating: z.number().int().min(1, 'Rating must be 1 to 5').max(5, 'Rating must be 1 to 5'),
  comment: optionalText(2000),
});

/** POST /api/reviews: patient reviews a completed appointment (once). */
reviewsRouter.post('/', requireRole('patient'), async (req, res) => {
  const { db, userId } = authOf(req);
  const body = parse(createSchema, req.body);
  const appointment = checkMaybe(
    await db.from('appointments').select('id, doctor_id, status, patient_id').eq('id', body.appointment_id).maybeSingle(),
  );
  if (!appointment || appointment.patient_id !== userId) throw notFound('Appointment not found');
  if (appointment.status !== 'completed') throw conflict('You can review an appointment after it is completed');

  const { data, error } = await db
    .from('reviews')
    .insert({
      appointment_id: appointment.id,
      patient_id: userId,
      doctor_id: appointment.doctor_id,
      rating: body.rating,
      comment: body.comment ?? null,
    })
    .select(REVIEW_SELECT)
    .single();
  if (error?.code === '23505') throw conflict('You have already reviewed this appointment');
  res.status(201).json(check({ data, error }));
});

const updateSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  comment: optionalText(2000).nullable(),
});

/** PATCH /api/reviews/:id: patient edits own review. */
reviewsRouter.patch('/:id', requireRole('patient'), async (req, res) => {
  const { db, userId } = authOf(req);
  const { id } = parse(idParams, req.params);
  const body = parse(updateSchema, req.body);
  const rows = check(await db.from('reviews').update(body).eq('id', id).eq('patient_id', userId).select(REVIEW_SELECT));
  if (rows.length === 0) throw notFound('Review not found');
  res.json(rows[0]);
});

const reportSchema = z.object({ reason: trimmed(3, 500, 'Reason') });

/** POST /api/reviews/:id/report: flag a review for moderation. */
reviewsRouter.post('/:id/report', async (req, res) => {
  const { db, userId } = authOf(req);
  const { id } = parse(idParams, req.params);
  const body = parse(reportSchema, req.body);
  const { error } = await db.from('review_reports').insert({ review_id: id, reporter_id: userId, reason: body.reason });
  if (error?.code === '23505') throw conflict('You have already reported this review');
  if (error?.code === '42501') throw notFound('Review not found');
  check({ data: null, error });
  res.status(201).json({ message: 'Thank you. An administrator will review this report.' });
});
