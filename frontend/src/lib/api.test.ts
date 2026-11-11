import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}));

const { api, ApiError, errorMessage, qs } = await import('./api');

afterEach(() => vi.unstubAllGlobals());

describe('qs', () => {
  it('drops empty values and encodes the rest', () => {
    expect(qs({ a: 1, b: '', c: undefined, d: 'x y' })).toBe('?a=1&d=x+y');
    expect(qs({})).toBe('');
  });
});

describe('request', () => {
  it('sends the session token and parses JSON', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await api.get('/me')).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/me$/);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('turns API errors into ApiError with field messages', async () => {
    const payload = { error: { code: 'bad_request', message: 'Please check the highlighted fields', details: { fields: { email: 'Enter a valid email address' } } } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 400, headers: { 'Content-Type': 'application/json' } })));
    const err = await api.post('/auth/register', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).status).toBe(400);
    expect((err as InstanceType<typeof ApiError>).fields).toEqual({ email: 'Enter a valid email address' });
    expect(errorMessage(err)).toBe('Please check the highlighted fields');
  });

  it('reports network failures in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = await api.get('/me').catch((e: unknown) => e);
    expect(errorMessage(err)).not.toMatch(/undefined/);
  });
});
