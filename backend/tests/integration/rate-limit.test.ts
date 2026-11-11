// Rate limiting is switched off for the rest of the suite; this file turns it on.
import { describe, expect, it } from 'vitest';
import request from 'supertest';

process.env.DISABLE_RATE_LIMIT = 'false';
const { createApp } = await import('../../src/app.js');
const app = createApp();

describe('rate limiting', () => {
  it('limits contact form submissions per client', async () => {
    const body = { name: 'Rate Test', email: 'rate@test.mediconnect.test', subject: 'Hello there', message: 'Fictional rate limit test message.' };
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await request(app).post('/api/contact').send(body)).status);
    expect(codes.slice(0, 5).every((c) => c === 201)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });

  it('limits registration attempts', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      codes.push((await request(app).post('/api/auth/register').send({ email: 'bad', password: 'x', full_name: 'R', accept_terms: true })).status);
    }
    expect(codes).toContain(429);
  });
});
