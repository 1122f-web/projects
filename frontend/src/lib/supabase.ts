import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// Browser client with the PUBLIC key only. It is used for sign-in sessions and
// Realtime subscriptions; all data changes go through the backend API.
export const supabase = createClient(
  env.supabaseUrl ?? 'http://localhost:54321',
  env.supabaseAnonKey ?? 'missing-anon-key',
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    realtime: { params: { eventsPerSecond: 10 } },
  },
);
