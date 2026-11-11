// In-app notifications, the email outbox (delivered to the local Mailpit
// SMTP server), reminders and the protected job endpoint.
import { expect } from 'vitest';
import { afterAll, api, auth, beforeAll, book, cleanup, createUser, createVerifiedDoctor, describe, it, serviceClient, sleep, slots, type TestUser } from './helpers.js';
import { config } from '../../src/config.js';

let doctor: TestUser;
let patient: TestUser;
let quiet: TestUser;

beforeAll(async () => {
  [doctor, patient, quiet] = await Promise.all([createVerifiedDoctor(), createUser(), createUser()]);
});
afterAll(cleanup);

const runJobs = () => api().post('/api/internal/run-jobs').set('x-cron-secret', config.CRON_SECRET ?? '');

describe('in-app notifications', () => {
  it('notifies the doctor of a booking and the patient of the decision, without clinical details', async () => {
    const [slot] = await slots(doctor.id, 3);
    const appt = await book(patient, doctor.id, slot!.starts_at);
    expect(appt.status).toBe(201);
    const d = await api().get('/api/notifications').set(auth(doctor));
    const booked = d.body.items.find((n: { type: string }) => n.type === 'appointment_booked');
    expect(booked).toBeDefined();
    expect(booked.body).not.toContain('Fictional test visit'); // reason for visit stays out of notifications
    expect(booked.link).toBe(`/doctor/appointments/${appt.body.id}`);

    await api().post(`/api/appointments/${appt.body.id}/status`).set(auth(doctor)).send({ status: 'confirmed' });
    const p = await api().get('/api/notifications').set(auth(patient));
    expect(p.body.items.some((n: { type: string }) => n.type === 'appointment_confirmed')).toBe(true);
    expect(p.body.unread).toBeGreaterThan(0);
  });

  it('marks read and deletes only the caller\'s notifications', async () => {
    const mine = (await api().get('/api/notifications').set(auth(patient))).body.items[0];
    expect((await api().delete(`/api/notifications/${mine.id}`).set(auth(doctor))).status).toBe(404);
    expect((await api().post('/api/notifications/read').set(auth(patient)).send({ ids: [mine.id] })).status).toBeLessThan(300);
    const count = await api().get('/api/notifications/unread-count').set(auth(patient));
    expect(count.status).toBe(200);
    expect((await api().delete(`/api/notifications/${mine.id}`).set(auth(patient))).status).toBeLessThan(300);
  });
});

describe('job endpoint', () => {
  it('requires the cron secret', async () => {
    expect((await api().post('/api/internal/run-jobs')).status).toBe(401);
    expect((await api().post('/api/internal/run-jobs').set('x-cron-secret', 'wrong')).status).toBe(401);
  });

  it('sends reminders once for confirmed appointments inside the reminder window', async () => {
    const [soon] = await slots(doctor.id, 1); // tomorrow: within 24 hours
    const appt = await book(patient, doctor.id, soon!.starts_at);
    expect(appt.status).toBe(201);
    await api().post(`/api/appointments/${appt.body.id}/status`).set(auth(doctor)).send({ status: 'confirmed' });
    expect((await runJobs()).status).toBe(200);
    const reminders = async () =>
      (await serviceClient.from('notifications').select('id').eq('user_id', patient.id).eq('type', 'appointment_reminder')).data ?? [];
    expect(await reminders()).toHaveLength(1);
    await runJobs();
    expect(await reminders()).toHaveLength(1);
  });

  it('closes requests that were never confirmed before their start time', async () => {
    const [slot] = await slots(doctor.id, 12);
    const appt = await book(patient, doctor.id, slot!.starts_at);
    const past = new Date(Date.now() - 3_600_000);
    await serviceClient.from('appointments').update({ starts_at: past.toISOString(), ends_at: new Date(past.getTime() + 1_800_000).toISOString() }).eq('id', appt.body.id);
    await runJobs();
    const { data } = await serviceClient.from('appointments').select('status').eq('id', appt.body.id).single();
    expect(data!.status).toBe('cancelled');
  });
});

(config.emailEnabled ? describe : describe.skip)('email delivery (local SMTP)', () => {
  it('emails notifications to users who opted in, and skips those who opted out', async () => {
    await api().patch('/api/me').set(auth(quiet)).send({ email_notifications: false });
    const [slot] = await slots(doctor.id, 14);
    const appt = await book(patient, doctor.id, slot!.starts_at);
    await api().post(`/api/appointments/${appt.body.id}/status`).set(auth(doctor)).send({ status: 'confirmed' });
    const [s2] = await slots(doctor.id, 15);
    await book(quiet, doctor.id, s2!.starts_at);
    await runJobs();
    await sleep(500);

    const { data: sent } = await serviceClient.from('notifications').select('email_status').eq('user_id', patient.id).eq('type', 'appointment_confirmed');
    expect(sent!.every((n) => n.email_status === 'sent')).toBe(true);
    const { data: skipped } = await serviceClient.from('notifications').select('email_status').eq('user_id', quiet.id);
    expect(skipped!.every((n) => n.email_status === 'skipped')).toBe(true);

    const mailpit = await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:${patient.email}`)}`);
    const found = (await mailpit.json()) as { messages: { Subject: string }[] };
    expect(found.messages.some((m) => /confirmed/i.test(m.Subject))).toBe(true);
    const none = (await (await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:${quiet.email}`)}`)).json()) as { messages: unknown[] };
    expect(none.messages).toHaveLength(0);
  });
});
