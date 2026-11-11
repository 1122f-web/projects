// Booking workflow: slots, double-booking prevention (including concurrent
// requests), status transitions, rescheduling and time zone handling.
import { expect } from 'vitest';
import { afterAll, api, auth, beforeAll, book, cleanup, createUser, createVerifiedDoctor, describe, it, serviceClient, slots, type TestUser } from './helpers.js';

let doctor: TestUser;
let doctor2: TestUser;
let jane: TestUser;
let peter: TestUser;

beforeAll(async () => {
  [doctor, doctor2, jane, peter] = await Promise.all([createVerifiedDoctor(), createVerifiedDoctor(), createUser(), createUser()]);
});
afterAll(cleanup);

const status = (u: TestUser, id: string, s: string, note?: string) =>
  api().post(`/api/appointments/${id}/status`).set(auth(u)).send({ status: s, note });

describe('slots', () => {
  it('generates slots in the doctor\'s time zone (08:00 Nairobi = 05:00 UTC)', async () => {
    const list = await slots(doctor.id, 3);
    expect(list.length).toBe(20); // 08:00 to 18:00 in 30-minute slots
    expect(new Date(list[0]!.starts_at).getUTCHours()).toBe(5);
    expect(new Date(list.at(-1)!.ends_at).getUTCHours()).toBe(15);
  });

  it('validates the date range', async () => {
    expect((await api().get(`/api/doctors/${doctor.id}/slots`).query({ from: '2026-02-30', to: '2026-03-01' })).status).toBe(400);
    expect((await api().get(`/api/doctors/${doctor.id}/slots`).query({ from: '2026-03-02', to: '2026-03-01' })).status).toBe(400);
  });

  it('offers no slots for an unverified doctor and refuses bookings with them', async () => {
    const unverified = await createUser('doctor');
    await unverified.db.rpc('set_doctor_availability', { p_slots: [{ day_of_week: 1, start_time: '08:00', end_time: '18:00' }] });
    expect(await slots(unverified.id, 1, 7)).toHaveLength(0);
    const [slot] = await slots(doctor.id, 3);
    expect((await book(jane, unverified.id, slot!.starts_at)).status).toBeGreaterThanOrEqual(400);
  });
});

describe('booking', () => {
  it('books a free slot as pending and removes it from availability', async () => {
    const [slot] = await slots(doctor.id, 3);
    const res = await book(jane, doctor.id, slot!.starts_at);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    const after = await slots(doctor.id, 3);
    expect(after.map((s) => s.starts_at)).not.toContain(slot!.starts_at);
  });

  it('rejects a second booking of the same slot with 409', async () => {
    const [slot] = await slots(doctor.id, 4);
    expect((await book(jane, doctor.id, slot!.starts_at)).status).toBe(201);
    const second = await book(peter, doctor.id, slot!.starts_at);
    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(/not available/i);
  });

  it('lets exactly one of many simultaneous requests for one slot succeed', async () => {
    const [slot] = await slots(doctor.id, 5);
    const patients = await Promise.all(Array.from({ length: 6 }, () => createUser()));
    const results = await Promise.all(patients.map((p) => book(p, doctor.id, slot!.starts_at)));
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(5);
    const { count } = await serviceClient.from('appointments').select('id', { count: 'exact', head: true }).eq('doctor_id', doctor.id).eq('starts_at', slot!.starts_at);
    expect(count).toBe(1);
  });

  it('stops a patient booking two doctors at the same time', async () => {
    const [slot] = await slots(doctor.id, 6);
    expect((await book(peter, doctor.id, slot!.starts_at)).status).toBe(201);
    expect((await book(peter, doctor2.id, slot!.starts_at)).status).toBe(409);
  });

  it('rejects past times, times off the slot grid and times beyond the booking window', async () => {
    const [slot] = await slots(doctor.id, 3);
    const offGrid = new Date(new Date(slot!.starts_at).getTime() + 7 * 60_000).toISOString();
    expect((await book(jane, doctor.id, new Date(Date.now() - 86_400_000).toISOString())).status).toBeGreaterThanOrEqual(400);
    expect((await book(jane, doctor.id, offGrid)).status).toBeGreaterThanOrEqual(400);
    expect((await book(jane, doctor.id, new Date(Date.now() + 400 * 86_400_000).toISOString())).status).toBeGreaterThanOrEqual(400);
  });

  it('rejects invalid input with field errors', async () => {
    const res = await api().post('/api/appointments').set(auth(jane)).send({ doctor_id: 'nope', starts_at: 'tomorrow', consultation_type: 'teleport', reason: '' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details.fields)).toEqual(expect.arrayContaining(['doctor_id', 'starts_at', 'consultation_type', 'reason']));
  });
});

