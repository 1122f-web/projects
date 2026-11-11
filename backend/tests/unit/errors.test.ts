import { describe, expect, it } from 'vitest';
import type { PostgrestError } from '@supabase/supabase-js';
import { check, checkMaybe, fromDbError, HttpError } from '../../src/lib/errors.js';

const pg = (code: string, message = 'raw database message', details = '') =>
  Object.assign(new Error(message), { code, details, hint: '', name: 'PostgrestError', toJSON: () => ({}) }) as unknown as PostgrestError;

describe('fromDbError', () => {
  it('maps custom PTxxx codes to their HTTP status with the function message', () => {
    const e = fromDbError(pg('PT409', 'This time slot is not available'));
    expect(e.status).toBe(409);
    expect(e.message).toBe('This time slot is not available');
  });

  it('maps constraint violations to safe messages that hide database internals', () => {
    expect(fromDbError(pg('23P01', 'conflicting key value violates exclusion constraint "appointments_no_overlap"')).status).toBe(409);
    expect(fromDbError(pg('23505', 'duplicate key value violates unique constraint "x"')).status).toBe(409);
    expect(fromDbError(pg('42501', 'new row violates row-level security policy')).status).toBe(403);
    for (const code of ['23P01', '23505', '42501', '23503', '23514']) {
      expect(fromDbError(pg(code, 'constraint "secret_name" on table "t"')).message).not.toMatch(/secret_name|constraint|table/);
    }
  });

  it('maps "no rows" to 404 and unknown errors to 500', () => {
    expect(fromDbError(pg('PGRST116')).status).toBe(404);
    const unknown = fromDbError(pg('XX000', 'internal stack trace'));
    expect(unknown.status).toBe(500);
    expect(unknown.message).not.toContain('stack');
  });
});

describe('check / checkMaybe', () => {
  it('returns data or throws an HttpError', () => {
    expect(check({ data: { a: 1 }, error: null })).toEqual({ a: 1 });
    expect(() => check({ data: null, error: pg('PT404', 'Appointment not found') })).toThrow(HttpError);
    expect(checkMaybe({ data: null, error: null })).toBeNull();
  });
});
