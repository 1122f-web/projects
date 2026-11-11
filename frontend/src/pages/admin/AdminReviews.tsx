import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, MessageSquareWarning } from 'lucide-react';
import { api, errorMessage, qs } from '../../lib/api';
import { Card, PageHeader } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Checkbox, Textarea } from '../../components/ui/Field';
import { EmptyState, ErrorState, Spinner } from '../../components/ui/Feedback';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Pagination, Stars, Tabs } from '../../components/ui/Misc';
import { useToast } from '../../components/ui/Toast';
import { doctorName, formatDate } from '../../lib/format';

interface AdminReview {
  id: string;
  rating: number;
  comment: string | null;
  status: 'published' | 'hidden';
  moderation_note: string | null;
  created_at: string;
  patient: { full_name: string } | null;
  doctor: { title: string; profile: { full_name: string } | null } | null;
  reports?: { id: string; status: string }[];
}
interface Report {
  id: string;
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  resolution_note: string | null;
  created_at: string;
  reporter: { full_name: string; role: string } | null;
  review: AdminReview | null;
}

type Tab = 'open' | 'closed' | 'reviews';
const LIMIT = 20;

export function AdminReviewsPage() {
  const [tab, setTab] = useState<Tab>('open');
  const [offset, setOffset] = useState(0);
  const toast = useToast();
  const queryClient = useQueryClient();
  const [resolving, setResolving] = useState<{ report: Report; status: 'resolved' | 'dismissed' } | null>(null);
  const [hide, setHide] = useState(true);
  const [note, setNote] = useState('');
  const [moderating, setModerating] = useState<AdminReview | null>(null);

  const reports = useQuery({
    queryKey: ['admin', 'reports', tab, offset],
    queryFn: () => api.get<{ total: number; items: Report[] }>(`/admin/reports${qs({ status: tab === 'open' ? 'open' : undefined, limit: LIMIT, offset })}`),
    enabled: tab !== 'reviews',
    placeholderData: keepPreviousData,
  });
  const reviews = useQuery({
    queryKey: ['admin', 'reviews', offset],
    queryFn: () => api.get<{ total: number; items: AdminReview[] }>(`/admin/reviews${qs({ limit: LIMIT, offset })}`),
    enabled: tab === 'reviews',
    placeholderData: keepPreviousData,
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['admin'] });
  const resolve = useMutation({
    mutationFn: (r: { report: Report; status: 'resolved' | 'dismissed' }) =>
      api.post(`/admin/reports/${r.report.id}/resolve`, { status: r.status, note: note.trim() || undefined, hide_review: r.status === 'resolved' && hide }),
    onSuccess: () => {
      toast.success('Report closed');
      setResolving(null);
      setNote('');
      invalidate();
    },
    onError: (err) => toast.error('Could not update the report', errorMessage(err)),
  });
  const moderate = useMutation({
    mutationFn: (r: AdminReview) => api.post(`/admin/reviews/${r.id}/moderate`, { status: r.status === 'published' ? 'hidden' : 'published', note: note.trim() || undefined }),
    onSuccess: () => {
      toast.success('Review updated');
      setModerating(null);
      setNote('');
      invalidate();
    },
    onError: (err) => toast.error('Could not update the review', errorMessage(err)),
  });

  const ReviewBlock = ({ r }: { r: AdminReview }) => (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Stars value={r.rating} />
        <span className="text-sm text-slate-600">
          by {r.patient?.full_name} for {doctorName(r.doctor)}
        </span>
        {r.status === 'hidden' ? <Badge tone="red">Hidden</Badge> : <Badge tone="teal">Published</Badge>}
      </div>
      {r.comment ? <p className="mt-2 text-sm text-slate-700">{r.comment}</p> : <p className="mt-2 text-sm italic text-slate-400">No comment</p>}
    </div>
  );

  const list = tab === 'reviews' ? reviews : reports;
  return (
    <div>
      <PageHeader title="Review moderation" description="Handle reported reviews and inappropriate content." />
      <Tabs<Tab>
        label="Moderation view"
        value={tab}
        onChange={(v) => {
          setTab(v);
          setOffset(0);
        }}
        options={[
          { value: 'open', label: 'Open reports', count: tab === 'open' ? reports.data?.total : undefined },
          { value: 'closed', label: 'All reports' },
          { value: 'reviews', label: 'All reviews' },
        ]}
      />
      <Card>
        {list.isLoading ? (
          <Spinner />
        ) : list.isError ? (
          <div className="p-4">
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          </div>
        ) : tab === 'reviews' ? (
          reviews.data!.items.length === 0 ? (
            <div className="p-4"><EmptyState icon={MessageSquareWarning} title="No reviews yet" /></div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {reviews.data!.items.map((r) => (
                <li key={r.id} className="space-y-2 px-4 py-4">
                  <ReviewBlock r={r} />
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>
                      {formatDate(r.created_at)}
                      {r.reports?.length ? ` · ${r.reports.length} report(s)` : ''}
                    </span>
                    <Button variant="outline" size="sm" onClick={() => { setNote(''); setModerating(r); }}>
                      {r.status === 'published' ? 'Hide review' : 'Publish again'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : reports.data!.items.length === 0 ? (
          <div className="p-4"><EmptyState icon={Flag} title={tab === 'open' ? 'No open reports' : 'No reports yet'} /></div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {reports.data!.items.map((rep) => (
              <li key={rep.id} className="space-y-2 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm">
                    <span className="font-medium">{rep.reporter?.full_name}</span> <span className="text-slate-500">({rep.reporter?.role}) reported on {formatDate(rep.created_at)}:</span>
                  </p>
                  <Badge tone={rep.status === 'open' ? 'amber' : rep.status === 'resolved' ? 'teal' : 'gray'}>{rep.status}</Badge>
                </div>
                <p className="text-sm text-slate-700">“{rep.reason}”</p>
                {rep.review && <ReviewBlock r={rep.review} />}
                {rep.resolution_note && <p className="text-xs text-slate-500">Resolution: {rep.resolution_note}</p>}
                {rep.status === 'open' && (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setNote(''); setResolving({ report: rep, status: 'dismissed' }); }}>
                      Dismiss
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => { setNote(''); setHide(true); setResolving({ report: rep, status: 'resolved' }); }}>
                      Take action
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination total={list.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={setOffset} />

      <ConfirmDialog
        open={Boolean(resolving)}
        title={resolving?.status === 'resolved' ? 'Resolve report' : 'Dismiss report'}
        message={resolving?.status === 'resolved' ? 'Mark the report as valid. You can hide the review at the same time.' : 'Close the report without changing the review.'}
        confirmLabel={resolving?.status === 'resolved' ? 'Resolve' : 'Dismiss'}
        tone={resolving?.status === 'resolved' ? 'danger' : 'primary'}
        loading={resolve.isPending}
        onClose={() => setResolving(null)}
        onConfirm={() => resolving && resolve.mutate(resolving)}
      >
        {resolving?.status === 'resolved' && <Checkbox label="Hide the review from the public" checked={hide} onChange={(e) => setHide(e.target.checked)} />}
        <Textarea label="Note (optional, kept in the audit log)" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmDialog>
      <ConfirmDialog
        open={Boolean(moderating)}
        title={moderating?.status === 'published' ? 'Hide this review?' : 'Publish this review again?'}
        message={moderating?.status === 'published' ? 'The review will no longer appear on the doctor profile and will not count toward the rating.' : 'The review will be visible again.'}
        confirmLabel={moderating?.status === 'published' ? 'Hide review' : 'Publish'}
        tone={moderating?.status === 'published' ? 'danger' : 'teal'}
        loading={moderate.isPending}
        onClose={() => setModerating(null)}
        onConfirm={() => moderating && moderate.mutate(moderating)}
      >
        <Textarea label="Note (optional)" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
