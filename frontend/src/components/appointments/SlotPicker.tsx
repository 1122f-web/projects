import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarX2, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, qs } from '../../lib/api';
import type { Slot } from '../../lib/types';
import { addDays, dateKey, formatTime } from '../../lib/format';
import { EmptyState, ErrorState, Spinner } from '../ui/Feedback';

const WINDOW_DAYS = 14;

export function SlotPicker({
  doctorId,
  timeZone,
  value,
  onChange,
}: {
  doctorId: string;
  timeZone: string;
  value: string | null;
  onChange: (slot: Slot | null) => void;
}) {
  const [page, setPage] = useState(0);

  const start = addDays(new Date(), page * WINDOW_DAYS);
  // Query a day either side so slots near midnight in other time zones are included.
  const from = dateKey(addDays(start, page === 0 ? 0 : -1), 'UTC');
  const to = dateKey(addDays(start, WINDOW_DAYS), 'UTC');

  const query = useQuery({
    queryKey: ['slots', doctorId, from, to],
    queryFn: () => api.get<Slot[]>(`/doctors/${doctorId}/slots${qs({ from, to })}`),
    refetchInterval: 60_000,
  });

  const days = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of query.data ?? []) {
      const k = dateKey(s.starts_at, timeZone);
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [query.data, timeZone]);

  const [day, setDay] = useState<string | null>(null);
  useEffect(() => {
    if (days.length && (!day || !days.some(([k]) => k === day))) setDay(days[0]![0]);
  }, [days, day]);

  // If the selected slot disappears (someone else booked it), clear the selection.
  useEffect(() => {
    if (value && query.data && !query.data.some((s) => s.starts_at === value)) onChange(null);
  }, [query.data, value, onChange]);

  const slots = days.find(([k]) => k === day)?.[1] ?? [];
  const label = (k: string) =>
    new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(`${k}T12:00:00Z`)
    );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-500">Times shown in {timeZone}</p>
        <div className="flex gap-1">
          <button
            type="button"
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-label="Earlier dates"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            disabled={page >= 3}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Later dates"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {query.isLoading ? (
        <Spinner label="Loading available times" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : days.length === 0 ? (
        <EmptyState
          icon={CalendarX2}
          title="No available times in this period"
          description="Try later dates using the arrows above."
        />
      ) : (
        <>
          <div role="listbox" aria-label="Date" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
            {days.map(([k, list]) => (
              <button
                key={k}
                type="button"
                role="option"
                aria-selected={k === day}
                onClick={() => setDay(k)}
                className={`flex min-w-[5.5rem] shrink-0 flex-col items-center rounded-lg border px-3 py-2 text-sm ${
                  k === day
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-slate-200 text-slate-600 hover:border-brand-300'
                }`}
              >
                <span className="font-medium">{label(k)}</span>
                <span className="text-xs text-slate-500">{list.length} times</span>
              </button>
            ))}
          </div>
          <div role="listbox" aria-label="Time" className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {slots.map((s) => {
              const selected = s.starts_at === value;
              return (
                <button
                  key={s.starts_at}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => onChange(selected ? null : s)}
                  className={`rounded-lg border px-2 py-2 text-sm font-medium ${
                    selected
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-slate-200 text-slate-700 hover:border-brand-400 hover:bg-brand-50'
                  }`}
                >
                  {formatTime(s.starts_at, timeZone)}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}