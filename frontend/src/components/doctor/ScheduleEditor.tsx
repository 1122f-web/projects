import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Button } from '../ui/Button';
import { Select } from '../ui/Field';
import { ErrorState, Spinner } from '../ui/Feedback';
import { useToast } from '../ui/Toast';
import { DAY_NAMES } from '../../lib/format';

export interface Block {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const DURATIONS = [15, 20, 30, 45, 60, 90, 120];
const DEFAULT_START = '09:00';
const DEFAULT_END = '17:00';
/** Monday to Friday, 09:00 to 17:00: the hours every new doctor starts with. */
const STANDARD_WEEK: Block[] = [1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, start_time: DEFAULT_START, end_time: DEFAULT_END }));

const minutes = (t: string) => {
  const [h = 0, m = 0] = t.split(':').map(Number);
  return h * 60 + m;
};

export function validateBlocks(blocks: Block[]): string | null {
  for (const b of blocks) {
    if (!b.start_time || !b.end_time) return `${DAY_NAMES[b.day_of_week]}: fill in both times`;
    if (b.end_time <= b.start_time) return `${DAY_NAMES[b.day_of_week]}: end time must be after start time`;
  }
  for (const day of ORDER) {
    const list = blocks.filter((b) => b.day_of_week === day).sort((a, b) => a.start_time.localeCompare(b.start_time));
    for (let i = 1; i < list.length; i++) {
      if (list[i]!.start_time < list[i - 1]!.end_time) return `${DAY_NAMES[day]}: time blocks overlap`;
    }
  }
  return null;
}

/** Number of bookable slots a day's blocks produce at the given appointment length. */
export function slotsPerDay(blocks: Block[], duration: number): number {
  return blocks.reduce((n, b) => n + (b.end_time > b.start_time ? Math.floor((minutes(b.end_time) - minutes(b.start_time)) / duration) : 0), 0);
}

