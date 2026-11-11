import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, CalendarClock, CheckCircle2, FileText, MessageSquare, Star, Video, XCircle } from 'lucide-react';
import { VideoConsultation } from '../../components/VideoConsultation';
import SharedDocuments from '../../components/SharedDocuments';
import { api, errorMessage } from '../../lib/api';
import type { AppointmentDetail, AppointmentStatus, Slot } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import { usePublicSettings } from '../../hooks/useSettings';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { StatusBadge } from '../../components/ui/Badge';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Alert, ErrorState, PageLoader } from '../../components/ui/Feedback';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/Field';
import { Avatar, StarInput, Stars } from '../../components/ui/Misc';
import { SlotPicker } from '../../components/appointments/SlotPicker';
import { useToast } from '../../components/ui/Toast';
import { consultationLabel, doctorName, formatDate, formatDateTime, formatMoney } from '../../lib/format';

const GENDER_LABELS: Record<string, string> = { female: 'Female', male: 'Male', other: 'Other', prefer_not_to_say: 'Prefers not to say' };

type Action = { status: Exclude<AppointmentStatus, 'pending' | 'rescheduled'>; title: string; confirmLabel: string; tone: 'primary' | 'danger' | 'teal'; noteLabel?: string; noteRequired?: boolean; message: string };

interface AppointmentDetailPageProps {
  viewer: 'patient' | 'doctor';
}

