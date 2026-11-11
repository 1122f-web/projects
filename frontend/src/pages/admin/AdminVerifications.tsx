import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { api, errorMessage, qs } from '../../lib/api';
import { Card, PageHeader } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Field';
import { EmptyState, ErrorState, Spinner } from '../../components/ui/Feedback';
import { Modal } from '../../components/ui/Modal';
import { Avatar, Pagination, Tabs } from '../../components/ui/Misc';
import { useToast } from '../../components/ui/Toast';
import { formatDateTime } from '../../lib/format';

type Status = 'pending' | 'approved' | 'rejected';
interface Request {
  id: string;
  doctor_id: string;
  license_number: string;
  issuing_authority: string;
  qualifications: string;
  payment_reference: string | null;
  status: Status;
  admin_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  doctor: { title: string; years_experience: number | null; city: string | null; clinic_name: string | null; profile: { full_name: string; avatar_url: string | null; phone: string | null } | null } | null;
}
interface RequestDetail extends Request {
  documents: { index: number; name: string; url: string | null }[];
  specialties: { specialty: { name: string } | null }[];
}

const LIMIT = 20;
const tone = { pending: 'amber', approved: 'teal', rejected: 'red' } as const;

export function AdminVerificationsPage() {
  const [status, setStatus] = useState<Status>('pending');
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['admin', 'verifications', status, offset],
    queryFn: () => api.get<{ total: number; items: Request[] }>(`/admin/verifications${qs({ status, limit: LIMIT, offset })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader title="Doctor verification" description="Check each doctor's licence and qualifications before they can be booked." />
      <Tabs<Status>
        label="Request status"
        value={status}
        onChange={(v) => {
          setStatus(v);
          setOffset(0);
        }}
        options={[
          { value: 'pending', label: 'Pending', count: status === 'pending' ? query.data?.total : undefined },
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
            <EmptyState icon={ShieldCheck} title={status === 'pending' ? 'No requests waiting' : 'Nothing here yet'} />
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
                    Licence {r.license_number} · {r.issuing_authority}
                  </p>
                  <p className="text-xs text-slate-400">Submitted {formatDateTime(r.created_at)}</p>
                </div>
                <Badge tone={tone[r.status]}>{r.status}</Badge>
                <Button variant="outline" size="sm" onClick={() => setOpenId(r.id)}>
                  {r.status === 'pending' ? 'Review' : 'View'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination total={query.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={setOffset} />
      {openId && <ReviewModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ReviewModal({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
  const detail = useQuery({ queryKey: ['admin', 'verification', id], queryFn: () => api.get<RequestDetail>(`/admin/verifications/${id}`) });
  const decide = useMutation({
    mutationFn: (approve: boolean) => api.post(`/admin/verifications/${id}/decision`, { approve, notes: notes.trim() || undefined }),
    onSuccess: (_d, approve) => {
      toast.success(approve ? 'Doctor verified' : 'Request rejected', 'The doctor has been notified.');
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
    onError: (err) => toast.error('Could not save the decision', errorMessage(err)),
  });
  const r = detail.data;
  const pending = r?.status === 'pending';

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Verification request"
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
              Approve and verify
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {detail.isLoading ? (
        <Spinner />
      ) : detail.isError ? (
        <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
      ) : (
        r && (
          <div className="space-y-5 text-sm">
            <div className="flex items-center gap-3">
              <Avatar name={r.doctor?.profile?.full_name ?? ''} url={r.doctor?.profile?.avatar_url} size="lg" />
              <div>
                <p className="font-semibold">
                  {r.doctor?.title} {r.doctor?.profile?.full_name}
                </p>
                <p className="text-slate-500">{r.specialties.map((s) => s.specialty?.name).filter(Boolean).join(', ') || 'No specialties chosen'}</p>
              </div>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Licence number</dt>
                <dd className="font-medium">{r.license_number}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Issuing authority</dt>
                <dd className="font-medium">{r.issuing_authority}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Experience</dt>
                <dd>{r.doctor?.years_experience ?? '–'} years</dd>
              </div>
              <div>
                <dt className="text-slate-500">Practice</dt>
                <dd>{[r.doctor?.clinic_name, r.doctor?.city].filter(Boolean).join(', ') || '–'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Verification fee payment reference</dt>
                <dd className={r.payment_reference ? 'font-mono font-medium' : 'text-amber-700'}>
                  {r.payment_reference ?? 'None given (submitted while the fee was off)'}
                </dd>
                {pending && r.payment_reference && <dd className="text-xs text-slate-500">Confirm this payment was received before approving.</dd>}
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Qualifications</dt>
                <dd className="whitespace-pre-line">{r.qualifications}</dd>
              </div>
            </dl>
            <div>
              <p className="mb-2 font-medium">Documents</p>
              <ul className="space-y-1">
                {r.documents.map((d) => (
                  <li key={d.index}>
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                        Document {d.index + 1} ({d.name}) <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="text-slate-400">Document {d.index + 1} unavailable</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-slate-400">Links expire after 10 minutes.</p>
            </div>
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
        )
      )}
    </Modal>
  );
}
