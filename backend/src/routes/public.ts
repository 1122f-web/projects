import { Router } from 'express';
import { z } from 'zod';
import { anonClient } from '../lib/supabase.js';
import { check, notFound } from '../lib/errors.js';
import { idParams, isoDate, parse, trimmed } from '../lib/validate.js';
import { contactLimiter } from '../middleware/rateLimit.js';

export const publicRouter = Router();

/** GET /api/specialties: active specialties for filters and forms. */
publicRouter.get('/specialties', async (_req, res) => {
  const data = check(
    await anonClient.from('specialties').select('id, name, slug, description').eq('is_active', true).order('name'),
  );
  res.json(data);
});

const PUBLIC_SETTINGS = [
  'platform_name',
  'support_email',
  'currency',
  'cancellation_window_hours',
  'max_booking_days_ahead',
  'min_booking_notice_hours',
  'allow_registrations',
  'platform_service_fee',
  'doctor_verification_fee',
  'pro_plan_monthly_price',
  'featured_boost_weekly_price',
  'payment_instructions',
];

/** GET /api/settings/public: settings the interface needs. */
publicRouter.get('/settings/public', async (_req, res) => {
  const rows = check(await anonClient.from('system_settings').select('key, value').in('key', PUBLIC_SETTINGS));
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

const searchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  specialty: z.uuid().optional(),
  min_fee: z.coerce.number().min(0).max(1_000_000).optional(),
  max_fee: z.coerce.number().min(0).max(1_000_000).optional(),
  available_on: isoDate.optional(),
  type: z.enum(['online', 'in_person']).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radius_km: z.coerce.number().min(1).max(500).optional(),
  sort: z.enum(['rating', 'fee_asc', 'fee_desc', 'experience', 'name', 'distance']).default('rating'),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).superRefine((query, ctx) => {
  const hasCoordinates = query.lat !== undefined && query.lng !== undefined;
  if ((query.lat !== undefined) !== (query.lng !== undefined) || (query.radius_km !== undefined) !== hasCoordinates) {
    ctx.addIssue({
      code: 'custom',
      message: 'Latitude, longitude and radius must be provided together',
      path: ['radius_km'],
    });
  }
});

/** GET /api/doctors: search verified doctors. */
publicRouter.get('/doctors', async (req, res) => {
  const q = parse(searchSchema, req.query);
  const data = check(
    await anonClient.rpc('search_doctors_with_locations', {
      p_query: q.q ?? null,
      p_specialty_id: q.specialty ?? null,
      p_min_fee: q.min_fee ?? null,
      p_max_fee: q.max_fee ?? null,
      p_available_on: q.available_on ?? null,
      p_consultation_type: q.type ?? null,
      p_sort: q.sort,
      p_limit: q.limit,
      p_offset: q.offset,
      p_lat: q.lat ?? null,
      p_lng: q.lng ?? null,
      p_radius_km: q.radius_km ?? null,
    }),
  );
  res.json(data);
});

/** GET /api/doctors/:id: public doctor profile. */
publicRouter.get('/doctors/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const data = check(await anonClient.rpc('get_doctor_public', { p_doctor_id: id }));
  if (!data) throw notFound('Doctor not found');
  res.json(data);
});

const slotsSchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.to >= v.from, { message: '"to" must be on or after "from"', path: ['to'] });

/** GET /api/doctors/:id/slots?from=YYYY-MM-DD&to=YYYY-MM-DD (doctor-local dates, max 31 days). */
publicRouter.get('/doctors/:id/slots', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const q = parse(slotsSchema, req.query);
  const data = check(await anonClient.rpc('get_available_slots', { p_doctor_id: id, p_from: q.from, p_to: q.to }));
  res.json(data);
});

const contactSchema = z.object({
  name: trimmed(2, 120, 'Name'),
  email: z.email('Enter a valid email address').max(254),
  subject: trimmed(2, 150, 'Subject'),
  message: trimmed(10, 3000, 'Message'),
  // Honeypot: real users never fill this hidden field.
  website: z.string().max(0).optional(),
});

/** POST /api/contact: Contact Us form. */
publicRouter.post('/contact', contactLimiter, async (req, res) => {
  const body = parse(contactSchema, req.body);
  check(
    await anonClient
      .from('contact_messages')
      .insert({ name: body.name, email: body.email, subject: body.subject, message: body.message }),
  );
  res.status(201).json({ message: 'Thank you. Our team will reply by email.' });
});
