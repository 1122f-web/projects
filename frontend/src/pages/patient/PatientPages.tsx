import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarCheck, CalendarClock, MessageSquare, Search, Star } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import type { Appointment, AppNotification, Conversation, Paged } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import { Card, CardBody, CardHeader, PageHeader, StatCard } from '../../components/ui/Card';
import { ButtonLink, Button } from '../../components/ui/Button';
import { EmptyState, ErrorState, Spinner } from '../../components/ui/Feedback';
import { AppointmentRow } from '../../components/appointments/AppointmentRow';
import { AccountSettings } from '../../components/profile/AccountSettings';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/Field';
import { StarInput, Stars } from '../../components/ui/Misc';
import { useToast } from '../../components/ui/Toast';
import { doctorName, formatDate, timeAgo } from '../../lib/format';

export function PatientDashboard() {
  const { me } = useAuth();
  const tz = me?.timezone ?? 'UTC';
  const upcoming = useQuery({ queryKey: ['appointments', 'upcoming', '', 0], queryFn: () => api.get<Paged<Appointment>>('/appointments?scope=upcoming&limit=5') });
  const past = useQuery({ queryKey: ['appointments', 'past', '', 0, 'dash'], queryFn: () => api.get<Paged<Appointment>>('/appointments?scope=past&limit=5') });
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: () => api.get<Conversation[]>('/conversations') });
  const notifications = useQuery({
    queryKey: ['notifications', 'list', 'all', 0],
    queryFn: () => api.get<{ total: number; unread: number; items: AppNotification[] }>('/notifications?limit=5'),
  });
  const unreadMessages = (conversations.data ?? []).reduce((n, c) => n + c.unread_count, 0);
  const toReview = (past.data?.items ?? []).filter((a) => a.status === 'completed' && !a.review);

  return (
    <div className="space-y-6">
      <PageHeader title={`Hello, ${me?.full_name.split(' ')[0] ?? ''}`} description="Here is an overview of your care." action={<ButtonLink to="/patient/find-doctors"><Search className="h-4 w-4" aria-hidden="true" /> Find a doctor</ButtonLink>} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Upcoming appointments" value={upcoming.data?.total ?? '–'} icon={<CalendarCheck className="h-5 w-5" />} />
        <StatCard label="Unread messages" value={conversations.isLoading ? '–' : unreadMessages} icon={<MessageSquare className="h-5 w-5" />} tone="teal" />
        <StatCard label="Unread notifications" value={notifications.data?.unread ?? '–'} icon={<Bell className="h-5 w-5" />} tone="amber" />
        <StatCard label="Visits to review" value={past.isLoading ? '–' : toReview.length} icon={<Star className="h-5 w-5" />} tone="slate" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Upcoming appointments" action={<Link to="/patient/appointments" className="text-sm font-medium text-brand-700 hover:underline">View all</Link>} />
          <CardBody className="p-2">
            {upcoming.isLoading ? (
              <Spinner />
            ) : upcoming.isError ? (
              <ErrorState error={upcoming.error} onRetry={() => upcoming.refetch()} />
            ) : upcoming.data!.items.length === 0 ? (
              <EmptyState icon={CalendarClock} title="No upcoming appointments" description="Book a visit with a verified doctor." action={<ButtonLink to="/patient/find-doctors">Find a doctor</ButtonLink>} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {upcoming.data!.items.map((a) => <AppointmentRow key={a.id} appt={a} viewer="patient" timeZone={tz} />)}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent notifications" action={<Link to="/patient/notifications" className="text-sm font-medium text-brand-700 hover:underline">All</Link>} />
          <CardBody>
            {notifications.isLoading ? (
              <Spinner />
            ) : (notifications.data?.items.length ?? 0) === 0 ? (
              <p className="text-sm text-slate-500">Nothing new.</p>
            ) : (
              <ul className="space-y-3">
                {notifications.data!.items.map((n) => (
                  <li key={n.id}>
                    <Link to={n.link ?? '/patient/notifications'} className="block rounded-md hover:bg-slate-50">
                      <p className={`text-sm ${n.read_at ? 'text-slate-700' : 'font-semibold'}`}>{n.title}</p>
                      <p className="text-xs text-slate-400">{timeAgo(n.created_at)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
      {toReview.length > 0 && (
        <Card>
          <CardHeader title="Share your feedback" description="Completed visits you have not reviewed yet." />
          <CardBody className="p-2">
            <ul className="divide-y divide-slate-100">
              {toReview.map((a) => <AppointmentRow key={a.id} appt={a} viewer="patient" timeZone={tz} />)}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

export function PatientProfilePage() {
  return (
    <div>
      <PageHeader title="My profile" description="Keep your details up to date. Only the doctors you book can see them." />
      <AccountSettings />
    </div>
  );
}

interface MyReview {
  id: string;
  appointment_id: string;
  rating: number;
  comment: string | null;
  status: string;
  created_at: string;
  doctor: { id: string; title: string; profile: { full_name: string; avatar_url: string | null } | null } | null;
  appointment: { starts_at: string } | null;
}

export function PatientReviewsPage() {
  const { me } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const reviews = useQuery({ queryKey: ['reviews', 'mine'], queryFn: () => api.get<MyReview[]>('/reviews/mine') });
  const completed = useQuery({
    queryKey: ['appointments', 'past', 'completed', 0],
    queryFn: () => api.get<Paged<Appointment>>('/appointments?scope=all&status=completed&limit=50'),
  });
  const [editing, setEditing] = useState<MyReview | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');

  const save = useMutation({
    mutationFn: () => api.patch(`/reviews/${editing!.id}`, { rating, comment: comment.trim() || null }),
    onSuccess: () => {
      toast.success('Review updated');
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
    },
    onError: (err) => toast.error('Could not update the review', errorMessage(err)),
  });

  const pending = (completed.data?.items ?? []).filter((a) => !a.review);

  return (
    <div className="space-y-6">
      <PageHeader title="Reviews" description="Rate your completed appointments to help other patients." />
      {pending.length > 0 && (
        <Card>
          <CardHeader title="Waiting for your review" />
          <CardBody className="p-2">
            <ul className="divide-y divide-slate-100">
              {pending.map((a) => <AppointmentRow key={a.id} appt={a} viewer="patient" timeZone={me?.timezone ?? 'UTC'} />)}
            </ul>
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Your reviews" />
        <CardBody>
          {reviews.isLoading ? (
            <Spinner />
          ) : reviews.isError ? (
            <ErrorState error={reviews.error} onRetry={() => reviews.refetch()} />
          ) : reviews.data!.length === 0 ? (
            <EmptyState icon={Star} title="No reviews yet" description="After a completed appointment you can review it from the appointment page." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {reviews.data!.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
                  <div>
                    <p className="font-medium">{doctorName(r.doctor ? { title: r.doctor.title, profile: r.doctor.profile } : null)}</p>
                    <p className="text-xs text-slate-500">Visit on {r.appointment ? formatDate(r.appointment.starts_at, me?.timezone) : '–'}</p>
                    <div className="mt-1">
                      <Stars value={r.rating} />
                    </div>
                    {r.comment && <p className="mt-1 text-sm text-slate-600">{r.comment}</p>}
                    {r.status === 'hidden' && <p className="mt-1 text-xs text-amber-700">Hidden by a moderator</p>}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(r);
                      setRating(r.rating);
                      setComment(r.comment ?? '');
                    }}
                  >
                    Edit
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit review"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Go back
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              Save review
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <StarInput value={rating} onChange={setRating} />
          <Textarea label="Comment" rows={4} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
