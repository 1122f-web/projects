// Daily (https://docs.daily.co/reference/rest-api) rooms and meeting tokens.
// Rooms are private: a participant needs a meeting token issued here, which
// carries their name, whether they own the room (the doctor) and an expiry.
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export interface DailyRoom {
  name: string;
  url: string;
}

const unavailable = () => new HttpError(502, 'The video service is unavailable right now. Please try again in a moment.', 'video_unavailable');

async function daily<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: T | null }> {
  let res: Response;
  try {
    res = await fetch(`${config.DAILY_API_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.DAILY_API_KEY}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.error({ err, path }, 'daily request failed');
    throw unavailable();
  }
  const data = (await res.json().catch(() => null)) as T | null;
  if (res.status >= 500 || res.status === 401 || res.status === 403) {
    logger.error({ status: res.status, path, data }, 'daily request rejected');
    throw unavailable();
  }
  return { status: res.status, data };
}

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

/**
 * Creates the room, or returns it if it already exists (two participants can
 * click Join at the same moment; the room name is derived from the appointment).
 * The expiry is moved later when needed, e.g. after a reschedule.
 */
export async function ensureRoom(name: string, expiresAt: Date): Promise<DailyRoom> {
  const properties = { exp: unix(expiresAt), eject_at_room_exp: true, enable_prejoin_ui: true, enable_chat: true, enable_screenshare: true };
  const created = await daily<DailyRoom>('POST', '/rooms', { name, privacy: 'private', properties });
  if (created.status === 200 && created.data) return created.data;

  const existing = await daily<DailyRoom>('GET', `/rooms/${encodeURIComponent(name)}`);
  if (existing.status !== 200 || !existing.data) {
    logger.error({ status: created.status, data: created.data }, 'daily room could not be created');
    throw unavailable();
  }
  await daily('POST', `/rooms/${encodeURIComponent(name)}`, { properties });
  return existing.data;
}

/** A token for one participant, valid until the room expires. */
export async function createMeetingToken(opts: { roomName: string; userId: string; userName: string; isOwner: boolean; expiresAt: Date }): Promise<string> {
  const { status, data } = await daily<{ token: string }>('POST', '/meeting-tokens', {
    properties: {
      room_name: opts.roomName,
      user_id: opts.userId,
      user_name: opts.userName.slice(0, 100),
      is_owner: opts.isOwner,
      exp: unix(opts.expiresAt),
    },
  });
  if (status !== 200 || !data?.token) {
    logger.error({ status, data }, 'daily meeting token could not be created');
    throw unavailable();
  }
  return data.token;
}
