import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth.js';
import { check } from '../lib/errors.js';
import { parse, uuid, optionalText } from '../lib/validate.js';
import { sendSMS } from '../services/sms.js';

export const prescriptionsRouter = Router();
prescriptionsRouter.use(requireAuth());

const listSchema = z.object({
  appointment_id: uuid.optional(),
});

/** GET /api/prescriptions?appointment_id=... */
prescriptionsRouter.get('/', async (req, res) => {
  const { db } = authOf(req);
  const q = parse(listSchema, req.query);

  let query = db.from('prescriptions').select('*');
  if (q.appointment_id) {
    query = query.eq('appointment_id', q.appointment_id);
  }

  const { data, error } = await query.order('issued_at', { ascending: false });
  check({ data, error });
  res.json(data);
});

const prescriptionSchema = z.object({
  appointment_id: uuid,
  doctor_id: uuid.optional(),
  patient_id: uuid.optional(),
  diagnosis: z.string().min(1, 'Diagnosis is required'),
  medicines: z.array(z.any()).default([]),
  notes: optionalText(2000),
});

/** POST /api/prescriptions: Save structured prescription record */
prescriptionsRouter.post('/', async (req, res) => {
  const { db, userId } = authOf(req);
  const body = parse(prescriptionSchema, req.body);

  const { data, error } = await db
    .from('prescriptions')
    .insert([
      {
        appointment_id: body.appointment_id,
        doctor_id: body.doctor_id || userId,
        patient_id: body.patient_id || null,
        diagnosis: body.diagnosis,
        medicines: body.medicines,
        notes: body.notes || null,
        issued_at: new Date().toISOString(),
      },
    ])
    .select()
    .single();

  check({ data, error });

  // --- Send SMS Notification ---
  if (body.patient_id) {
    const { data: patient } = await db
      .from('profiles')
      .select('phone, full_name')
      .eq('id', body.patient_id)
      .maybeSingle();

    if (patient?.phone) {
      sendSMS({
        to: patient.phone,
        message: `Hello ${patient.full_name}, your official prescription from your recent consultation is ready. Log in to your portal to view or download it.`,
      }).catch((err) => console.error('[SMS Error]', err));
    }
  }

  res.status(201).json(data);
});