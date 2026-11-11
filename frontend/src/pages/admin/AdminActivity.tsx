import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileClock, Inbox } from 'lucide-react';
import { api, errorMessage, qs } from '../../lib/api';
import { Card, PageHeader } from '../../components/ui/Card';
import { Input, Select } from '../../components/ui/Field';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState, ErrorState, Spinner } from '../../components/ui/Feedback';
import { Pagination, Tabs } from '../../components/ui/Misc';
import { useToast } from '../../components/ui/Toast';
import { formatDateTime } from '../../lib/format';

interface AuditLog {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
  actor: { full_name: string; role: string } | null;
}
interface ContactMessage {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: 'new' | 'handled';
  created_at: string;
}

const LIMIT = 30;

export function AdminActivityPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'audit' | 'contact') ?? 'audit';
  return (
    <div>
      <PageHeader title="System activity" description="Audit trail of sensitive actions and messages from the Contact Us form." />
      <Tabs
        label="Activity type"
        value={tab}
        onChange={(v) => setParams(v === 'audit' ? {} : { tab: v }, { replace: true })}
        options={[
          { value: 'audit', label: 'Audit log' },
          { value: 'contact', label: 'Contact messages' },
        ]}
      />
      {tab === 'audit' ? <AuditLogView /> : <ContactView />}
    </div>
  );
}

function AuditLogView() {
  const [action, setAction] = useState('');
  const [applied, setApplied] = useState('');
  const [entity, setEntity] = useState('');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ['admin', 'audit', applied, entity, offset],
    queryFn: () => api.get<{ total: number; items: AuditLog[] }>(`/admin/audit-logs${qs({ action: applied, entity_type: entity, limit: LIMIT, offset })}`),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <Card className="mb-4 p-4">
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(action.trim());
            setOffset(0);
          }}
        >
          <Input label="Action contains" value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. suspended, verification" maxLength={100} />
          <Select label="Entity" value={entity} onChange={(e) => { setEntity(e.target.value); setOffset(0); }}>
            <option value="">All</option>
            <option value="profile">Accounts</option>
            <option value="doctor_verification_request">Verification</option>
            <option value="appointment">Appointments</option>
            <option value="review">Reviews</option>
            <option value="review_report">Reports</option>
            <option value="specialties">Specialties</option>
            <option value="system_settings">Settings</option>
          </Select>
          <div className="flex items-end">
            <Button type="submit" variant="secondary">
              Filter
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        {query.isLoading ? (
          <Spinner />
        ) : query.isError ? (
          <div className="p-4"><ErrorState error={query.error} onRetry={() => query.refetch()} /></div>
        ) : query.data!.items.length === 0 ? (
          <div className="p-4"><EmptyState icon={FileClock} title="No activity recorded" /></div>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {query.data!.items.map((l) => (
              <li key={l.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p>
                    <Badge tone="blue">{l.action.replace(/_/g, ' ')}</Badge>{' '}
                    <span className="text-slate-600">
                      by {l.actor ? `${l.actor.full_name} (${l.actor.role})` : 'system'} on {l.entity_type.replace(/_/g, ' ')}
                    </span>
                  </p>
                  <span className="text-xs text-slate-400">{formatDateTime(l.created_at)}</span>
                </div>
                <button type="button" className="mt-1 text-xs font-medium text-brand-700 hover:underline" onClick={() => setExpanded(expanded === l.id ? null : l.id)} aria-expanded={expanded === l.id}>
                  {expanded === l.id ? 'Hide details' : 'Show details'}
                </button>
                {expanded === l.id && (
                  <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify({ entity_id: l.entity_id, ...l.details }, null, 2)}</pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination total={query.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={setOffset} />
    </>
  );
}

function ContactView() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'new' | 'handled' | ''>('new');
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ['admin', 'contact', status, offset],
    queryFn: () => api.get<{ total: number; items: ContactMessage[] }>(`/admin/contact-messages${qs({ status, limit: LIMIT, offset })}`),
    placeholderData: keepPreviousData,
  });
  const mark = useMutation({
    mutationFn: (m: ContactMessage) => api.patch(`/admin/contact-messages/${m.id}`, { status: m.status === 'new' ? 'handled' : 'new' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin'] }),
    onError: (err) => toast.error('Could not update', errorMessage(err)),
  });
  return (
    <>
      <div className="mb-4 w-48">
        <Select label="Status" hideLabel value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setOffset(0); }}>
          <option value="new">New</option>
          <option value="handled">Handled</option>
          <option value="">All</option>
        </Select>
      </div>
      <Card>
        {query.isLoading ? (
          <Spinner />
        ) : query.isError ? (
          <div className="p-4"><ErrorState error={query.error} onRetry={() => query.refetch()} /></div>
        ) : query.data!.items.length === 0 ? (
          <div className="p-4"><EmptyState icon={Inbox} title="No messages" /></div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {query.data!.items.map((m) => (
              <li key={m.id} className="space-y-1 px-4 py-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{m.subject}</p>
                  <span className="text-xs text-slate-400">{formatDateTime(m.created_at)}</span>
                </div>
                <p className="text-slate-500">
                  {m.name} · <a className="text-brand-700 hover:underline" href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.subject}`)}`}>{m.email}</a>
                </p>
                <p className="whitespace-pre-line text-slate-700">{m.message}</p>
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => mark.mutate(m)}>
                    {m.status === 'new' ? 'Mark handled' : 'Mark as new'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination total={query.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={setOffset} />
    </>
  );
}
