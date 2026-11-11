import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, CreditCard, Flag, Inbox, MessageSquare, ShieldCheck, Stethoscope, UserX, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { hasAccess } from '../../lib/permissions';
import { Card, CardBody, CardHeader, PageHeader, StatCard } from '../../components/ui/Card';
import { ErrorState, Spinner } from '../../components/ui/Feedback';
import { STATUS_LABELS } from '../../lib/format';
import type { AppointmentStatus } from '../../lib/types';

interface Stats {
  users: Record<string, number> | null;
  suspended_users: number;
  doctors_verified: number;
  pending_verifications: number;
  pending_plan_requests: number;
  appointments: Record<string, number>;
  appointments_today: number;
  appointments_last_30_days: number;
  messages_last_7_days: number;
  open_reports: number;
  new_contact_messages: number;
  reviews: number;
}

export function AdminDashboard() {
  const { me } = useAuth();
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api.get<Stats>('/admin/stats'), refetchInterval: 60_000 });
  if (stats.isLoading) return <Spinner label="Loading statistics" />;
  if (stats.isError) return <ErrorState error={stats.error} onRetry={() => stats.refetch()} />;
  const s = stats.data!;
  const totalAppointments = Object.values(s.appointments).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Administration" description="System overview and items that need attention." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Patients" value={s.users?.patient ?? 0} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Verified doctors" value={`${s.doctors_verified} / ${s.users?.doctor ?? 0}`} icon={<Stethoscope className="h-5 w-5" />} tone="teal" />
        <StatCard label="Appointments today" value={s.appointments_today} icon={<CalendarCheck className="h-5 w-5" />} tone="amber" />
        <StatCard label="Messages (7 days)" value={s.messages_last_7_days} icon={<MessageSquare className="h-5 w-5" />} tone="slate" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Needs attention" />
          <CardBody className="space-y-2">
            {(
              [
                { to: '/admin/verifications', label: 'Pending verifications', value: s.pending_verifications, icon: ShieldCheck, access: 'verifications' },
                { to: '/admin/plans', label: 'Payments to confirm', value: s.pending_plan_requests, icon: CreditCard, access: 'plans' },
                { to: '/admin/reviews', label: 'Open review reports', value: s.open_reports, icon: Flag, access: 'reviews' },
                { to: '/admin/activity?tab=contact', label: 'New contact messages', value: s.new_contact_messages, icon: Inbox, access: 'activity' },
                { to: '/admin/users?status=suspended', label: 'Suspended accounts', value: s.suspended_users, icon: UserX, access: 'users' },
              ] as const
            )
              .filter((i) => hasAccess(me, i.access))
              .map((i) => (
              <Link key={i.to} to={i.to} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50">
                <span className="flex items-center gap-2 text-sm text-slate-700">
                  <i.icon className="h-4 w-4 text-brand-600" aria-hidden="true" /> {i.label}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${i.value ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>{i.value}</span>
              </Link>
            ))}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Appointments by status" description={`${totalAppointments} total, ${s.appointments_last_30_days} booked in the last 30 days`} />
          <CardBody>
            <ul className="space-y-3">
              {(Object.keys(STATUS_LABELS) as AppointmentStatus[]).map((k) => {
                const n = s.appointments[k] ?? 0;
                const pct = totalAppointments ? Math.round((n / totalAppointments) * 100) : 0;
                return (
                  <li key={k}>
                    <div className="mb-1 flex justify-between text-sm">
                      <Link to={`/admin/appointments?status=${k}`} className="text-slate-700 hover:text-brand-700">
                        {STATUS_LABELS[k]}
                      </Link>
                      <span className="text-slate-500">{n}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100" role="presentation">
                      <div className="h-2 rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
