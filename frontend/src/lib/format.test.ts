import { describe, expect, it } from 'vitest';
import { dateKey, formatBytes, formatTime, initials } from './format';

describe('time zone formatting', () => {
  const iso = '2026-10-20T06:00:00Z';

  it("shows the same instant in each viewer's zone", () => {
    expect(formatTime(iso, 'Africa/Nairobi')).toMatch(/09:00/);
    expect(formatTime(iso, 'UTC')).toMatch(/06:00/);
    expect(formatTime(iso, 'America/New_York')).toMatch(/02:00/);
  });

  it('groups by the local calendar day', () => {
    expect(dateKey('2026-10-20T22:30:00Z', 'Africa/Nairobi')).toBe('2026-10-21');
    expect(dateKey('2026-10-20T22:30:00Z', 'UTC')).toBe('2026-10-20');
  });

  it('falls back safely on an unknown zone', () => {
    expect(() => formatTime(iso, 'Mars/Olympus')).not.toThrow();
  });
});

describe('small helpers', () => {
  it('formats sizes and initials', () => {
    expect(formatBytes(2048)).toBe('2 KB');
    expect(initials('Dr. Jane Mwangi')).toBe('JM');
  });
});
