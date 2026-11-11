// Role assignment, privilege escalation attempts and Row Level Security,
// tested both through the API and directly against Supabase with a user's token.
import { expect } from 'vitest';
import { afterAll, api, auth, beforeAll, book, cleanup, createAdmin, createUser, createVerifiedDoctor, describe, directClient, it, serviceClient, signIn, slots, type TestUser } from './helpers.js';

let patient: TestUser;
let other: TestUser;
let doctor: TestUser;
let admin: TestUser;
let appointmentId: string;

beforeAll(async () => {
  [patient, other, doctor, admin] = await Promise.all([createUser(), createUser(), createVerifiedDoctor(), createAdmin()]);
  const [slot] = await slots(doctor.id, 4);
  const res = await book(patient, doctor.id, slot!.starts_at);
  expect(res.status).toBe(201);
  appointmentId = res.body.id;
});
afterAll(cleanup);

describe('registration', () => {
  it('creates a patient and lets them sign in', async () => {
    const email = `t-reg-${Date.now()}@test.mediconnect.test`;
    const res = await api().post('/api/auth/register').send({ email, password: 'GoodPass123', full_name: 'Reg Test', accept_terms: true });
    expect(res.status).toBe(201);
    const { data } = await serviceClient.from('profiles').select('role').eq('id', res.body.user_id).single();
    expect(data!.role).toBe('patient');
    const u = await serviceClient.auth.admin.listUsers({ perPage: 1000 });
    const created = u.data.users.find((x) => x.email === email);
    expect(created).toBeDefined();
    await serviceClient.auth.admin.deleteUser(created!.id);
  });

  it('refuses the admin role, weak passwords and missing consent', async () => {
    const base = { email: `t-x-${Date.now()}@test.mediconnect.test`, password: 'GoodPass123', full_name: 'X Test', accept_terms: true };
    expect((await api().post('/api/auth/register').send({ ...base, role: 'admin' })).status).toBe(400);
    expect((await api().post('/api/auth/register').send({ ...base, password: 'weakpass' })).status).toBe(400);
    expect((await api().post('/api/auth/register').send({ ...base, accept_terms: false })).status).toBe(400);
  });

  it('honours "registrations closed" for the API and for direct Supabase sign-ups', async () => {
    const close = await api().put('/api/admin/settings/allow_registrations').set(auth(admin)).send({ value: false });
    expect(close.status).toBe(200);
    try {
      const email = `t-closed-${Date.now()}@test.mediconnect.test`;
      const viaApi = await api().post('/api/auth/register').send({ email, password: 'GoodPass123', full_name: 'Closed Test', accept_terms: true });
      expect(viaApi.status).toBe(403);
      const direct = await directClient().auth.signUp({ email, password: 'GoodPass123' });
      expect(direct.error).not.toBeNull();
      const users = await serviceClient.auth.admin.listUsers({ perPage: 1000 });
      expect(users.data.users.some((u) => u.email === email)).toBe(false);
    } finally {
      expect((await api().put('/api/admin/settings/allow_registrations').set(auth(admin)).send({ value: true })).status).toBe(200);
    }
  });

  it('never grants admin from sign-up metadata, even via Supabase directly', async () => {
    const sneaky = await createUser('admin' as never);
    const { data } = await serviceClient.from('profiles').select('role').eq('id', sneaky.id).single();
    expect(data!.role).toBe('patient');
  });
});

describe('authentication and role guards', () => {
  it('rejects missing and forged tokens', async () => {
    expect((await api().get('/api/me')).status).toBe(401);
    expect((await api().get('/api/me').set('Authorization', 'Bearer not.a.jwt')).status).toBe(401);
  });

  it('keeps non-admins out of admin endpoints', async () => {
    for (const u of [patient, doctor]) {
      expect((await api().get('/api/admin/stats').set(auth(u))).status).toBe(403);
      expect((await api().post(`/api/admin/users/${u.id}/role`).set(auth(u)).send({ role: 'admin' })).status).toBe(403);
    }
    expect((await api().get('/api/admin/stats').set(auth(admin))).status).toBe(200);
  });

  it('keeps patients out of doctor endpoints and vice versa', async () => {
    expect((await api().get('/api/doctor/profile').set(auth(patient))).status).toBe(403);
    expect((await book(doctor, doctor.id, new Date().toISOString())).status).toBe(403);
  });
});

