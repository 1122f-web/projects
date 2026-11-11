import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CalendarClock, Hourglass, MessageSquare, Star } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import type { Appointment, Conversation, Paged, PlanKind } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import { usePublicSettings } from '../../hooks/useSettings';
import { Card, CardBody, CardHeader, PageHeader, StatCard } from '../../components/ui/Card';
import { Alert, EmptyState, ErrorState, Spinner } from '../../components/ui/Feedback';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { AppointmentRow } from '../../components/appointments/AppointmentRow';
import { DoctorPricingPlans } from '../../components/DoctorPricingPlans';
import { ScheduleEditor } from '../../components/doctor/ScheduleEditor';
import { dateKey, formatMoney } from '../../lib/format';

interface DoctorProfileData {
  verification_status: string;
  rating_avg: number;
  rating_count: number;
  pro_until: string | null;
  featured_until: string | null;
  latest_verification: { status: string; admin_notes: string | null } | null;
}

interface PlanRequest {
  id: string;
  plan: PlanKind;
  periods: number;
  amount: number;
  payment_reference: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_notes: string | null;
  created_at: string;
}

export function DoctorDashboard() {
  const { me } = useAuth();
  const tz = me?.timezone ?? 'UTC';
  const profile = useQuery({ queryKey: ['doctor', 'profile'], queryFn: () => api.get<DoctorProfileData>('/doctor/profile') });
  const pending = useQuery({ queryKey: ['appointments', 'upcoming', 'pending', 0], queryFn: () => api.get<Paged<Appointment>>('/appointments?scope=upcoming&status=pending&limit=10') });
  const rescheduled = useQuery({ queryKey: ['appointments', 'upcoming', 'rescheduled', 0], queryFn: () => api.get<Paged<Appointment>>('/appointments?scope=upcoming&status=rescheduled&limit=10') });
  const upcoming = useQuery({ queryKey: ['appointments', 'upcoming', 'confirmed', 0], queryFn: () => api.get<Paged<Appointment>>('/appointments?scope=upcoming&status=confirmed&limit=50') });
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: () => api.get<Conversation[]>('/conversations') });

  const today = dateKey(new Date(), tz);
  const todays = (upcoming.data?.items ?? []).filter((a) => dateKey(a.starts_at, tz) === today);
  const requests = [...(pending.data?.items ?? []), ...(rescheduled.data?.items ?? []).filter((a) => a.rescheduled_by === a.patient_id)].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  );
  const unread = (conversations.data ?? []).reduce((n, c) => n + c.unread_count, 0);
  const verification = profile.data?.verification_status;

  return (
    <div className="space-y-6">
      <PageHeader title="Doctor dashboard" description="Your requests, schedule and messages at a glance." action={<ButtonLink to="/doctor/availability" variant="outline">Time off</ButtonLink>} />

      {verification && verification !== 'verified' && (
        <Alert
          variant={verification === 'rejected' ? 'error' : 'warning'}
          title={verification === 'pending' ? 'Verification in review' : verification === 'rejected' ? 'Verification not approved' : 'Get verified to receive bookings'}
          action={<Link to="/doctor/profile" className="text-sm font-semibold underline">Open profile</Link>}
        >
          {verification === 'pending'
            ? 'An administrator is reviewing your credentials. You will be notified when it is done.'
            : verification === 'rejected'
              ? profile.data?.latest_verification?.admin_notes ?? 'Update your details and submit again.'
              : 'Complete your professional profile and submit your licence for verification. Patients can only find you after approval.'}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Requests awaiting you" value={pending.isLoading ? '–' : requests.length} icon={<Hourglass className="h-5 w-5" />} tone="amber" />
        <StatCard label="Today's appointments" value={upcoming.isLoading ? '–' : todays.length} icon={<CalendarCheck className="h-5 w-5" />} />
        <StatCard label="Unread messages" value={conversations.isLoading ? '–' : unread} icon={<MessageSquare className="h-5 w-5" />} tone="teal" />
        <StatCard
          label="Rating"
          value={profile.data ? (profile.data.rating_count ? `${Number(profile.data.rating_avg).toFixed(1)} (${profile.data.rating_count})` : 'No reviews') : '–'}
          icon={<Star className="h-5 w-5" />}
          tone="slate"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Requests awaiting your response" action={<Link to="/doctor/appointments" className="text-sm font-medium text-brand-700 hover:underline">All appointments</Link>} />
          <CardBody className="p-2">
            {pending.isLoading ? (
              <Spinner />
            ) : pending.isError ? (
              <ErrorState error={pending.error} onRetry={() => pending.refetch()} />
            ) : requests.length === 0 ? (
              <EmptyState icon={Hourglass} title="No pending requests" description="New booking requests will appear here in real time." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {requests.map((a) => (
                  <AppointmentRow key={a.id} appt={a} viewer="doctor" timeZone={tz} />
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Upcoming confirmed appointments" />
          <CardBody className="p-2">
            {upcoming.isLoading ? (
              <Spinner />
            ) : (upcoming.data?.items.length ?? 0) === 0 ? (
              <EmptyState icon={CalendarClock} title="Nothing scheduled" description="Confirmed appointments will show here." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {upcoming.data!.items.slice(0, 8).map((a) => (
                  <AppointmentRow key={a.id} appt={a} viewer="doctor" timeZone={tz} />
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <ScheduleEditor />

      {profile.data && <PlansCard profile={profile.data} />}
    </div>
  );
}

function PlansCard({ profile }: { profile: DoctorProfileData }) {
  const settings = usePublicSettings();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<PlanKind | null>(null);
  const [periods, setPeriods] = useState('1');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string>();
  const planRequests = useQuery({ queryKey: ['doctor', 'plan-requests'], queryFn: () => api.get<PlanRequest[]>('/doctor/plan-requests') });

  const proPrice = settings.data?.pro_plan_monthly_price ?? 0;
  const featuredPrice = settings.data?.featured_boost_weekly_price ?? 0;
  const price = plan === 'pro' ? proPrice : featuredPrice;
  const unit = plan === 'pro' ? 'month' : 'week';
  const pendingPlans = (planRequests.data ?? []).filter((r) => r.status === 'pending').map((r) => r.plan);
  const lastRejected = planRequests.data?.find((r) => r.status === 'rejected' && !pendingPlans.includes(r.plan));

  const submit = useMutation({
    mutationFn: () => api.post('/doctor/plan-requests', { plan, periods: Number(periods), payment_reference: reference.trim() }),
    onSuccess: () => {
      toast.success('Request sent', 'Your plan starts as soon as the payment is confirmed.');
      setPlan(null);
      void queryClient.invalidateQueries({ queryKey: ['doctor', 'plan-requests'] });
    },
    onError: (err) => toast.error('Could not send the request', errorMessage(err)),
  });

  const open = (p: PlanKind) => {
    setPlan(p);
    setPeriods('1');
    setReference('');
    setError(undefined);
  };

  return (
    <Card>
      <CardHeader title="Subscriptions & promotion boosts" description="Raise your profile's visibility in search results." />
      <CardBody className="space-y-4">
        {lastRejected && (
          <Alert variant="error" title={`${lastRejected.plan === 'pro' ? 'Pro plan' : 'Featured boost'} request not approved`}>
            {lastRejected.admin_notes}
          </Alert>
        )}
        <DoctorPricingPlans
          currency={settings.currency}
          proPrice={proPrice}
          featuredPrice={featuredPrice}
          proUntil={profile.pro_until}
          featuredUntil={profile.featured_until}
          pending={pendingPlans}
          disabledReason={profile.verification_status !== 'verified' ? 'Plans and boosts become available once your profile is verified.' : undefined}
          onSelectPlan={open}
        />
      </CardBody>

      <Modal
        open={plan !== null}
        onClose={() => setPlan(null)}
        title={plan === 'pro' ? 'Upgrade to Pro' : 'Get Featured'}
        footer={
          <>
            <Button variant="outline" onClick={() => setPlan(null)}>
              Cancel
            </Button>
            <Button
              loading={submit.isPending}
              onClick={() => {
                if (reference.trim().length < 4) return setError('Enter the payment reference (at least 4 characters)');
                submit.mutate();
              }}
            >
              Submit payment reference
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <Select label={`Number of ${unit}s`} value={periods} onChange={(e) => setPeriods(e.target.value)}>
            {Array.from({ length: plan === 'pro' ? 12 : 8 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {unit}
                {n > 1 ? 's' : ''} · {formatMoney(n * price, settings.currency)}
              </option>
            ))}
          </Select>
          <div className="flex justify-between rounded-lg bg-slate-50 p-3 text-base">
            <span className="font-semibold">Amount to pay</span>
            <span className="font-bold text-teal-700">{formatMoney(Number(periods) * price, settings.currency)}</span>
          </div>
          {settings.data?.payment_instructions && <p className="text-slate-600">{settings.data.payment_instructions}</p>}
          <Input
            label="Payment reference"
            required
            placeholder="e.g. M-Pesa transaction code"
            maxLength={64}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            error={error}
          />
          <p className="text-xs text-slate-500">An administrator confirms the payment, then the plan starts (or extends your current period).</p>
        </div>
      </Modal>
    </Card>
  );
}