import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { z } from 'zod';
import { ApiError } from './api';

/** Copies field errors returned by the API onto the form. Returns true if any were applied. */
export function applyServerErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>): boolean {
  if (!(err instanceof ApiError) || !err.fields) return false;
  let applied = false;
  for (const [field, message] of Object.entries(err.fields)) {
    setError(field as Path<T>, { type: 'server', message });
    applied = true;
  }
  return applied;
}

export const passwordRule = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[a-z]/, 'Add a lowercase letter')
  .regex(/[A-Z]/, 'Add an uppercase letter')
  .regex(/[0-9]/, 'Add a number');

export const emailRule = z.string().trim().min(1, 'Email is required').email('Enter a valid email address').max(254);
