import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError, badRequest, check, checkMaybe, notFound } from '../lib/errors.js';
import { idParams, isoDateTime, optionalText, parse, trimmed } from '../lib/validate.js';
import { DOCUMENT_TYPES, MB, objectPath, uploader, validateFile } from '../services/files.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { logger } from '../lib/logger.js';

export const doctorRouter = Router();
doctorRouter.use(requireAuth(), requireRole('doctor'));

const DOCTOR_COLUMNS =
  'id, title, bio, qualifications, years_experience, languages, consultation_fee, clinic_name, clinic_address, city, latitude, longitude, offers_online, offers_in_person, slot_duration_minutes, is_accepting_patients, verification_status, verified_at, pro_until, featured_until, rating_avg, rating_count, created_at, updated_at';

/** GET /api/doctor/profile: own professional profile, specialties and latest verification request. */
doctorRouter.get('/profile', async (req, res) => {
  const { db, userId } = authOf(req);
  const profile = check(await db.from('doctor_profiles').select(DOCTOR_COLUMNS).eq('id', userId).single());
  const specialties = check(
    await db.from('doctor_specialties').select('specialty_id, is_primary, specialty:specialties(id, name)').eq('doctor_id', userId),
  );
  const latest = checkMaybe(
    await db
      .from('doctor_verification_requests')
      .select('id, status, admin_notes, created_at, reviewed_at')
      .eq('doctor_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  res.json({ ...profile, specialties, latest_verification: latest });
});

const SLOT_DURATIONS = [15, 20, 30, 45, 60, 90, 120];

const profileSchema = z
  .object({
    title: z.string().trim().max(20).optional(),
    bio: optionalText(3000).nullable(),
    qualifications: optionalText(2000).nullable(),
    years_experience: z.coerce.number().int().min(0).max(70).nullable().optional(),
    languages: z.array(z.string().trim().min(2).max(40)).min(1).max(10).optional(),
    consultation_fee: z.coerce.number().min(0).max(1_000_000).multipleOf(0.01).optional(),
    clinic_name: optionalText(150).nullable(),
    clinic_address: optionalText(300).nullable(),
    city: optionalText(100).nullable(),
    latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
    longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
    offers_online: z.boolean().optional(),
    offers_in_person: z.boolean().optional(),
    slot_duration_minutes: z
      .number()
      .int()
      .refine((v) => SLOT_DURATIONS.includes(v), 'Choose 15, 20, 30, 45, 60, 90 or 120 minutes')
      .optional(),
    is_accepting_patients: z.boolean().optional(),
  })
  .strict();

/** PATCH /api/doctor/profile */
doctorRouter.patch('/profile', async (req, res) => {
  const { db, userId } = authOf(req);
  const body = parse(profileSchema, req.body);
  if (body.offers_online === false && body.offers_in_person === false) {
    throw badRequest('Offer at least one consultation type');
  }
  const profile = check(await db.from('doctor_profiles').update(body).eq('id', userId).select(DOCTOR_COLUMNS).single());
  res.json(profile);
});

/** GET /api/doctor/nearby: Find nearby doctors based on geographic coordinates */
doctorRouter.get('/nearby', async (req, res) => {
  const { db } = authOf(req);
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const radiusKm = parseFloat(req.query.radius as string) || 30; // Default 30km radius

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required.' });
  }

  // Fetch verified doctors who have location coordinates set
  const { data: doctors, error } = await db
    .from('doctor_profiles')
    .select(DOCTOR_COLUMNS)
    .eq('verification_status', 'verified')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  // Haversine formula to calculate distance in kilometers on the server side
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
  };

  // Filter by radius and attach distance property
  const nearbyDoctors = (doctors || [])
    .map((doc) => ({
      ...doc,
      distance_km: calculateDistance(lat, lng, doc.latitude, doc.longitude),
    }))
    .filter((doc) => doc.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km);

  res.json(nearbyDoctors);
});

const specialtiesSchema = z.object({
  specialty_ids: z.array(z.uuid()).min(1, 'Choose at least one specialty').max(5, 'Choose at most 5 specialties'),
  primary_id: z.uuid().optional(),
});

/** PUT /api/doctor/specialties */
doctorRouter.put('/specialties', async (req, res) => {
  const { db } = authOf(req);
  const body = parse(specialtiesSchema, req.body);
  check(await db.rpc('set_doctor_specialties', { p_specialty_ids: body.specialty_ids, p_primary_id: body.primary_id ?? null }));
  res.status(204).end();
});

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const availabilitySchema = z.object({
  blocks: z
    .array(z.object({ day_of_week: z.number().int().min(0).max(6), start_time: time, end_time: time }))
    .max(50)
    .superRefine((blocks, ctx) => {
      blocks.forEach((b, i) => {
        if (b.end_time <= b.start_time) {
          ctx.addIssue({ code: 'custom', path: [i, 'end_time'], message: 'End time must be after start time' });
        }
      });
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
          const a = blocks[i]!;
          const b = blocks[j]!;
          if (a.day_of_week === b.day_of_week && a.start_time < b.end_time && b.start_time < a.end_time) {
            ctx.addIssue({ code: 'custom', path: [j, 'start_time'], message: 'Blocks on the same day overlap' });
          }
        }
      }
    }),
});

