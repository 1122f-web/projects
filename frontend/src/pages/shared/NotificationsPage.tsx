import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, CalendarCheck, MessageSquare, ShieldCheck, Star, Trash2 } from 'lucide-react';
import { api, errorMessage, qs } from '../../lib/api';
import type { AppNotification } from '../../lib/types';
import { Card, PageHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { EmptyState, ErrorState, Spinner } from '../../components/ui/Feedback';
import { Pagination, Tabs } from '../../components/ui/Misc';
import { useToast } from '../../components/ui/Toast';
import { timeAgo } from '../../lib/format';

const LIMIT = 20;

function iconFor(type: string) {
  if (type.startsWith('appointment')) return CalendarCheck;
  if (type === 'new_message') return MessageSquare;
  if (type.startsWith('verification')) return ShieldCheck;
  if (type === 'review_received') return Star;
  return Bell;
}

export function NotificationsPage() {
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [offset, setOffset] = useState(0);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['notifications', 'list', tab, offset],
    queryFn: () =>
      api.get<{ total: number; unread: number; items: AppNotification[] }>(`/notifications${qs({ unread_only: tab === 'unread', limit: LIMIT, offset })}`),
    placeholderData: keepPreviousData,
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.post('/notifications/read', ids ? { ids } : {}),
    onSuccess: invalidate,
    onError: (err) => toast.error('Could not update notifications', errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/notifications/${id}`),
    onSuccess: invalidate,
    onError: (err) => toast.error('Could not delete the notification', errorMessage(err)),
  });

  const open = (n: AppNotification) => {
    if (!n.read_at) markRead.mutate([n.id]);
    if (n.link) navigate(n.link);
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Appointment updates, messages and account alerts."
        action={
          <Button variant="outline" onClick={() => markRead.mutate(undefined)} disabled={!query.data?.unread} loading={markRead.isPending && !markRead.variables}>
            Mark all as read
          </Button>
        }
      />
      <Tabs
        label="Filter notifications"
        value={tab}
        onChange={(v) => {
          setTab(v);
          setOffset(0);
        }}
        options={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: 'Unread', count: query.data?.unread },
        ]}
      />
      <Card>
        {query.isLoading ? (
          <Spinner label="Loading notifications" />
        ) : query.isError ? (
          <div className="p-4">
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </div>
        ) : query.data!.items.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={BellOff} title={tab === 'unread' ? 'You are all caught up' : 'No notifications yet'} />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {query.data!.items.map((n) => {
              const Icon = iconFor(n.type);
              return (
                <li key={n.id} className={`flex items-start gap-3 px-4 py-3 ${n.read_at ? '' : 'bg-brand-50/50'}`}>
                  <div className={`mt-0.5 rounded-full p-2 ${n.read_at ? 'bg-slate-100 text-slate-500' : 'bg-brand-100 text-brand-700'}`}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <button type="button" onClick={() => open(n)} className="min-w-0 flex-1 text-left">
                    <p className={`text-sm ${n.read_at ? 'text-slate-700' : 'font-semibold text-slate-900'}`}>
                      {n.title}
                      {!n.read_at && <span className="sr-only"> (unread)</span>}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>
                    <p className="mt-1 text-xs text-slate-400">{timeAgo(n.updated_at ?? n.created_at)}</p>
                  </button>
                  <div className="flex shrink-0 gap-1">
                    {!n.read_at && (
                      <button type="button" onClick={() => markRead.mutate([n.id])} className="rounded px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">
                        Mark read
                      </button>
                    )}
                    <button type="button" onClick={() => remove.mutate(n.id)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete notification: ${n.title}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Pagination total={query.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={setOffset} />
    </div>
  );
}
