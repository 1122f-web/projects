import type { PostgrestError } from '@supabase/supabase-js';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'error',
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, 'bad_request', details);
export const unauthorized = (msg = 'Please sign in to continue') => new HttpError(401, msg, 'unauthorized');
export const forbidden = (msg = 'You do not have permission to do that') => new HttpError(403, msg, 'forbidden');
export const notFound = (msg = 'Not found') => new HttpError(404, msg, 'not_found');
export const conflict = (msg: string) => new HttpError(409, msg, 'conflict');

const codeNames: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable',
};

/**
 * Converts a database error into a safe HTTP error. Messages raised by our own
 * SQL functions (SQLSTATE PTxxx) are written for end users and passed through;
 * anything else is logged by the caller and reported generically.
 */
export function fromDbError(error: PostgrestError | { code?: string; message: string }): HttpError {
  const code = error.code ?? '';
  const m = /^PT(\d{3})$/.exec(code);
  if (m) {
    const status = Number(m[1]);
    return new HttpError(status, error.message, codeNames[status] ?? 'error');
  }
  switch (code) {
    case '23505':
      return conflict('That record already exists');
    case '23P01':
      return conflict('That time overlaps with an existing entry');
    case '23503':
      return badRequest('A referenced record does not exist');
    case '23514':
    case '22P02':
    case '22007':
    case '22008':
      return badRequest('Some of the submitted values are invalid');
    case '42501':
      return forbidden();
    case 'PGRST116':
      return notFound();
    default:
      return new HttpError(500, 'Something went wrong. Please try again.', 'internal', { dbCode: code });
  }
}

/** Unwraps a Supabase result, throwing a safe HttpError on failure. */
export function check<R extends { data: unknown; error: PostgrestError | null }>(result: R): NonNullable<R['data']> {
  if (result.error) throw Object.assign(fromDbError(result.error), { cause: result.error });
  return result.data as NonNullable<R['data']>;
}

/** Like check(), for maybeSingle() queries whose data may legitimately be null. */
export function checkMaybe<R extends { data: unknown; error: PostgrestError | null }>(result: R): R['data'] {
  if (result.error) throw Object.assign(fromDbError(result.error), { cause: result.error });
  return result.data;
}
