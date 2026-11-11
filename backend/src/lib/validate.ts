import { z } from 'zod';
import { badRequest } from './errors.js';

/** Parses input with a zod schema, throwing a 400 with field errors on failure. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    throw badRequest('Please check the highlighted fields', { fields });
  }
  return result.data;
}

export const uuid = z.uuid('Invalid identifier');
export const idParams = z.object({ id: uuid });
export const trimmed = (min: number, max: number, label = 'This field') =>
  z
    .string()
    .trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .optional()
    .transform((v) => (v === '' ? undefined : v));
export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');
export const isoDateTime = z.iso.datetime({ offset: true, message: 'Use an ISO 8601 date-time' });
