import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  SUPABASE_URL: z.url(),
  // Public key: legacy "anon" JWT or new "sb_publishable_..." key.
  SUPABASE_ANON_KEY: z.string().min(20),
  // Secret key: legacy "service_role" JWT or new "sb_secret_..." key. Server only.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  APP_URL: z.url().optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ENABLE_WORKER: bool,
  CRON_SECRET: z.string().min(24).optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('MediConnect <no-reply@example.com>'),
  DISABLE_RATE_LIMIT: bool,
  // Daily (https://daily.co) secret API key for video consultations. Server only.
  DAILY_API_KEY: z.string().min(20).optional(),
  DAILY_API_URL: z.url().default('https://api.daily.co/v1'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsed.data;
const allowedOrigins = env.FRONTEND_URL.split(',').map((o) => o.trim()).filter(Boolean);

export const config = {
  ...env,
  allowedOrigins,
  appUrl: env.APP_URL ?? allowedOrigins[0] ?? 'http://localhost:5173',
  emailEnabled: Boolean(env.SMTP_HOST),
  videoEnabled: Boolean(env.DAILY_API_KEY),
  rateLimitEnabled: !env.DISABLE_RATE_LIMIT || env.NODE_ENV === 'production',
};

export type AppConfig = typeof config;