describe('privilege escalation attempts', () => {
  it('rejects role or status fields in PATCH /api/me', async () => {
    const res = await api().patch('/api/me').set(auth(patient)).send({ role: 'admin' });
    expect(res.status).toBe(400);
    expect((await api().patch('/api/me').set(auth(patient)).send({ account_status: 'active' })).status).toBe(400);
  });

  it('blocks a direct profile update of role through Supabase', async () => {
    const res = await patient.db.from('profiles').update({ role: 'admin' }).eq('id', patient.id).select();
    expect(res.error).not.toBeNull();
    const { data } = await serviceClient.from('profiles').select('role').eq('id', patient.id).single();
    expect(data!.role).toBe('patient');
  });

  it('blocks a doctor verifying themselves or faking their rating', async () => {
    const fresh = await createUser('doctor');
    const a = await fresh.db.from('doctor_profiles').update({ verification_status: 'verified' }).eq('id', fresh.id).select();
    const b = await fresh.db.from('doctor_profiles').update({ rating_avg: 5, rating_count: 999 }).eq('id', fresh.id).select();
    expect(a.error).not.toBeNull();
    expect(b.error).not.toBeNull();
    const { data } = await serviceClient.from('doctor_profiles').select('verification_status, rating_count').eq('id', fresh.id).single();
    expect(data).toMatchObject({ verification_status: 'unverified', rating_count: 0 });
  });

  it('denies admin and service-only functions to normal users', async () => {
    expect((await patient.db.rpc('grant_admin_by_email', { p_email: patient.email })).error).not.toBeNull();
    expect((await patient.db.rpc('admin_set_user_role', { p_user_id: patient.id, p_role: 'admin' })).error).not.toBeNull();
    expect((await patient.db.rpc('run_scheduled_jobs')).error).not.toBeNull();
    expect((await patient.db.rpc('claim_pending_emails', { p_limit: 10 })).error).not.toBeNull();
    const { data } = await serviceClient.from('profiles').select('role').eq('id', patient.id).single();
    expect(data!.role).toBe('patient');
  });

  it('stops an admin from removing their own admin role', async () => {
    const res = await api().post(`/api/admin/users/${admin.id}/role`).set(auth(admin)).send({ role: 'patient' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('Row Level Security on direct access', () => {
  it('gives the anonymous key no access to private tables', async () => {
    const anon = directClient();
    for (const table of ['appointments', 'messages', 'notifications', 'conversations', 'audit_logs', 'doctor_verification_requests', 'contact_messages']) {
      const { data } = await anon.from(table).select('*').limit(5);
      expect(data ?? [], table).toHaveLength(0);
    }
  });

  it('only shows an appointment to its own patient and doctor', async () => {
    expect((await patient.db.from('appointments').select('id').eq('id', appointmentId)).data).toHaveLength(1);
    expect((await doctor.db.from('appointments').select('id').eq('id', appointmentId)).data).toHaveLength(1);
    expect((await other.db.from('appointments').select('id').eq('id', appointmentId)).data).toHaveLength(0);
    expect((await api().get(`/api/appointments/${appointmentId}`).set(auth(other))).status).toBe(404);
  });

  it('does not let users read other people\'s profiles, notifications or the audit log', async () => {
    expect((await other.db.from('profiles').select('id, phone').eq('id', patient.id)).data).toHaveLength(0);
    expect((await other.db.from('notifications').select('id').eq('user_id', doctor.id)).data).toHaveLength(0);
    expect((await patient.db.from('audit_logs').select('id')).data).toHaveLength(0);
  });

  it('blocks forging appointments and notifications directly', async () => {
    const [slot] = await slots(doctor.id, 5);
    const forged = await other.db.from('appointments').insert({
      patient_id: other.id, doctor_id: doctor.id, starts_at: slot!.starts_at, ends_at: slot!.ends_at, status: 'confirmed', consultation_type: 'online', reason: 'forged',
    });
    expect(forged.error).not.toBeNull();
    const note = await other.db.from('notifications').insert({ user_id: patient.id, type: 'system', title: 'Phish', body: 'Click here' });
    expect(note.error).not.toBeNull();
  });

  it('blocks status changes that skip the business rules', async () => {
    const res = await patient.db.from('appointments').update({ status: 'confirmed' }).eq('id', appointmentId).select();
    expect(res.error !== null || (res.data ?? []).length === 0).toBe(true);
    const { data } = await serviceClient.from('appointments').select('status').eq('id', appointmentId).single();
    expect(data!.status).toBe('pending');
  });
});

describe('account suspension', () => {
  it('locks a suspended user out of the API and lets them back after reactivation', async () => {
    const target = await createUser();
    const s = await api().post(`/api/admin/users/${target.id}/status`).set(auth(admin)).send({ status: 'suspended', reason: 'Fictional test' });
    expect(s.status).toBe(200);
    // The Auth ban invalidates the session (401); the profile check backs it up (403).
    expect([401, 403]).toContain((await api().get('/api/notifications').set(auth(target))).status);
    await expect(signIn(target.email)).rejects.toThrow();
    const r = await api().post(`/api/admin/users/${target.id}/status`).set(auth(admin)).send({ status: 'active' });
    expect(r.status).toBe(200);
    const token = await signIn(target.email);
    expect((await api().get('/api/notifications').set('Authorization', `Bearer ${token}`)).status).toBe(200);
  });
});
