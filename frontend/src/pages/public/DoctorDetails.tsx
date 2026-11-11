import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, CalendarDays, Clock, Flag, GraduationCap, Languages, MapPin, ShieldCheck, Video } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import type { DoctorPublic } from '../../lib/types';
import { usePublicSettings } from '../../hooks/useSettings';
import { useAuth } from '../../context/AuthContext';
import { Avatar, Stars } from '../../components/ui/Misc';
import { Badge } from '../../components/ui/Badge';
import { ButtonLink } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, PageLoader } from '../../components/ui/Feedback';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { DAY_NAMES, formatDate, formatMoney } from '../../lib/format';

export function DoctorDetailsPage({ backTo = '/doctors' }: { backTo?: string }) {
  const { id = '' } = useParams();
  const { me } = useAuth();
  const { currency } = usePublicSettings();
  const toast = useToast();
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const query = useQuery({ queryKey: ['doctor', id], queryFn: () => api.get<DoctorPublic>(`/doctors/${id}`) });
  const report = useMutation({
    mutationFn: () => api.post(`/reviews/${reporting}/report`, { reason }),
    onSuccess: () => {
      toast.success('Review reported', 'An administrator will look at it.');
      setReporting(null);
      setReason('');
    },
    onError: (err) => toast.error('Could not report the review', errorMessage(err)),
  });

  if (query.isLoading) return <PageLoader />;
  if (query.isError)
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </div>
    );
  const d = query.data!;
  const name = `${d.title} ${d.full_name}`;
  const bookPath = `/patient/book/${d.id}`;

  let bookAction;
  if (!d.is_accepting_patients) {
    bookAction = <p className="text-sm text-slate-500">This doctor is not accepting new bookings at the moment.</p>;
  } else if (!me) {
    bookAction = (
      <ButtonLink to={`/login?next=${encodeURIComponent(bookPath)}`} size="lg" className="w-full">
        Sign in to book
      </ButtonLink>
    );
  } else if (me.role === 'patient') {
    bookAction = (
      <ButtonLink to={bookPath} size="lg" className="w-full">
        Book an appointment
      </ButtonLink>
    );
  } else {
    bookAction = <p className="text-sm text-slate-500">Bookings are made from patient accounts.</p>;
  }

  const byDay = DAY_NAMES.map((day, i) => ({ day, blocks: d.availability.filter((a) => a.day_of_week === i) }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link to={backTo} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to doctors
      </Link>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardBody className="flex flex-col gap-5 sm:flex-row">
              <Avatar name={d.full_name} url={d.avatar_url} size="xl" />
              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold">{name}</h1>
                  <Badge tone="teal">
                    <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" /> Verified
                  </Badge>
                </div>
                <p className="text-slate-600">{d.specialties.map((s) => s.name).join(' · ')}</p>
                {d.rating_count > 0 ? <Stars value={d.rating_avg} count={d.rating_count} size="md" /> : <p className="text-sm text-slate-400">No reviews yet</p>}
                <ul className="grid gap-2 pt-2 text-sm text-slate-600 sm:grid-cols-2">
                  {d.years_experience !== null && (
                    <li className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" /> {d.years_experience} years experience
                    </li>
                  )}
                  {d.languages.length > 0 && (
                    <li className="flex items-center gap-2">
                      <Languages className="h-4 w-4 text-slate-400" aria-hidden="true" /> {d.languages.join(', ')}
                    </li>
                  )}
                  {(d.clinic_name || d.city) && (
                    <li className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-slate-400" aria-hidden="true" /> {[d.clinic_name, d.clinic_address ?? d.city].filter(Boolean).join(', ')}
                    </li>
                  )}
                  <li className="flex items-center gap-2">
                    {d.offers_online && <Video className="h-4 w-4 text-brand-600" aria-label="Online" />}
                    {d.offers_in_person && <Building2 className="h-4 w-4 text-teal-600" aria-label="In person" />}
                    {[d.offers_online && 'Online', d.offers_in_person && 'In person'].filter(Boolean).join(' and ')}
                  </li>
                </ul>
              </div>
            </CardBody>
          </Card>

          {d.bio && (
            <Card>
              <CardHeader title="About" />
              <CardBody>
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{d.bio}</p>
              </CardBody>
            </Card>
          )}

          {d.qualifications && (
            <Card>
              <CardHeader title="Qualifications" />
              <CardBody className="flex gap-3">
                <GraduationCap className="h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
                <p className="whitespace-pre-line text-sm text-slate-700">{d.qualifications}</p>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Patient reviews" description={d.rating_count ? `${Number(d.rating_avg).toFixed(1)} average from ${d.rating_count} reviews` : undefined} />
            <CardBody>
              {d.reviews.length === 0 ? (
                <EmptyState icon={Flag} title="No reviews yet" description="Reviews appear after completed appointments." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {d.reviews.map((r) => (
                    <li key={r.id} className="py-4 first:pt-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Stars value={r.rating} />
                          <span className="text-sm font-medium text-slate-700">{r.patient_name}</span>
                        </div>
                        <span className="text-xs text-slate-400">{formatDate(r.created_at)}</span>
                      </div>
                      {r.comment && <p className="mt-2 text-sm text-slate-600">{r.comment}</p>}
                      {me && (
                        <button type="button" onClick={() => setReporting(r.id)} className="mt-2 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-600">
                          <Flag className="h-3 w-3" aria-hidden="true" /> Report
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="lg:sticky lg:top-24">
            <CardBody className="space-y-4">
              <div>
                <p className="text-sm text-slate-500">Consultation fee</p>
                <p className="text-2xl font-bold">{formatMoney(d.consultation_fee, currency)}</p>
                <p className="text-xs text-slate-500">{d.slot_duration_minutes}-minute appointments</p>
              </div>
              {bookAction}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Weekly hours" description={`Times in ${d.timezone}`} />
            <CardBody>
              {d.availability.length === 0 ? (
                <p className="text-sm text-slate-500">This doctor has not published working hours yet.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {byDay.map(({ day, blocks }) => (
                    <li key={day} className="flex justify-between gap-2">
                      <span className="flex items-center gap-2 text-slate-600">
                        <CalendarDays className="h-4 w-4 text-slate-400" aria-hidden="true" /> {day}
                      </span>
                      <span className={blocks.length ? 'text-slate-900' : 'text-slate-400'}>
                        {blocks.length ? blocks.map((b) => `${b.start_time}–${b.end_time}`).join(', ') : 'Closed'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(reporting)}
        title="Report this review"
        message="Tell us why this review is inappropriate. An administrator will review it."
        confirmLabel="Submit report"
        tone="danger"
        loading={report.isPending}
        onClose={() => setReporting(null)}
        onConfirm={() => {
          if (reason.trim().length < 3) {
            toast.error('Please give a reason (at least 3 characters)');
            return;
          }
          report.mutate();
        }}
      >
        <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} />
      </ConfirmDialog>
    </div>
  );
}