/** GET /api/doctor/availability: weekly schedule (times in the doctor's profile time zone). */
doctorRouter.get('/availability', async (req, res) => {
  const { db, userId } = authOf(req);
  const blocks = check(
    await db
      .from('doctor_availability')
      .select('id, day_of_week, start_time, end_time')
      .eq('doctor_id', userId)
      .order('day_of_week')
      .order('start_time'),
  );
  res.json(blocks.map((b) => ({ ...b, start_time: b.start_time.slice(0, 5), end_time: b.end_time.slice(0, 5) })));
});

/** PUT /api/doctor/availability: replace the weekly schedule atomically. */
doctorRouter.put('/availability', async (req, res) => {
  const { db } = authOf(req);
  const body = parse(availabilitySchema, req.body);
  check(await db.rpc('set_doctor_availability', { p_slots: body.blocks }));
  res.status(204).end();
});

/** GET /api/doctor/time-off: upcoming blocked periods. */
doctorRouter.get('/time-off', async (req, res) => {
  const { db, userId } = authOf(req);
  const rows = check(
    await db
      .from('doctor_time_off')
      .select('id, starts_at, ends_at, reason, created_at')
      .eq('doctor_id', userId)
      .gte('ends_at', new Date().toISOString())
      .order('starts_at'),
  );
  res.json(rows);
});

const timeOffSchema = z
  .object({ starts_at: isoDateTime, ends_at: isoDateTime, reason: optionalText(200) })
  .refine((v) => new Date(v.ends_at) > new Date(v.starts_at), { message: 'End must be after start', path: ['ends_at'] })
  .refine((v) => new Date(v.ends_at) > new Date(), { message: 'Time off must end in the future', path: ['ends_at'] });

/** POST /api/doctor/time-off */
doctorRouter.post('/time-off', async (req, res) => {
  const { db, userId } = authOf(req);
  const body = parse(timeOffSchema, req.body);
  const row = check(
    await db
      .from('doctor_time_off')
      .insert({ doctor_id: userId, starts_at: body.starts_at, ends_at: body.ends_at, reason: body.reason ?? null })
      .select('id, starts_at, ends_at, reason, created_at')
      .single(),
  );
  res.status(201).json(row);
});

/** DELETE /api/doctor/time-off/:id */
doctorRouter.delete('/time-off/:id', async (req, res) => {
  const { db } = authOf(req);
  const { id } = parse(idParams, req.params);
  const deleted = check(await db.from('doctor_time_off').delete().eq('id', id).select('id'));
  if (deleted.length === 0) throw notFound('Time off not found');
  res.status(204).end();
});

/** GET /api/doctor/verification: own verification requests. */
doctorRouter.get('/verification', async (req, res) => {
  const { db, userId } = authOf(req);
  const rows = check(
    await db
      .from('doctor_verification_requests')
      .select('id, license_number, issuing_authority, qualifications, document_paths, payment_reference, status, admin_notes, created_at, reviewed_at')
      .eq('doctor_id', userId)
      .order('created_at', { ascending: false }),
  );
  res.json(rows.map((r) => ({ ...r, document_count: r.document_paths.length, document_paths: undefined })));
});

const verificationSchema = z.object({
  license_number: trimmed(3, 64, 'License number'),
  issuing_authority: trimmed(2, 120, 'Issuing authority'),
  qualifications: trimmed(3, 2000, 'Qualifications'),
  payment_reference: optionalText(64),
});

const docsUpload = uploader(10 * MB, 5);

/**
 * POST /api/doctor/verification (multipart): fields license_number,
 * issuing_authority, qualifications, payment_reference (for the verification
 * fee) and 1-5 files in "documents" (PDF, JPEG or PNG, max 10 MB each).
 */
doctorRouter.post('/verification', uploadLimiter, docsUpload.array('documents', 5), async (req, res) => {
  const { db, userId } = authOf(req);
  const body = parse(verificationSchema, req.body);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) throw badRequest('Attach at least one supporting document (license or certificate)');
  const validated = files.map((f) => validateFile(f, DOCUMENT_TYPES, 10 * MB));

  const bucket = db.storage.from('verification-documents');
  const uploaded: string[] = [];
  try {
    for (const file of validated) {
      const path = objectPath(userId, file);
      const { error } = await bucket.upload(path, file.buffer, { contentType: file.mime });
      if (error) throw new HttpError(400, 'A document could not be uploaded. Please try again.', 'upload_failed');
      uploaded.push(path);
    }
    const row = check(
      await db
        .from('doctor_verification_requests')
        .insert({ doctor_id: userId, ...body, document_paths: uploaded })
        .select('id, status, created_at')
        .single(),
    );
    res.status(201).json(row);
  } catch (err) {
    if (uploaded.length) {
      const { error } = await bucket.remove(uploaded);
      if (error) logger.warn({ err: error }, 'failed to clean up verification uploads');
    }
    throw err;
  }
});