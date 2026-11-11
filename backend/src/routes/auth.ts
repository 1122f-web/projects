import { Router } from 'express';
import { z } from 'zod';
import { anonClient } from '../lib/supabase.js';
import { HttpError, forbidden } from '../lib/errors.js';
import { parse, trimmed } from '../lib/validate.js';
import { registerLimiter } from '../middleware/rateLimit.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[a-z]/, 'Password needs a lowercase letter')
  .regex(/[A-Z]/, 'Password needs an uppercase letter')
  .regex(/[0-9]/, 'Password needs a number');

const registerSchema = z.object({
  email: z.email('Enter a valid email address').max(254).transform((v) => v.toLowerCase()),
  password: passwordSchema,
  full_name: trimmed(2, 120, 'Full name'),
  role: z.enum(['patient', 'doctor']).default('patient'),
  timezone: z.string().max(64).optional(),
  accept_terms: z.literal(true, { error: 'You must accept the terms and privacy policy' }),
});

export const authRouter = Router();

/**
 * POST /api/auth/register
 * Creates a Supabase Auth user. The database trigger creates the profile and
 * ignores any attempt to request the admin role.
 */
authRouter.post('/register', registerLimiter, async (req, res) => {
  const body = parse(registerSchema, req.body);

  const { data: setting } = await anonClient
    .from('system_settings')
    .select('value')
    .eq('key', 'allow_registrations')
    .maybeSingle();
  if (setting && setting.value === false) throw forbidden('New registrations are currently closed');

  const { data, error } = await anonClient.auth.signUp({
    email: body.email,
    password: body.password,
    options: {
      data: { full_name: body.full_name, requested_role: body.role, timezone: body.timezone ?? 'UTC' },
      emailRedirectTo: `${config.appUrl}/login?confirmed=1`,
    },
  });

  if (error) {
    logger.info({ code: error.code, status: error.status }, 'sign-up rejected');
    if (error.code === 'user_already_exists' || /already registered/i.test(error.message)) {
      throw new HttpError(409, 'An account with this email already exists. Sign in or reset your password.', 'conflict');
    }
    if (error.code === 'weak_password') {
      throw new HttpError(400, 'Please choose a stronger password', 'bad_request');
    }
    if (error.status === 429) {
      throw new HttpError(429, 'Too many attempts. Please try again later.', 'rate_limited');
    }
    throw new HttpError(400, 'We could not create your account. Please check your details and try again.', 'bad_request');
  }

  res.status(201).json({
    user_id: data.user?.id ?? null,
    role: body.role,
    requires_email_confirmation: !data.session,
    message: data.session
      ? 'Account created. You can sign in now.'
      : 'Account created. Check your email to confirm your address, then sign in.',
  });
});
