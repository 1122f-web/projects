import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, Video } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import type { Appointment, ConsultationType, DoctorPublic, Slot } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import { usePublicSettings } from '../../hooks/useSettings';
import { SlotPicker } from '../../components/appointments/SlotPicker';
import { BookingFeeSummary } from '../../components/BookingFeeSummary';
import { Card, CardBody, CardHeader, PageHeader } from '../../components/ui/Card';
import { Textarea } from '../../components/ui/Field';
import { Button } from '../../components/ui/Button';
import { Alert, ErrorState, PageLoader } from '../../components/ui/Feedback';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Avatar } from '../../components/ui/Misc';
import { useToast } from '../../components/ui/Toast';
import { consultationLabel, formatDateTime } from '../../lib/format';

export function BookAppointmentPage() {
  const { doctorId = '' } = useParams();
  const { me } = useAuth();
  const tz = me?.timezone ?? 'UTC';
  const settings = usePublicSettings();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const doctor = useQuery({ queryKey: ['doctor', doctorId], queryFn: () => api.get<DoctorPublic>(`/doctors/${doctorId}`) });
  const [slot, setSlot] = useState<Slot | null>(null);
  const [type, setType] = useState<ConsultationType | null>(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);

  const book = useMutation({
    mutationFn: () =>
      api.post<Appointment>('/appointments', { doctor_id: doctorId, starts_at: slot!.starts_at, consultation_type: type, reason: reason.trim() }),
    onSuccess: (appt) => {
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast.success('Appointment requested', 'The doctor will confirm it shortly.');
      navigate(`/patient/appointments/${appt.id}`, { replace: true });
    },
    onError: (err) => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['slots', doctorId] });
      toast.error('Booking failed', errorMessage(err));
    },
  });

  if (doctor.isLoading) return <PageLoader />;
  if (doctor.isError) return <ErrorState error={doctor.error} onRetry={() => doctor.refetch()} />;
  const d = doctor.data!;
  const serviceFee = settings.data?.platform_service_fee ?? 0;
  const types: ConsultationType[] = [...(d.offers_online ? ['online' as const] : []), ...(d.offers_in_person ? ['in_person' as const] : [])];
  const chosenType = type ?? (types.length === 1 ? types[0]! : null);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!slot) e.slot = 'Choose a date and time';
    if (!chosenType) e.type = 'Choose a consultation type';
    if (reason.trim().length < 3) e.reason = 'Describe the reason for your visit (at least 3 characters)';
    if (reason.length > 1000) e.reason = 'Keep the reason under 1000 characters';
    setErrors(e);
    if (!type && chosenType) setType(chosenType);
    return Object.keys(e).length === 0;
  };

  return (
    <div>
      <Link to={`/patient/find-doctors/${d.id}`} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Doctor profile
      </Link>
      <PageHeader title="Book an appointment" description="Choose a time, the type of consultation and tell the doctor why you are coming." />
      {!d.is_accepting_patients && <Alert variant="warning">This doctor is not accepting new bookings at the moment.</Alert>}
      {me && !me.can_book_appointments && <Alert variant="error">Booking is disabled for your account. Please contact support.</Alert>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="1. Date and time" />
            <CardBody>
              <SlotPicker doctorId={d.id} timeZone={tz} value={slot?.starts_at ?? null} onChange={setSlot} />
              {errors.slot && <p role="alert" className="mt-2 text-sm text-red-600">{errors.slot}</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="2. Consultation type" />
            <CardBody>
              <fieldset>
                <legend className="sr-only">Consultation type</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {types.map((t) => (
                    <label
                      key={t}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 ${
                        chosenType === t ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:border-brand-300'
                      }`}
                    >
                      <input type="radio" name="type" value={t} checked={chosenType === t} onChange={() => setType(t)} className="h-4 w-4 text-brand-600" />
                      {t === 'online' ? <Video className="h-5 w-5 text-brand-600" aria-hidden="true" /> : <Building2 className="h-5 w-5 text-teal-600" aria-hidden="true" />}
                      <span>
                        <span className="block font-medium">{consultationLabel(t)}</span>
                        <span className="text-xs text-slate-500">
                          {t === 'online' ? 'Video or phone consultation; details follow in Messages' : d.clinic_address ?? d.clinic_name ?? 'At the clinic'}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {errors.type && <p role="alert" className="mt-2 text-sm text-red-600">{errors.type}</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="3. Reason for visit" description="Only the doctor can see this." />
            <CardBody>
              <Textarea
                label="Reason for visit"
                hideLabel
                required
                rows={4}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="For example: persistent cough for two weeks, follow-up on blood test results"
                error={errors.reason}
                hint={`${reason.length}/1000`}
              />
            </CardBody>
          </Card>
        </div>

        <Card className="h-fit lg:sticky lg:top-24">
          <CardHeader title="Summary" />
          <CardBody className="space-y-4 text-sm">
            <div className="flex items-center gap-3">
              <Avatar name={d.full_name} url={d.avatar_url} />
              <div>
                <p className="font-semibold">
                  {d.title} {d.full_name}
                </p>
                <p className="text-slate-500">{d.specialties.map((s) => s.name).join(', ')}</p>
              </div>
            </div>
            <dl className="space-y-2">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">When</dt>
                <dd className="text-right font-medium">{slot ? formatDateTime(slot.starts_at, tz) : 'Not selected'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Type</dt>
                <dd className="font-medium">{chosenType ? consultationLabel(chosenType) : 'Not selected'}</dd>
              </div>
            </dl>
            <BookingFeeSummary consultationFee={d.consultation_fee} serviceFee={serviceFee} currency={settings.currency} />
            <p className="text-xs text-slate-500">
              You can cancel or reschedule a confirmed appointment up to {settings.data?.cancellation_window_hours ?? 12} hours before it starts.
            </p>
            <Button className="w-full" size="lg" disabled={!d.is_accepting_patients || !me?.can_book_appointments} onClick={() => validate() && setConfirming(true)}>
              Review and confirm
            </Button>
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Confirm your booking"
        confirmLabel="Book appointment"
        loading={book.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => book.mutate()}
        message={
          slot && chosenType ? (
            <>
              Request a <strong>{consultationLabel(chosenType).toLowerCase()}</strong> appointment with{' '}
              <strong>
                {d.title} {d.full_name}
              </strong>{' '}
              on <strong>{formatDateTime(slot.starts_at, tz)}</strong>?
              <div className="mt-3">
                <BookingFeeSummary consultationFee={d.consultation_fee} serviceFee={serviceFee} currency={settings.currency} />
              </div>
            </>
          ) : null
        }
      />
    </div>
  );
}
