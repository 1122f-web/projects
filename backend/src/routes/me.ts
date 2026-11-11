import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth.js';
import { check, checkMaybe, notFound } from '../lib/errors.js';
import { parse, trimmed } from '../lib/validate.js';
import { IMAGE_TYPES, MB, objectPath, uploader, validateFile } from '../services/files.js';
import { uploadLimiter } from '../middleware/rateLimit.js';

export const meRouter = Router();

const PROFILE_COLUMNS =
  'id, role, account_status, permissions, can_send_messages, can_post_reviews, can_book_appointments, full_name, phone, date_of_birth, gender, avatar_url, timezone, email_notifications, created_at, updated_at';

/** GET /api/me: the signed-in user's profile (works for suspended accounts too). */
meRouter.get('/', requireAuth({ allowSuspended: true }), async (req, res) => {
  const auth = authOf(req);
  const profile = check(await auth.db.from('profiles').select(PROFILE_COLUMNS).eq('id', auth.userId).single());
  let doctor = null;
  if (auth.role === 'doctor') {
    doctor = checkMaybe(
      await auth.db
        .from('doctor_profiles')
        .select('verification_status, verified_at, is_accepting_patients')
        .eq('id', auth.userId)
        .maybeSingle(),
    );
  }
  res.json({ ...profile, email: auth.email, doctor });
});

const updateSchema = z
  .object({
    full_name: trimmed(2, 120, 'Full name').optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number')
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
    date_of_birth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
      .refine((v) => {
        const d = new Date(`${v}T00:00:00Z`);
        return !Number.isNaN(d.getTime()) && d <= new Date() && d.getUTCFullYear() > 1900;
      }, 'Enter a valid date of birth in the past')
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
    gender: z.enum(['female', 'male', 'other', 'prefer_not_to_say']).nullable().optional(),
    timezone: z
      .string()
      .max(64)
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'Unknown time zone')
      .optional(),
    email_notifications: z.boolean().optional(),
  })
  .strict();

/** PATCH /api/me: update own profile. Role and status are not accepted here. */
meRouter.patch('/', requireAuth(), async (req, res) => {
  const auth = authOf(req);
  const body = parse(updateSchema, req.body);
  const profile = check(
    await auth.db.from('profiles').update(body).eq('id', auth.userId).select(PROFILE_COLUMNS).single(),
  );
  res.json({ ...profile, email: auth.email });
});

const avatarUpload = uploader(2 * MB);

/** POST /api/me/avatar (multipart, field "avatar"): JPEG, PNG or WebP up to 2 MB. */
meRouter.post('/avatar', requireAuth(), uploadLimiter, avatarUpload.single('avatar'), async (req, res) => {
  const auth = authOf(req);
  const file = validateFile(req.file, IMAGE_TYPES, 2 * MB);
  const path = objectPath(auth.userId, file);
  const bucket = auth.db.storage.from('avatars');

  const { error } = await bucket.upload(path, file.buffer, { contentType: file.mime, upsert: false });
  if (error) throw Object.assign(new Error('avatar upload failed'), { cause: error });

  const current = check(await auth.db.from('profiles').select('avatar_url').eq('id', auth.userId).single());
  const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
  check(await auth.db.from('profiles').update({ avatar_url: publicUrl }).eq('id', auth.userId));

  const oldPath = current.avatar_url?.split('/avatars/')[1];
  if (oldPath?.startsWith(`${auth.userId}/`)) await bucket.remove([oldPath]);

  res.status(201).json({ avatar_url: publicUrl });
});

/** DELETE /api/me/avatar */
meRouter.delete('/avatar', requireAuth(), async (req, res) => {
  const auth = authOf(req);
  const current = check(await auth.db.from('profiles').select('avatar_url').eq('id', auth.userId).single());
  if (!current.avatar_url) throw notFound('No profile photo to remove');
  const oldPath = current.avatar_url.split('/avatars/')[1];
  if (oldPath?.startsWith(`${auth.userId}/`)) await auth.db.storage.from('avatars').remove([oldPath]);
  check(await auth.db.from('profiles').update({ avatar_url: null }).eq('id', auth.userId));
  res.status(204).end();
});
