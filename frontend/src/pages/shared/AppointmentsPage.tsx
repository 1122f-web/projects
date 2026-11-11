import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarX2 } from 'lucide-react';
import { api, qs } from '../../lib/api';
import type { Appointment, AppointmentStatus, Paged } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import { Card, PageHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, Spinner } from '../../components/ui/Feedback';
import { Pagination, Tabs } from '../../components/ui/Misc';
import { Select } from '../../components/ui/Field';
import { ButtonLink } from '../../components/ui/Button';
import { AppointmentRow } from '../../components/appointments/AppointmentRow';

type Scope = 'upcoming' | 'past' | 'all';
const LIMIT = 15;

export function AppointmentsPage({ viewer }: { viewer: 'patient' | 'doctor' }) {
  const { me } = useAuth();
  const [scope, setScope] = useState<Scope>('upcoming');
  const [status, setStatus] = useState<AppointmentStatus | ''>('');
  const [offset, setOffset] = useState(0);

  const query = useQuery({
    queryKey: ['appointments', scope, status, offset],
    queryFn: () => api.get<Paged<Appointment>>(`/appointments${qs({ scope, status, limit: LIMIT, offset })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <PageHeader
        title={viewer === 'patient' ? 'My appointments' : 'Appointment management'}
        description={viewer === 'patient' ? 'Upcoming visits and your appointment history.' : 'Review requests, manage your schedule and patient visits.'}
        action={viewer === 'patient' ? <ButtonLink to="/patient/find-doctors">Book new appointment</ButtonLink> : undefined}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs<Scope>
          label="Appointment period"
          value={scope}
          onChange={(v) => {
            setScope(v);
            setOffset(0);
          }}
          options={[
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'past', label: 'Past and closed' },
            { value: 'all', label: 'All' },
          ]}
        />
        <div className="mb-4 w-48">
          <Select
            label="Status"
            hideLabel
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as AppointmentStatus | '');
              setOffset(0);
            }}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="rescheduled">Rescheduled</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="rejected">Rejected</option>
          </Select>
        </div>
      </div>
      <Card className="p-2">
        {query.isLoading ? (
          <Spinner label="Loading appointments" />
        ) : query.isError ? (
          <div className="p-3">
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </div>
        ) : query.data!.items.length === 0 ? (
          <div className="p-3">
            <EmptyState
              icon={CalendarX2}
              title="No appointments here"
              description={viewer === 'patient' ? 'Find a doctor and book your first appointment.' : 'New requests from patients will appear here.'}
              action={viewer === 'patient' ? <ButtonLink to="/patient/find-doctors">Find a doctor</ButtonLink> : undefined}
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {query.data!.items.map((a) => (
              <AppointmentRow key={a.id} appt={a} viewer={viewer} timeZone={me?.timezone ?? 'UTC'} />
            ))}
          </ul>
        )}
      </Card>
      <Pagination total={query.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={setOffset} />
    </div>
  );
}
