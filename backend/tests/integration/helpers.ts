// Shared helpers for integration tests. They run against the LOCAL Supabase
// stack (`npm run db:start`) and create throwaway, fictional accounts.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll as vitestAfterAll, beforeAll as vitestBeforeAll, describe as vitestDescribe, it as vitestIt } from 'vitest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { serviceClient } from '../../src/lib/supabase.js';

export const integrationEnabled = /127\.0\.0\.1|localhost/.test(config.SUPABASE_URL);

export const describe = integrationEnabled ? vitestDescribe : vitestDescribe.skip;
export const it = integrationEnabled ? vitestIt : vitestIt.skip;
export const beforeAll = integrationEnabled ? vitestBeforeAll : (() => undefined);
export const afterAll = integrationEnabled ? vitestAfterAll : (() => undefined);

if (!integrationEnabled) {
  console.warn('Skipping integration tests: SUPABASE_URL is not a local stack (expected localhost or 127.0.0.1).');
}

export const app = createApp();
export const api = () => request(app);
export const PASSWORD = 'TestPass123';
export { serviceClient };

export interface TestUser {
  id: string;
  email: string;
  token: string;
  db: SupabaseClient;
}

const created: string[] = [];

/** A Supabase client acting as the given user, straight against PostgREST (bypassing our API). */
export function directClient(token?: string): SupabaseClient {
  return createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });
}

export async function signIn(email: string, password = PASSWORD): Promise<string> {
  const client = directClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign in failed for ${email}: ${error?.message}`);
  return data.session.access_token;
}

export async function createUser(
  role: 'patient' | 'doctor' = 'patient',
  extra: Record<string, unknown> = {},
): Promise<TestUser> {
  const email = `t-${randomUUID().slice(0, 8)}@test.mediconnect.test`;
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { provisioned: true },
    user_metadata: { full_name: `Test ${role} ${email.slice(2, 6)}`, requested_role: role, timezone: 'Africa/Nairobi', ...extra },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  created.push(data.user.id);
  const token = await signIn(email);
  return { id: data.user.id, email, token, db: directClient(token) };
}

/** A verified doctor available every day 08:00 to 18:00 (Africa/Nairobi), 30-minute slots. */
export async function createVerifiedDoctor(): Promise<TestUser> {
  const doctor = await createUser('doctor');
  const { error } = await serviceClient
    .from('doctor_profiles')
    .update({ verification_status: 'verified', verified_at: new Date().toISOString(), consultation_fee: 1000, offers_online: true, offers_in_person: true })
    .eq('id', doctor.id);
  if (error) throw error;
  const blocks = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day_of_week: day, start_time: '08:00', end_time: '18:00' }));
  const res = await doctor.db.rpc('set_doctor_availability', { p_slots: blocks });
  if (res.error) throw res.error;
  return doctor;
}

export async function createAdmin(): Promise<TestUser> {
  const user = await createUser('patient');
  const { error } = await serviceClient.rpc('grant_admin_by_email', { p_email: user.email });
  if (error) throw error;
  // Role lives in the profile, so the existing token stays valid.
  return user;
}

/** Free slots for a doctor, starting `daysAhead` days from today (doctor-local dates). */
export async function slots(doctorId: string, daysAhead = 3, span = 1): Promise<{ starts_at: string; ends_at: string }[]> {
  const from = new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + (daysAhead + span - 1) * 86_400_000).toISOString().slice(0, 10);
  const res = await api().get(`/api/doctors/${doctorId}/slots`).query({ from, to });
  if (res.status !== 200) throw new Error(`slots ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

export function book(patient: TestUser, doctorId: string, startsAt: string) {
  return api()
    .post('/api/appointments')
    .set('Authorization', `Bearer ${patient.token}`)
    .send({ doctor_id: doctorId, starts_at: startsAt, consultation_type: 'online', reason: 'Fictional test visit' });
}

export const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

/** Deletes every account created by this test file. */
export async function cleanup(): Promise<void> {
  // Appointments reference profiles; remove them first so auth users can be deleted.
  if (created.length) {
    await serviceClient.from('appointments').delete().in('patient_id', created);
    await serviceClient.from('appointments').delete().in('doctor_id', created);
  }
  for (const id of created.splice(0)) await serviceClient.auth.admin.deleteUser(id);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
