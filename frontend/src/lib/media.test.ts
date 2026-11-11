import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestMediaAccess } from './media';

const stream = () => ({ getTracks: () => [{ stop: vi.fn() }] });
const fail = (name: string) => Promise.reject(new DOMException('x', name));

function mockMedia(getUserMedia: (c: MediaStreamConstraints) => Promise<unknown>) {
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(getUserMedia) }, configurable: true });
}

describe('requestMediaAccess', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('grants camera and microphone and releases the test stream', async () => {
    const stop = vi.fn();
    mockMedia(async () => ({ getTracks: () => [{ stop }] }));
    expect(await requestMediaAccess()).toEqual({ ok: true, audioOnly: false });
    expect(stop).toHaveBeenCalledOnce();
  });

  it('falls back to microphone only when there is no camera', async () => {
    mockMedia((c) => (c.video ? fail('NotFoundError') : Promise.resolve(stream())));
    expect(await requestMediaAccess()).toEqual({ ok: true, audioOnly: true });
  });

  it('explains how to unblock a denied permission', async () => {
    mockMedia(() => fail('NotAllowedError'));
    const result = await requestMediaAccess();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/blocked/);
  });

  it('reports a device busy in another app', async () => {
    mockMedia(() => fail('NotReadableError'));
    const result = await requestMediaAccess();
    expect(!result.ok && result.message).toMatch(/another app/);
  });

  it('requires a secure connection', async () => {
    mockMedia(async () => stream());
    vi.stubGlobal('isSecureContext', false);
    const result = await requestMediaAccess();
    expect(!result.ok && result.message).toMatch(/https/);
  });
});
