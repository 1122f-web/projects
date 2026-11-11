import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Card, CardBody, CardHeader, PageHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { EmptyState, Spinner } from '../../components/ui/Feedback';
import { ConfirmDialog } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { browserTimeZone, formatDateTime } from '../../lib/format';
import { ScheduleEditor } from '../../components/doctor/ScheduleEditor';

interface TimeOff {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

export function AvailabilityPage() {
  const { me } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const timeOff = useQuery({ queryKey: ['doctor', 'time-off'], queryFn: () => api.get<TimeOff[]>('/doctor/time-off') });
  const [offStart, setOffStart] = useState('');
  const [offEnd, setOffEnd] = useState('');
  const [offReason, setOffReason] = useState('');
  const [removing, setRemoving] = useState<TimeOff | null>(null);

  const addOff = useMutation({
    mutationFn: () => api.post('/doctor/time-off', { starts_at: new Date(offStart).toISOString(), ends_at: new Date(offEnd).toISOString(), reason: offReason.trim() || undefined }),
    onSuccess: () => {
      toast.success('Time off added');
      setOffStart('');
      setOffEnd('');
      setOffReason('');
      void queryClient.invalidateQueries({ queryKey: ['doctor', 'time-off'] });
    },
    onError: (err) => toast.error('Could not add time off', errorMessage(err)),
  });
  const removeOff = useMutation({
    mutationFn: (id: string) => api.del(`/doctor/time-off/${id}`),
    onSuccess: () => {
      toast.success('Time off removed');
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: ['doctor', 'time-off'] });
    },
    onError: (err) => toast.error('Could not remove', errorMessage(err)),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Schedule" description="Your working days, hours, appointment length and time off." />
      <ScheduleEditor />
      <Card>
        <CardHeader title="Time off" description={`Block dates when you are unavailable. Enter times in your device's time zone (${browserTimeZone()}).`} />
        <CardBody className="space-y-4">
          <form
            className="grid gap-3 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!offStart || !offEnd) return toast.error('Choose a start and end');
              if (new Date(offEnd) <= new Date(offStart)) return toast.error('End must be after start');
              addOff.mutate();
            }}
          >
            <Input label="From" type="datetime-local" value={offStart} onChange={(e) => setOffStart(e.target.value)} required />
            <Input label="Until" type="datetime-local" value={offEnd} onChange={(e) => setOffEnd(e.target.value)} required />
            <Input label="Reason (optional)" value={offReason} onChange={(e) => setOffReason(e.target.value)} maxLength={200} />
            <div className="flex items-end">
              <Button type="submit" variant="secondary" loading={addOff.isPending} className="w-full">
                Add time off
              </Button>
            </div>
          </form>
          {timeOff.isLoading ? (
            <Spinner />
          ) : (timeOff.data?.length ?? 0) === 0 ? (
            <EmptyState icon={CalendarOff} title="No upcoming time off" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {timeOff.data!.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {formatDateTime(t.starts_at, me?.timezone)} → {formatDateTime(t.ends_at, me?.timezone)}
                    </p>
                    {t.reason && <p className="text-slate-500">{t.reason}</p>}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setRemoving(t)} aria-label="Remove time off">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove time off"
        message="Patients will be able to book during this period again."
        confirmLabel="Remove"
        tone="danger"
        loading={removeOff.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && removeOff.mutate(removing.id)}
      />
    </div>
  );
}
