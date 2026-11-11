// Loads backend/.env (local Supabase values) before any module reads the config.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(import.meta.dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
// Per-action limits are covered by their own test; the suite itself makes many requests.
process.env.DISABLE_RATE_LIMIT ??= 'true';
