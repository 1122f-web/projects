import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: { auth: {} } }));
const { slotsPerDay, validateBlocks } = await import('./ScheduleEditor');

const block = (start_time: string, end_time: string, day_of_week = 1) => ({ day_of_week, start_time, end_time });

describe('slotsPerDay', () => {
  it('gives 16 half-hour slots for the default 09:00 to 17:00', () => {
    expect(slotsPerDay([block('09:00', '17:00')], 30)).toBe(16);
  });

  it('adds up split shifts and drops a final partial slot', () => {
    expect(slotsPerDay([block('09:00', '12:00'), block('14:00', '16:50')], 45)).toBe(4 + 3);
  });

  it('ignores a block whose end is not after its start', () => {
    expect(slotsPerDay([block('10:00', '09:00')], 30)).toBe(0);
  });
});

describe('validateBlocks', () => {
  it('accepts the standard week', () => {
    expect(validateBlocks([1, 2, 3, 4, 5].map((d) => block('09:00', '17:00', d)))).toBeNull();
  });

  it('rejects overlapping blocks on the same day', () => {
    expect(validateBlocks([block('09:00', '12:00'), block('11:00', '13:00')])).toBe('Monday: time blocks overlap');
  });

  it('rejects an end time before the start', () => {
    expect(validateBlocks([block('17:00', '09:00', 2)])).toBe('Tuesday: end time must be after start time');
  });
});