/** Weekly working hours and appointment length; patients book slots generated from these. */
export function ScheduleEditor() {
  const { me } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const schedule = useQuery({ queryKey: ['doctor', 'availability'], queryFn: () => api.get<Block[]>('/doctor/availability') });
  const profile = useQuery({ queryKey: ['doctor', 'profile'], queryFn: () => api.get<{ slot_duration_minutes: number }>('/doctor/profile') });
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [duration, setDuration] = useState(30);
  const [blocksDirty, setBlocksDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (schedule.data) {
      setBlocks(schedule.data.map(({ day_of_week, start_time, end_time }) => ({ day_of_week, start_time, end_time })));
      setBlocksDirty(false);
    }
  }, [schedule.data]);
  useEffect(() => {
    if (profile.data) setDuration(profile.data.slot_duration_minutes);
  }, [profile.data]);

  const durationDirty = Boolean(profile.data) && duration !== profile.data!.slot_duration_minutes;

  const save = useMutation({
    mutationFn: async () => {
      if (blocksDirty) await api.put('/doctor/availability', { blocks });
      if (durationDirty) await api.patch('/doctor/profile', { slot_duration_minutes: duration });
    },
    onSuccess: () => {
      toast.success('Schedule saved', 'Patients now see slots from these hours.');
      setBlocksDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['doctor'] });
      void queryClient.invalidateQueries({ queryKey: ['slots'] });
    },
    onError: (err) => toast.error('Could not save the schedule', errorMessage(err)),
  });

  const update = (next: Block[]) => {
    setBlocks(next);
    setBlocksDirty(true);
    setError(null);
  };

  const toggleDay = (day: number, on: boolean) =>
    update(on ? [...blocks, { day_of_week: day, start_time: DEFAULT_START, end_time: DEFAULT_END }] : blocks.filter((b) => b.day_of_week !== day));

  const addHours = (day: number, list: Block[]) => {
    const last = list[list.length - 1];
    const start = last ? last.end_time : DEFAULT_START;
    const [h = 9] = start.split(':').map(Number);
    const end = `${String(Math.min(h + 3, 23)).padStart(2, '0')}:${start.slice(3) || '00'}`;
    update([...blocks, { day_of_week: day, start_time: start, end_time: end > start ? end : '23:59' }]);
  };

  const timeInput = (i: number, field: 'start_time' | 'end_time', label: string) => (
    <>
      <label className="sr-only" htmlFor={`${field}-${i}`}>
        {label}
      </label>
      <input
        id={`${field}-${i}`}
        type="time"
        value={blocks[i]![field]}
        onChange={(e) => update(blocks.map((x, j) => (j === i ? { ...x, [field]: e.target.value } : x)))}
        className="h-9 rounded-lg border border-slate-300 px-2 text-sm"
      />
    </>
  );

  const weeklySlots = ORDER.reduce((n, d) => n + slotsPerDay(blocks.filter((b) => b.day_of_week === d), duration), 0);

  return (
    <Card>
      <CardHeader
        title="Schedule"
        description={`Working days, hours and appointment length. Times are in your profile time zone (${me?.timezone}). Existing appointments are not affected.`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => update(STANDARD_WEEK)}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Mon–Fri, 9 to 5
            </Button>
            <Button
              onClick={() => {
                const err = validateBlocks(blocks);
                setError(err);
                if (!err) save.mutate();
              }}
              disabled={!blocksDirty && !durationDirty}
              loading={save.isPending}
            >
              Save schedule
            </Button>
          </div>
        }
      />
      <CardBody>
        {schedule.isLoading || profile.isLoading ? (
          <Spinner />
        ) : schedule.isError ? (
          <ErrorState error={schedule.error} onRetry={() => schedule.refetch()} />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="w-full sm:w-56">
                <Select label="Appointment length" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                  {DURATIONS.map((m) => (
                    <option key={m} value={m}>
                      {m} minutes
                    </option>
                  ))}
                </Select>
              </div>
              <p className="text-sm text-slate-500">
                {weeklySlots} bookable slot{weeklySlots === 1 ? '' : 's'} a week
              </p>
            </div>
            {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
            <div>
              {ORDER.map((day) => {
                const list = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.day_of_week === day);
                const open = list.length > 0;
                const count = slotsPerDay(list.map(({ b }) => b), duration);
                return (
                  <div key={day} className="flex flex-col gap-2 border-b border-slate-100 py-3 last:border-0 sm:flex-row sm:items-start">
                    <div className="flex w-44 shrink-0 items-center gap-3 pt-1.5">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={open}
                        aria-label={`${DAY_NAMES[day]} working day`}
                        onClick={() => toggleDay(day, !open)}
                        className={`relative h-5 w-9 shrink-0 rounded-full transition ${open ? 'bg-brand-600' : 'bg-slate-300'}`}
                      >
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${open ? 'left-[1.125rem]' : 'left-0.5'}`} />
                      </button>
                      <span className="text-sm font-medium text-slate-700">{DAY_NAMES[day]}</span>
                    </div>
                    <div className="flex-1 space-y-2">
                      {!open && <p className="pt-1.5 text-sm text-slate-400">Closed</p>}
                      {list.map(({ i }) => (
                        <div key={i} className="flex flex-wrap items-center gap-2">
                          {timeInput(i, 'start_time', `${DAY_NAMES[day]} start time`)}
                          <span className="text-slate-400">to</span>
                          {timeInput(i, 'end_time', `${DAY_NAMES[day]} end time`)}
                          <button
                            type="button"
                            onClick={() => update(blocks.filter((_, j) => j !== i))}
                            className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            aria-label={`Remove ${DAY_NAMES[day]} block`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      {open && <p className="text-xs text-slate-500">{count} slot{count === 1 ? '' : 's'}</p>}
                    </div>
                    {open && (
                      <Button variant="ghost" size="sm" onClick={() => addHours(day, list.map(({ b }) => b))}>
                        <Plus className="h-4 w-4" aria-hidden="true" /> Add hours
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
