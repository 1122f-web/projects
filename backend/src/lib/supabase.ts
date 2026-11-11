import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const baseOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

/** Anonymous client: public reads and sign-up. Subject to RLS as `anon`. */
export const anonClient: SupabaseClient = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, baseOptions);

/**
 * Client acting as the signed-in user. Every query runs under that user's
 * identity, so Row Level Security applies exactly as it would in the browser.
 */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    ...baseOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Service-role client. Bypasses RLS, so it is used only for tasks that have no
 * user context or need Auth admin APIs: verifying tokens, the email outbox,
 * scheduled jobs, account bans and the make-admin script.
 */
export const serviceClient: SupabaseClient = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
  baseOptions,
);