describe('status workflow', () => {
  let id: string;
  let slotStart: string;
  beforeAll(async () => {
    const [slot] = await slots(doctor.id, 7);
    slotStart = slot!.starts_at;
    id = (await book(jane, doctor.id, slotStart)).body.id;
  });

  it('does not let the patient confirm their own appointment', async () => {
    const res = await status(jane, id, 'confirmed');
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/cannot be changed/);
  });

  it('does not let another doctor act on it', async () => {
    expect((await status(doctor2, id, 'confirmed')).status).toBe(404);
  });

  it('lets the doctor confirm, and refuses completing before it starts', async () => {
    const res = await status(doctor, id, 'confirmed');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');
    expect((await status(doctor, id, 'completed')).status).toBeGreaterThanOrEqual(400);
  });

  it('reschedules to a free slot, and refuses a taken one', async () => {
    const free = await slots(doctor.id, 8);
    const taken = await book(peter, doctor.id, free[0]!.starts_at);
    expect(taken.status).toBe(201);
    expect((await api().post(`/api/appointments/${id}/reschedule`).set(auth(jane)).send({ starts_at: free[0]!.starts_at })).status).toBe(409);
    const ok = await api().post(`/api/appointments/${id}/reschedule`).set(auth(jane)).send({ starts_at: free[1]!.starts_at });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('rescheduled');
    expect(ok.body.starts_at).toBe(free[1]!.starts_at);
    // the old time is free again
    expect((await slots(doctor.id, 7)).map((s) => s.starts_at)).toContain(slotStart);
  });

  it('lets the patient cancel, frees the slot, and refuses further changes', async () => {
    const res = await status(jane, id, 'cancelled', 'Fictional test');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect((await status(doctor, id, 'confirmed')).status).toBeGreaterThanOrEqual(400);
  });

  it('lets the doctor reject a pending request', async () => {
    const [slot] = await slots(doctor.id, 9);
    const a = (await book(peter, doctor.id, slot!.starts_at)).body.id;
    const res = await status(doctor, a, 'rejected', 'Fully booked');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
  });
});

describe('completion and reviews', () => {
  it('only allows a review after completion, once per appointment', async () => {
    const [slot] = await slots(doctor2.id, 10);
    const booked = await book(jane, doctor2.id, slot!.starts_at);
    expect(booked.status).toBe(201);
    const id = booked.body.id;
    expect((await api().post('/api/reviews').set(auth(jane)).send({ appointment_id: id, rating: 5 })).status).toBeGreaterThanOrEqual(400);
    // Move the visit into the past so it can be completed (test-only shortcut via the service role).
    const past = new Date(Date.now() - 2 * 3_600_000);
    const moved = await serviceClient.from('appointments').update({ status: 'confirmed', starts_at: past.toISOString(), ends_at: new Date(past.getTime() + 1_800_000).toISOString() }).eq('id', id);
    expect(moved.error).toBeNull();
    const done = await status(doctor2, id, 'completed');
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((await api().post('/api/reviews').set(auth(peter)).send({ appointment_id: id, rating: 1 })).status).toBeGreaterThanOrEqual(400);
    expect((await api().post('/api/reviews').set(auth(jane)).send({ appointment_id: id, rating: 6 })).status).toBe(400);
    const ok = await api().post('/api/reviews').set(auth(jane)).send({ appointment_id: id, rating: 4, comment: 'Fictional review' });
    expect(ok.status).toBe(201);
    expect((await api().post('/api/reviews').set(auth(jane)).send({ appointment_id: id, rating: 5 })).status).toBe(409);
    const { data } = await serviceClient.from('doctor_profiles').select('rating_avg, rating_count').eq('id', doctor2.id).single();
    expect(data).toMatchObject({ rating_count: 1 });
    expect(Number(data!.rating_avg)).toBe(4);
  });
});
