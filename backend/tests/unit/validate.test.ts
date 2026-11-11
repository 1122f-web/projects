import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { idParams, parse } from '../../src/lib/validate.js';
import { passwordSchema } from '../../src/routes/auth.js';
import { escapeHtml } from '../../src/services/email.js';

describe('parse', () => {
  it('throws a 400 with per-field messages', () => {
    try {
      parse(z.object({ name: z.string().min(2, 'Too short') }), { name: 'a' });
      expect.unreachable();
    } catch (err) {
      const e = err as { status: number; details: { fields: Record<string, string> } };
      expect(e.status).toBe(400);
      expect(e.details.fields.name).toBe('Too short');
    }
  });

  it('rejects malformed ids', () => {
    expect(() => parse(idParams, { id: "1' or '1'='1" })).toThrow();
    expect(parse(idParams, { id: '7f3c441d-07de-4d6c-b654-f5b21ab3f144' }).id).toBeDefined();
  });
});

describe('passwordSchema', () => {
  it('requires 8+ characters with upper, lower and a digit', () => {
    for (const bad of ['short1A', 'alllowercase1', 'ALLUPPERCASE1', 'NoDigitsHere']) {
      expect(passwordSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(passwordSchema.safeParse('GoodPass123').success).toBe(true);
  });
});

describe('escapeHtml', () => {
  it('neutralises markup in email content', () => {
    expect(escapeHtml('<script>"x" & \'y\'</script>')).toBe('&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;');
  });
});
