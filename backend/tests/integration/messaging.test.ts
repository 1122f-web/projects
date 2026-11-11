// Conversations: access control, read receipts, unread counts, attachments
// (real type checks) and realtime delivery restricted by RLS.
import { expect } from 'vitest';
import { afterAll, api, auth, beforeAll, book, cleanup, createUser, createVerifiedDoctor, describe, directClient, it, sleep, slots, type TestUser } from './helpers.js';

let doctor: TestUser;
let patient: TestUser;
let outsider: TestUser;
let conversationId: string;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const send = (u: TestUser, body: string, id = conversationId) =>
  api().post(`/api/conversations/${id}/messages`).set(auth(u)).send({ body });

beforeAll(async () => {
  [doctor, patient, outsider] = await Promise.all([createVerifiedDoctor(), createUser(), createUser()]);
  const [slot] = await slots(doctor.id, 3);
  const appt = await book(patient, doctor.id, slot!.starts_at);
  expect(appt.status).toBe(201);
  const detail = await api().get(`/api/appointments/${appt.body.id}`).set(auth(patient));
  conversationId = detail.body.conversation_id;
  expect(conversationId).toBeTruthy();
});
afterAll(cleanup);

describe('conversation access', () => {
  it('is created automatically for the patient and doctor', async () => {
    const p = await api().get('/api/conversations').set(auth(patient));
    const d = await api().get('/api/conversations').set(auth(doctor));
    expect(p.body.map((c: { conversation_id: string }) => c.conversation_id)).toContain(conversationId);
    expect(d.body.map((c: { conversation_id: string }) => c.conversation_id)).toContain(conversationId);
  });

  it('is invisible to anyone else, via the API and directly', async () => {
    expect((await api().get(`/api/conversations/${conversationId}`).set(auth(outsider))).status).toBe(404);
    expect((await api().get(`/api/conversations/${conversationId}/messages`).set(auth(outsider))).status).toBe(404);
    expect((await send(outsider, 'let me in')).status).toBe(404);
    const direct = await outsider.db.from('messages').insert({ conversation_id: conversationId, sender_id: outsider.id, body: 'sneaky' });
    expect(direct.error).not.toBeNull();
  });

  it('does not let a participant send as someone else', async () => {
    const forged = await patient.db.from('messages').insert({ conversation_id: conversationId, sender_id: doctor.id, body: 'I am the doctor' });
    expect(forged.error).not.toBeNull();
  });

  it('does not allow editing or deleting sent messages', async () => {
    const m = await send(patient, 'immutable');
    expect(m.status).toBe(201);
    await patient.db.from('messages').update({ body: 'changed' }).eq('id', m.body.id);
    await patient.db.from('messages').delete().eq('id', m.body.id);
    const { data } = await doctor.db.from('messages').select('body').eq('id', m.body.id).single();
    expect(data!.body).toBe('immutable');
  });

  it('validates message content', async () => {
    expect((await send(patient, '   ')).status).toBe(400);
    expect((await send(patient, 'x'.repeat(4001))).status).toBe(400);
  });
});

describe('read receipts and unread counts', () => {
  it('counts unread messages and clears them on read', async () => {
    await api().post(`/api/conversations/${conversationId}/read`).set(auth(doctor));
    await send(patient, 'one');
    await send(patient, 'two');
    const before = (await api().get('/api/conversations').set(auth(doctor))).body.find((c: { conversation_id: string }) => c.conversation_id === conversationId);
    expect(before.unread_count).toBe(2);
    expect((await api().post(`/api/conversations/${conversationId}/read`).set(auth(doctor))).status).toBeLessThan(300);
    const after = (await api().get('/api/conversations').set(auth(doctor))).body.find((c: { conversation_id: string }) => c.conversation_id === conversationId);
    expect(after.unread_count).toBe(0);
    // The patient now sees the doctor's read time (read receipt).
    const mine = (await api().get('/api/conversations').set(auth(patient))).body.find((c: { conversation_id: string }) => c.conversation_id === conversationId);
    expect(mine.other_last_read_at).toBeTruthy();
  });

  it('keeps one unread notification per conversation instead of one per message', async () => {
    await api().post('/api/notifications/read').set(auth(doctor)).send({});
    await send(patient, 'a');
    await send(patient, 'b');
    await send(patient, 'c');
    const { body } = await api().get('/api/notifications').set(auth(doctor));
    const unreadMsg = body.items.filter((n: { type: string; read_at: string | null }) => n.type === 'new_message' && !n.read_at);
    expect(unreadMsg).toHaveLength(1);
    expect(unreadMsg[0].body).not.toMatch(/\ba\b|\bc\b/); // message text is never copied into notifications
  });
});

describe('attachments', () => {
  it('accepts a real image and serves it only to participants', async () => {
    const res = await api().post(`/api/conversations/${conversationId}/messages`).set(auth(patient)).attach('attachment', PNG, { filename: 'scan.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.attachment_mime).toBe('image/png');
    const url = await api().get(`/api/conversations/${conversationId}/messages/${res.body.id}/attachment`).set(auth(doctor));
    expect(url.status).toBe(200);
    expect(url.body.url).toMatch(/token=/);
    expect((await fetch(url.body.url)).status).toBe(200);
    expect((await api().get(`/api/conversations/${conversationId}/messages/${res.body.id}/attachment`).set(auth(outsider))).status).toBe(404);
    // and Storage itself refuses the outsider
    const { error } = await outsider.db.storage.from('chat-attachments').download(res.body.attachment_path);
    expect(error).not.toBeNull();
  });

  it('rejects files whose content is not an allowed type, whatever their name', async () => {
    const fake = await api().post(`/api/conversations/${conversationId}/messages`).set(auth(patient)).attach('attachment', Buffer.from('#!/bin/sh\nrm -rf /'), { filename: 'report.pdf', contentType: 'application/pdf' });
    expect(fake.status).toBe(400);
    const html = await api().post(`/api/conversations/${conversationId}/messages`).set(auth(patient)).attach('attachment', Buffer.from('<html><script>alert(1)</script>'), { filename: 'x.png', contentType: 'image/png' });
    expect(html.status).toBe(400);
  });

  it('rejects files over 10 MB', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024 + 10)]);
    const res = await api().post(`/api/conversations/${conversationId}/messages`).set(auth(patient)).attach('attachment', big, { filename: 'big.pdf' });
    expect(res.status).toBe(413);
  });
});

describe('realtime', () => {
  it('delivers new messages to participants only', async () => {
    const subscribe = (u: TestUser) => {
      const client = directClient(u.token);
      client.realtime.setAuth(u.token);
      const received: string[] = [];
      const ready = new Promise<void>((resolve, reject) => {
        client
          .channel(`test-${u.id}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (p) => {
            received.push((p.new as { body: string }).body);
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') resolve();
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(status));
          });
      });
      return { client, received, ready };
    };
    const d = subscribe(doctor);
    const o = subscribe(outsider);
    await Promise.all([d.ready, o.ready]);
    await sleep(500);
    expect((await send(patient, 'realtime hello')).status).toBe(201);
    for (let i = 0; i < 40 && !d.received.includes('realtime hello'); i++) await sleep(100);
    await sleep(500);
    expect(d.received).toContain('realtime hello');
    expect(o.received).toHaveLength(0);
    await d.client.removeAllChannels();
    await o.client.removeAllChannels();
  });
});
