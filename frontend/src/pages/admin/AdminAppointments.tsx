import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { api, errorMessage, qs } from '../../lib/api';
import type { Appointment, Paged } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import { Card, PageHeader } from '../../components/ui/Card';
import { Select, Textarea, Input } from '../../components/ui/Field';
import { StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState, ErrorState, Spinner } from '../../components/ui/Feedback';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/Misc';
import { useToast } from '../../components/ui/Toast';
import { consultationLabel, doctorName, formatDateTime } from '../../lib/format';

const LIMIT = 25;

export function AdminAppointmentsPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = params.get('status') ?? '';
  const from = params.get('from') ?? '';
  const offset = Number(params.get('offset') ?? 0);
  const [target, setTarget] = useState<Appointment | null>(null);
  const [note, setNote] = useState('');

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('offset' in patch)) next.delete('offset');
    setParams(next, { replace: true });
  };

  const query = useQuery({
    queryKey: ['admin', 'appointments', status, from, offset],
    queryFn: () =>
      api.get<Paged<Appointment>>(`/admin/appointments${qs({ status, from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined, limit: LIMIT, offset })}`),
    placeholderData: keepPreviousData,
  });

  const cancel = useMutation({
    mutationFn: (a: Appointment) => api.post(`/admin/appointments/${a.id}/cancel`, { note: note.trim() }),
    onSuccess: () => {
      toast.success('Appointment cancelled', 'Both parties have been notified.');
      setTarget(null);
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => toast.error('Could not cancel', errorMessage(err)),
  });

  return (
    <div>
      <PageHeader title="Appointment management" description="Monitor appointment statuses across the platform." />
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-3">
        <Select label="Status" value={status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">All statuses</option>
          {['pending', 'confirmed', 'rescheduled', 'completed', 'cancelled', 'rejected'].map((s) => (
            <option key={s} value={s} className="capitalize">
              {s}
            </option>
          ))}
        </Select>
        <Input label="From date" type="date" value={from} onChange={(e) => set({ from: e.target.value })} />
      </Card>
      <Card className="overflow-hidden">
        {query.isLoading ? (
          <Spinner />
        ) : query.isError ? (
          <div className="p-4">
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </div>
        ) : query.data!.items.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={ClipboardList} title="No appointments match" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3">When</th>
                  <th scope="col" className="px-4 py-3">Patient</th>
                  <th scope="col" className="px-4 py-3">Doctor</th>
                  <th scope="col" className="px-4 py-3">Type</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {query.data!.items.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(a.starts_at, me?.timezone)}</td>
                    <td className="px-4 py-3">{a.patient?.full_name}</td>
                    <td className="px-4 py-3">{doctorName(a.doctor)}</td>
                    <td className="px-4 py-3">{consultationLabel(a.consultation_type)}</td>
                    <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                    <td className="px-4 py-3 text-right">
                      {['pending', 'confirmed', 'rescheduled'].includes(a.status) && (
                        <Button variant="outline" size="sm" className="text-red-700" onClick={() => { setNote(''); setTarget(a); }}>
                          Cancel
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pagination total={query.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={(o) => set({ offset: String(o) })} />
      <ConfirmDialog
        open={Boolean(target)}
        title="Cancel appointment"
        message="The patient and doctor will both be notified. This is recorded in the audit log."
        confirmLabel="Cancel appointment"
        tone="danger"
        loading={cancel.isPending}
        onClose={() => setTarget(null)}
        onConfirm={() => {
          if (note.trim().length < 3) return toast.error('Please give a reason');
          if (target) cancel.mutate(target);
        }}
      >
        <Textarea label="Reason (sent to both parties)" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} required />
      </ConfirmDialog>
    </div>
  );
}
