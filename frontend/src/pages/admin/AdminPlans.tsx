import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react';
import { api, errorMessage, qs } from '../../lib/api';
import type { PlanKind } from '../../lib/types';
import { usePublicSettings } from '../../hooks/useSettings';
import { Card, PageHeader } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Field';
import { EmptyState, ErrorState, Spinner } from '../../components/ui/Feedback';
import { Modal } from '../../components/ui/Modal';
import { Avatar, Pagination, Tabs } from '../../components/ui/Misc';
import { useToast } from '../../components/ui/Toast';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';

type Status = 'pending' | 'approved' | 'rejected';
interface PlanRequest {
  id: string;
  doctor_id: string;
  plan: PlanKind;
  periods: number;
  amount: number;
  payment_reference: string;
  status: Status;
  admin_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  doctor: { title: string; pro_until: string | null; featured_until: string | null; profile: { full_name: string; avatar_url: string | null } | null } | null;
}

const LIMIT = 20;
const tone = { pending: 'amber', approved: 'teal', rejected: 'red' } as const;
const planLabel = (p: PlanKind) => (p === 'pro' ? 'Pro plan' : 'Featured boost');
const duration = (r: Pick<PlanRequest, 'plan' | 'periods'>) =>
  r.plan === 'pro' ? `${r.periods} month${r.periods > 1 ? 's' : ''}` : `${r.periods} week${r.periods > 1 ? 's' : ''}`;

export function AdminPlansPage() {
  const { currency } = usePublicSettings();
  const [status, setStatus] = useState<Status>('pending');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<PlanRequest | null>(null);
  const query = useQuery({
    queryKey: ['admin', 'plan-requests', status, offset],
    queryFn: () => api.get<{ total: number; items: PlanRequest[] }>(`/admin/plan-requests${qs({ status, limit: LIMIT, offset })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader title="Plans & boosts" description="Confirm doctors' Pro plan and Featured boost payments. Approving starts the plan or extends the current period." />
      <Tabs<Status>
        label="Request status"
        value={status}
        onChange={(v) => {
          setStatus(v);
          setOffset(0);
        }}
        options={[
          { value: 'pending', label: 'Awaiting confirmation', count: status === 'pending' ? query.data?.total : undefined },
          { value: 'approved', label: 'Approved' },
          { value: 'rejected', label: 'Rejected' },
        ]}
      />
      <Card>
        {query.isLoading ? (
          <Spinner />
        ) : query.isError ? (
          <div className="p-4">
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </div>
        ) : query.data!.items.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={CreditCard} title={status === 'pending' ? 'No payments to confirm' : 'Nothing here yet'} />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {query.data!.items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
                <Avatar name={r.doctor?.profile?.full_name ?? 'Doctor'} url={r.doctor?.profile?.avatar_url} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {r.doctor?.title} {r.doctor?.profile?.full_name}
                  </p>
                  <p className="text-sm text-slate-500">
                    {planLabel(r.plan)} · {duration(r)} · {formatMoney(r.amount, currency)}
                  </p>
                  <p className="text-xs text-slate-400">
                    Ref <span className="font-mono">{r.payment_reference}</span> · Submitted {formatDateTime(r.created_at)}
                  </p>
                </div>
                <Badge tone={tone[r.status]}>{r.status}</Badge>
                <Button variant="outline" size="sm" onClick={() => setOpen(r)}>
                  {r.status === 'pending' ? 'Review' : 'View'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination total={query.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={setOffset} />
      {open && <ReviewModal request={open} currency={currency} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ReviewModal({ request: r, currency, onClose }: { request: PlanRequest; currency: string; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
  const decide = useMutation({
    mutationFn: (approve: boolean) => api.post(`/admin/plan-requests/${r.id}/decision`, { approve, notes: notes.trim() || undefined }),
    onSuccess: (_d, approve) => {
      toast.success(approve ? `${planLabel(r.plan)} activated` : 'Request rejected', 'The doctor has been notified.');
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
    onError: (err) => toast.error('Could not save the decision', errorMessage(err)),
  });
  const pending = r.status === 'pending';
  const currentUntil = r.plan === 'pro' ? r.doctor?.pro_until : r.doctor?.featured_until;

  return (
    <Modal
      open
      onClose={onClose}
      title={planLabel(r.plan)}
      footer={
        pending ? (
          <>
            <Button
              variant="outline"
              className="text-red-700"
              loading={decide.isPending && decide.variables === false}
              onClick={() => {
                if (notes.trim().length < 3) return toast.error('Add a reason so the doctor knows what to fix');
                decide.mutate(false);
              }}
            >
              Reject
            </Button>
            <Button variant="teal" loading={decide.isPending && decide.variables === true} onClick={() => decide.mutate(true)}>
              Payment received, activate
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="space-y-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Doctor</dt>
            <dd className="font-medium">
              {r.doctor?.title} {r.doctor?.profile?.full_name}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Duration</dt>
            <dd className="font-medium">{duration(r)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Amount due</dt>
            <dd className="font-medium">{formatMoney(r.amount, currency)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Payment reference</dt>
            <dd className="font-mono font-medium">{r.payment_reference}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500">Current period</dt>
            <dd>{currentUntil && new Date(currentUntil) > new Date() ? `Active until ${formatDate(currentUntil)}` : 'Not active'}</dd>
          </div>
        </dl>
        {pending ? (
          <Textarea label="Notes to the doctor (required when rejecting)" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        ) : (
          <div className="rounded-lg bg-slate-50 p-3">
            <p>
              <strong className="capitalize">{r.status}</strong> {r.reviewed_at && `on ${formatDateTime(r.reviewed_at)}`}
            </p>
            {r.admin_notes && <p className="mt-1 text-slate-600">{r.admin_notes}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