export function AppointmentDetailPage({ viewer }: AppointmentDetailPageProps) {
  const { id = '' } = useParams<{ id: string }>();
  const { me } = useAuth();
  const tz = me?.timezone ?? 'UTC';
  const settings = usePublicSettings();
  const toast = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => api.get<AppointmentDetail>(`/appointments/${id}`),
    enabled: Boolean(id),
  });
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState('');
  const [rescheduling, setRescheduling] = useState(false);
  const [newSlot, setNewSlot] = useState<Slot | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (query.data) setNotes(query.data.doctor_notes ?? '');
  }, [query.data]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['appointment', id] });
    void queryClient.invalidateQueries({ queryKey: ['appointments'] });
  };

  const changeStatus = useMutation({
    mutationFn: (a: Action) => api.post(`/appointments/${id}/status`, { status: a.status, note: note.trim() || undefined }),
    onSuccess: (_d, a) => {
      toast.success(`Appointment ${a.status}`);
      setAction(null);
      setNote('');
      refresh();
    },
    onError: (err) => toast.error('Could not update the appointment', errorMessage(err)),
  });

  const reschedule = useMutation({
    mutationFn: () => {
      if (!newSlot) throw new Error('Choose a new appointment time first.');
      return api.post(`/appointments/${id}/reschedule`, { starts_at: newSlot.starts_at, note: note.trim() || undefined });
    },
    onSuccess: () => {
      toast.success('Appointment rescheduled', viewer === 'patient' ? 'The doctor will confirm the new time.' : 'The patient has been asked to confirm.');
      setRescheduling(false);
      setNewSlot(null);
      setNote('');
      refresh();
    },
    onError: (err) => {
      toast.error('Could not reschedule', errorMessage(err));
      void queryClient.invalidateQueries({ queryKey: ['slots'] });
    },
  });

  const review = useMutation({
    mutationFn: () => api.post('/reviews', { appointment_id: id, rating, comment: comment.trim() || undefined }),
    onSuccess: () => {
      toast.success('Thank you for your review');
      setReviewing(false);
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['reviews'] });
    },
    onError: (err) => toast.error('Could not save your review', errorMessage(err)),
  });

  const saveNotes = useMutation({
    mutationFn: () => api.put(`/appointments/${id}/notes`, { notes: notes.trim() || null }),
    onSuccess: () => {
      toast.success('Notes saved');
      refresh();
    },
    onError: (err) => toast.error('Could not save notes', errorMessage(err)),
  });

  if (query.isLoading) return <PageLoader />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const a = query.data!;

  const now = Date.now();
  const future = new Date(a.starts_at).getTime() > now;
  const active = ['pending', 'confirmed', 'rescheduled'].includes(a.status);
  const windowHours = settings.data?.cancellation_window_hours ?? 12;
  const insideWindow = new Date(a.starts_at).getTime() - now < windowHours * 3600_000;
  const patientLocked = viewer === 'patient' && ['confirmed', 'rescheduled'].includes(a.status) && insideWindow;

  const actions: Action[] = [];
  if (viewer === 'doctor') {
    const awaitingDoctor = a.status === 'pending' || (a.status === 'rescheduled' && a.rescheduled_by !== a.doctor_id);
    if (future && awaitingDoctor) {
      actions.push({ status: 'confirmed', title: 'Confirm appointment', confirmLabel: 'Confirm', tone: 'teal', message: 'The patient will be notified that the appointment is confirmed.', noteLabel: 'Message to patient (optional)' });
      actions.push({ status: 'rejected', title: 'Reject request', confirmLabel: 'Reject', tone: 'danger', message: 'The patient will be told you cannot take this appointment.', noteLabel: 'Reason (optional)' });
    }
    if (future && (a.status === 'confirmed' || (a.status === 'rescheduled' && a.rescheduled_by === a.doctor_id))) {
      actions.push({ status: 'cancelled', title: 'Cancel appointment', confirmLabel: 'Cancel appointment', tone: 'danger', message: 'The patient will be notified. Please give a reason.', noteLabel: 'Reason', noteRequired: true });
    }
    if (!future && a.status === 'confirmed') {
      actions.push({ status: 'completed', title: 'Mark as completed', confirmLabel: 'Mark completed', tone: 'primary', message: 'Mark this consultation as completed? The patient can then leave a review.' });
    }
  } else {
    if (future && a.status === 'rescheduled' && a.rescheduled_by === a.doctor_id) {
      actions.push({ status: 'confirmed', title: 'Accept new time', confirmLabel: 'Accept', tone: 'teal', message: `Accept the new time: ${formatDateTime(a.starts_at, tz)}?` });
    }
    if (future && active && !patientLocked) {
      actions.push({ status: 'cancelled', title: 'Cancel appointment', confirmLabel: 'Cancel appointment', tone: 'danger', message: 'Are you sure you want to cancel this appointment? This cannot be undone.', noteLabel: 'Reason (optional)' });
    }
  }
  const canReschedule = future && active && !patientLocked;

  const other =
    viewer === 'patient'
      ? { name: doctorName(a.doctor), avatar: a.doctor?.profile?.avatar_url ?? null, sub: [a.doctor?.clinic_name, a.doctor?.city].filter(Boolean).join(', ') }
      : { name: a.patient?.full_name ?? 'Patient', avatar: a.patient?.avatar_url ?? null, sub: 'Patient' };

  const waitingOnOther =
    (a.status === 'pending' && viewer === 'patient') ||
    (a.status === 'rescheduled' && ((viewer === 'patient' && a.rescheduled_by === a.patient_id) || (viewer === 'doctor' && a.rescheduled_by === a.doctor_id)));

  return (
    <div className="space-y-6">
      <Link to={`/${viewer}/appointments`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All appointments
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Appointment details</h1>
          <p className="mt-1 text-sm text-slate-500">Booked {formatDate(a.created_at, tz)}</p>
        </div>
        <StatusBadge status={a.status} />
      </div>

      {waitingOnOther && <Alert variant="info">Waiting for {viewer === 'patient' ? 'the doctor' : 'the patient'} to confirm {a.status === 'rescheduled' ? 'the new time' : 'this request'}.</Alert>}
      {a.status === 'rescheduled' && viewer === 'patient' && a.rescheduled_by === a.doctor_id && (
        <Alert variant="warning" title="The doctor proposed a new time">Accept it below, choose another time, or cancel.</Alert>
      )}
      {a.status === 'rescheduled' && viewer === 'doctor' && a.rescheduled_by === a.patient_id && (
        <Alert variant="warning" title="The patient asked for a new time">Confirm or reject the new time below.</Alert>
      )}
      {a.status_note && <Alert variant="info" title="Note">{a.status_note}</Alert>}
      {patientLocked && future && (
        <Alert variant="warning">
          This appointment starts in less than {windowHours} hours, so it can no longer be cancelled or rescheduled online. Please message the doctor.
        </Alert>
      )}

      {a.consultation_type === 'online' && a.status === 'confirmed' && <VideoCallCard appointment={a} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardBody className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar name={other.name} url={other.avatar} size="lg" />
                <div>
                  <p className="font-semibold text-slate-900">{other.name}</p>
                  {other.sub && <p className="text-sm text-slate-500">{other.sub}</p>}
                </div>
              </div>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">Date and time</dt>
                  <dd className="font-medium">{formatDateTime(a.starts_at, tz)}</dd>
                  {a.previous_starts_at && <dd className="text-xs text-slate-500">Previously {formatDateTime(a.previous_starts_at, tz)}</dd>}
                </div>
                <div>
                  <dt className="text-slate-500">Consultation</dt>
                  <dd className="flex items-center gap-1 font-medium">
                    {a.consultation_type === 'online' ? <Video className="h-4 w-4 text-brand-600" aria-hidden="true" /> : <Building2 className="h-4 w-4 text-teal-600" aria-hidden="true" />}
                    {consultationLabel(a.consultation_type)}
                  </dd>
                  {a.consultation_type === 'in_person' && a.doctor?.clinic_address && <dd className="text-xs text-slate-500">{a.doctor.clinic_address}</dd>}
                </div>
                <div>
                  <dt className="text-slate-500">Fee</dt>
                  <dd className="font-medium">{formatMoney(a.fee, settings.currency)}</dd>
                  {a.service_fee > 0 && (
                    <dd className="text-xs text-slate-500">
                      + {formatMoney(a.service_fee, settings.currency)} platform service fee ({formatMoney(a.fee + a.service_fee, settings.currency)} total)
                    </dd>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">Reason for visit</dt>
                  <dd className="whitespace-pre-line">{a.reason}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          {/* Render Shared Documents / Prescriptions List */}
          <SharedDocuments appointmentId={a.id} />

          {viewer === 'doctor' ? (
            <Card>
              <CardHeader title="Consultation notes" description="Visible to you and the patient." />
              <CardBody className="space-y-3">
                <Textarea label="Notes" hideLabel rows={5} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Summary, advice, follow-up plan…" />
                <Button variant="secondary" onClick={() => saveNotes.mutate()} loading={saveNotes.isPending} disabled={notes === (a.doctor_notes ?? '')}>
                  Save notes
                </Button>
              </CardBody>
            </Card>
          ) : (
            a.doctor_notes && (
              <Card>
                <CardHeader title="Notes from your doctor" />
                <CardBody>
                  <p className="whitespace-pre-line text-sm text-slate-700">{a.doctor_notes}</p>
                </CardBody>
              </Card>
            )
          )}

          {viewer === 'patient' && a.status === 'completed' && (
            <Card>
              <CardHeader title="Your review" />
              <CardBody>
                {a.review ? (
                  <div className="space-y-1">
                    <Stars value={a.review.rating} size="md" />
                    {a.review.comment && <p className="text-sm text-slate-600">{a.review.comment}</p>}
                    {a.review.status === 'hidden' && <p className="text-xs text-amber-700">This review was hidden by a moderator.</p>}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-slate-600">How was your appointment? Your feedback helps other patients.</p>
                    <Button variant="teal" onClick={() => setReviewing(true)}>
                      <Star className="h-4 w-4" aria-hidden="true" /> Write a review
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Actions" />
            <CardBody className="flex flex-col gap-2">
              {actions.map((ac) => (
                <Button
                  key={ac.status}
                  variant={ac.tone === 'danger' ? 'outline' : ac.tone}
                  className={ac.tone === 'danger' ? 'text-red-700' : ''}
                  onClick={() => {
                    setNote('');
                    setAction(ac);
                  }}
                >
                  {ac.status === 'confirmed' ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : ac.status === 'completed' ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}
                  {ac.title}
                </Button>
              ))}
              {canReschedule && (
                <Button variant="outline" onClick={() => setRescheduling(true)}>
                  <CalendarClock className="h-4 w-4" aria-hidden="true" /> Reschedule
                </Button>
              )}
              {viewer === 'doctor' && (
                <ButtonLink to={`/doctor/prescriptions/appointment/${a.id}`} variant="teal">
                  <FileText className="h-4 w-4" aria-hidden="true" /> Write & Issue Prescription
                </ButtonLink>
              )}
              {a.conversation_id && (
                <ButtonLink to={`/${viewer}/messages/${a.conversation_id}`} variant="secondary">
                  <MessageSquare className="h-4 w-4" aria-hidden="true" /> Message {viewer === 'patient' ? 'doctor' : 'patient'}
                </ButtonLink>
              )}
              {actions.length === 0 && !canReschedule && !a.conversation_id && viewer !== 'doctor' && <p className="text-sm text-slate-500">No actions available.</p>}
            </CardBody>
          </Card>

          {viewer === 'doctor' && (
            <Card>
              <CardHeader title="Patient information" description="Shared for this appointment only." />
              <CardBody>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Name</dt>
                    <dd className="text-right font-medium">{a.patient?.full_name}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Phone</dt>
                    <dd className="text-right">{a.patient_details?.phone ?? 'Not provided'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Date of birth</dt>
                    <dd className="text-right">{a.patient_details?.date_of_birth ?? 'Not provided'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Gender</dt>
                    <dd className="text-right">{GENDER_LABELS[a.patient_details?.gender ?? ''] ?? 'Not provided'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Time zone</dt>
                    <dd className="text-right">{a.patient?.timezone}</dd>
                  </div>
                </dl>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(action)}
        title={action?.title ?? ''}
        message={action?.message}
        confirmLabel={action?.confirmLabel}
        tone={action?.tone}
        loading={changeStatus.isPending}
        onClose={() => setAction(null)}
        onConfirm={() => {
          if (action?.noteRequired && note.trim().length < 3) {
            toast.error('Please enter a reason');
            return;
          }
          if (action) changeStatus.mutate(action);
        }}
      >
        {action?.noteLabel && <Textarea label={action.noteLabel} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} required={action.noteRequired} />}
      </ConfirmDialog>

      <Modal
        open={rescheduling}
        onClose={() => setRescheduling(false)}
        title="Choose a new time"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setRescheduling(false)}>
              Go back
            </Button>
            <Button onClick={() => reschedule.mutate()} disabled={!newSlot} loading={reschedule.isPending}>
              Reschedule to {newSlot ? formatDateTime(newSlot.starts_at, tz) : '…'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Current time: {formatDateTime(a.starts_at, tz)}</p>
          <SlotPicker doctorId={a.doctor_id} timeZone={tz} value={newSlot?.starts_at ?? null} onChange={setNewSlot} />
          <Textarea label="Note (optional)" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </Modal>

      <Modal
        open={reviewing}
        onClose={() => setReviewing(false)}
        title="Review your appointment"
        footer={
          <>
            <Button variant="outline" onClick={() => setReviewing(false)}>
              Go back
            </Button>
            <Button onClick={() => review.mutate()} loading={review.isPending}>
              Submit review
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Rating</p>
            <StarInput value={rating} onChange={setRating} />
          </div>
          <Textarea label="Comment (optional)" rows={4} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} hint="Please do not include personal health details." />
        </div>
      </Modal>
    </div>
  );
}

const JOIN_OPENS_MS = 15 * 60_000;
const JOIN_CLOSES_MS = 30 * 60_000;

function VideoCallCard({ appointment: a }: { appointment: AppointmentDetail }) {
  const { me } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  const [session, setSession] = useState<{ room_url: string; token: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const intervalId = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(intervalId);
  }, []);

  const join = useMutation({
    mutationFn: () => api.post<{ room_url: string; token: string }>(`/appointments/${a.id}/video`),
    onSuccess: (s) => setSession(s),
    onError: (err) => setProblem(errorMessage(err)),
  });

  const opensAt = new Date(a.starts_at).getTime() - JOIN_OPENS_MS;
  const closesAt = new Date(a.ends_at).getTime() + JOIN_CLOSES_MS;
  if (now > closesAt) return null;

  if (session) {
    return <VideoConsultation roomUrl={session.room_url} token={session.token} onLeave={() => setSession(null)} />;
  }

  const open = now >= opensAt;
  return (
    <Card>
      <CardHeader
        title="Video consultation"
        description={
          open
            ? 'Your browser will ask to use your camera and microphone.'
            : `You can join from ${formatDateTime(new Date(opensAt).toISOString(), me?.timezone)}, 15 minutes before the start.`
        }
        action={
          <Button variant="teal" disabled={!open} loading={join.isPending} onClick={() => join.mutate()}>
            <Video className="h-4 w-4" aria-hidden="true" /> Join video call
          </Button>
        }
      />
      {problem && (
        <CardBody>
          <Alert variant="error">{problem}</Alert>
        </CardBody>
      )}
    </Card>
  );
}