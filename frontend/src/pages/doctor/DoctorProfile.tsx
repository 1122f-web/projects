import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FileText, ShieldCheck, Upload, X, MapPin, Navigation } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { applyServerErrors } from '../../lib/forms';
import { useSpecialties, usePublicSettings } from '../../hooks/useSettings';
import { useAuth } from '../../context/AuthContext';
import { Card, CardBody, CardHeader, PageHeader } from '../../components/ui/Card';
import { Checkbox, Input, Select, Textarea } from '../../components/ui/Field';
import { Button } from '../../components/ui/Button';
import { Alert, ErrorState, PageLoader } from '../../components/ui/Feedback';
import { VerificationBadge } from '../../components/ui/Badge';
import { AccountSettings } from '../../components/profile/AccountSettings';
import { useToast } from '../../components/ui/Toast';
import { formatBytes, formatDate, formatMoney } from '../../lib/format';
import type { VerificationStatus } from '../../lib/types';
import { DoctorVerificationNotice } from '../../components/DoctorVerificationNotice';

interface DoctorProfile {
  title: string;
  bio: string | null;
  qualifications: string | null;
  years_experience: number | null;
  languages: string[];
  consultation_fee: number;
  clinic_name: string | null;
  clinic_address: string | null;
  city: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  offers_online: boolean;
  offers_in_person: boolean;
  slot_duration_minutes: number;
  is_accepting_patients: boolean;
  verification_status: VerificationStatus;
  verified_at: string | null;
  specialties: { specialty_id: string; is_primary: boolean; specialty: { id: string; name: string } | null }[];
  latest_verification: { id: string; status: string; admin_notes: string | null; created_at: string; reviewed_at: string | null } | null;
}

const schema = z
  .object({
    title: z.string().trim().max(20),
    bio: z.string().max(3000),
    qualifications: z.string().max(2000),
    years_experience: z.string().refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) <= 70), 'Enter 0 to 70'),
    languages: z.string().refine((v) => v.split(',').map((s) => s.trim()).filter(Boolean).length >= 1, 'Add at least one language'),
    consultation_fee: z.string().refine((v) => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= 1_000_000, 'Enter a valid amount'),
    clinic_name: z.string().max(150),
    clinic_address: z.string().max(300),
    city: z.string().max(100),
    latitude: z.string().refine((v) => v === '' || !isNaN(Number(v)), 'Enter a valid latitude'),
    longitude: z.string().refine((v) => v === '' || !isNaN(Number(v)), 'Enter a valid longitude'),
    offers_online: z.boolean(),
    offers_in_person: z.boolean(),
    slot_duration_minutes: z.string(),
    is_accepting_patients: z.boolean(),
  })
  .refine((v) => v.offers_online || v.offers_in_person, { message: 'Offer at least one consultation type', path: ['offers_online'] });
type Values = z.infer<typeof schema>;

export function DoctorProfilePage() {
  const query = useQuery({ queryKey: ['doctor', 'profile'], queryFn: () => api.get<DoctorProfile>('/doctor/profile') });
  if (query.isLoading) return <PageLoader />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const p = query.data!;
  return (
    <div className="space-y-6">
      <PageHeader title="Professional profile" description="What patients see when they find you, and your verification status." action={<VerificationBadge status={p.verification_status} />} />
      <VerificationCard profile={p} />
      <ProfessionalForm profile={p} />
      <SpecialtiesCard profile={p} />
      <h2 className="pt-4 text-lg font-semibold">Personal account</h2>
      <AccountSettings showPersonal={false} />
    </div>
  );
}

function ProfessionalForm({ profile: p }: { profile: DoctorProfile }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { currency } = usePublicSettings();
  const [gettingLocation, setGettingLocation] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema) });

  useEffect(() => {
    form.reset({
      title: p.title,
      bio: p.bio ?? '',
      qualifications: p.qualifications ?? '',
      years_experience: p.years_experience?.toString() ?? '',
      languages: p.languages.join(', '),
      consultation_fee: String(p.consultation_fee),
      clinic_name: p.clinic_name ?? '',
      clinic_address: p.clinic_address ?? '',
      city: p.city ?? '',
      latitude: p.latitude !== null && p.latitude !== undefined ? String(p.latitude) : '',
      longitude: p.longitude !== null && p.longitude !== undefined ? String(p.longitude) : '',
      offers_online: p.offers_online,
      offers_in_person: p.offers_in_person,
      slot_duration_minutes: String(p.slot_duration_minutes),
      is_accepting_patients: p.is_accepting_patients,
    });
  }, [p, form]);

  // Handler for capturing doctor's current GPS location
  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }
    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        form.setValue('latitude', String(position.coords.latitude), { shouldDirty: true });
        form.setValue('longitude', String(position.coords.longitude), { shouldDirty: true });
        toast.success('Current GPS coordinates captured successfully');
        setGettingLocation(false);
      },
      (err) => {
        console.error('Error getting location:', err);
        toast.error('Unable to retrieve location', 'Please check your browser permissions.');
        setGettingLocation(false);
      }
    );
  };

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api.patch('/doctor/profile', {
        title: v.title,
        bio: v.bio.trim() || null,
        qualifications: v.qualifications.trim() || null,
        years_experience: v.years_experience === '' ? null : Number(v.years_experience),
        languages: v.languages.split(',').map((s) => s.trim()).filter(Boolean),
        consultation_fee: Number(v.consultation_fee),
        clinic_name: v.clinic_name.trim() || null,
        clinic_address: v.clinic_address.trim() || null,
        city: v.city.trim() || null,
        latitude: v.latitude === '' ? null : Number(v.latitude),
        longitude: v.longitude === '' ? null : Number(v.longitude),
        offers_online: v.offers_online,
        offers_in_person: v.offers_in_person,
        slot_duration_minutes: Number(v.slot_duration_minutes),
        is_accepting_patients: v.is_accepting_patients,
      });
      toast.success('Professional profile saved');
      void queryClient.invalidateQueries({ queryKey: ['doctor'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      if (!applyServerErrors(err, form.setError)) toast.error('Could not save', errorMessage(err));
    }
  });

  const e = form.formState.errors;
  return (
    <Card>
      <CardHeader title="Practice details" />
      <CardBody>
        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Input label="Title" placeholder="Dr." {...form.register('title')} error={e.title?.message} />
          <Input label="Years of experience" inputMode="numeric" {...form.register('years_experience')} error={e.years_experience?.message} />
          <div className="sm:col-span-2">
            <Textarea label="About you" rows={4} maxLength={3000} hint="Your approach, interests and the patients you see." {...form.register('bio')} error={e.bio?.message} />
          </div>
          <div className="sm:col-span-2">
            <Textarea label="Qualifications" rows={3} maxLength={2000} placeholder="e.g. MBChB (University of Nairobi), MMed Paediatrics" {...form.register('qualifications')} error={e.qualifications?.message} />
          </div>
          <Input label="Languages" hint="Separate with commas" {...form.register('languages')} error={e.languages?.message} />
          <Input label={`Consultation fee (${currency})`} inputMode="decimal" required {...form.register('consultation_fee')} error={e.consultation_fee?.message} />
          <Input label="Clinic name" {...form.register('clinic_name')} error={e.clinic_name?.message} />
          <Input label="City" {...form.register('city')} error={e.city?.message} />
          <div className="sm:col-span-2">
            <Input label="Clinic address" {...form.register('clinic_address')} error={e.clinic_address?.message} />
          </div>

          {/* GPS Map Coordinates Section */}
          <div className="sm:col-span-2 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-sky-600" />
                <span className="font-semibold text-sm text-slate-700">Clinic Map Coordinates</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGetLocation}
                className="flex items-center gap-1.5 text-xs bg-white"
              >
                <Navigation className="h-4 w-4 text-emerald-600" />
                {gettingLocation ? 'Capturing GPS...' : 'Use My Current Location'}
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Latitude" type="number" step="any" placeholder="-0.5312" {...form.register('latitude')} error={e.latitude?.message} />
              <Input label="Longitude" type="number" step="any" placeholder="37.4579" {...form.register('longitude')} error={e.longitude?.message} />
            </div>
            <p className="text-xs text-slate-500">
              Click &quot;Use My Current Location&quot; while physically at your clinic, or copy the coordinates directly from Google Maps.
            </p>
          </div>

          <Select label="Appointment length" {...form.register('slot_duration_minutes')}>
            {[15, 20, 30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </Select>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">Consultation types</legend>
            <Checkbox label="Online (video or phone)" {...form.register('offers_online')} error={e.offers_online?.message} />
            <Checkbox label="In person at the clinic" {...form.register('offers_in_person')} />
          </fieldset>
          <div className="sm:col-span-2">
            <Checkbox label="Accepting new bookings" {...form.register('is_accepting_patients')} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" loading={form.formState.isSubmitting}>
              Save practice details
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function SpecialtiesCard({ profile: p }: { profile: DoctorProfile }) {
  const specialties = useSpecialties();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [primary, setPrimary] = useState<string | null>(null);
  useEffect(() => {
    setSelected(p.specialties.map((s) => s.specialty_id));
    setPrimary(p.specialties.find((s) => s.is_primary)?.specialty_id ?? p.specialties[0]?.specialty_id ?? null);
  }, [p]);

  const save = useMutation({
    mutationFn: () => api.put('/doctor/specialties', { specialty_ids: selected, primary_id: primary && selected.includes(primary) ? primary : selected[0] }),
    onSuccess: () => {
      toast.success('Specialties saved');
      void queryClient.invalidateQueries({ queryKey: ['doctor', 'profile'] });
    },
    onError: (err) => toast.error('Could not save specialties', errorMessage(err)),
  });

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 5 ? (toast.error('Choose at most 5 specialties'), s) : [...s, id]));

  return (
    <Card>
      <CardHeader title="Specialties" description="Choose up to 5 and mark your primary specialty." />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {specialties.data?.map((s) => {
            const on = selected.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(s.id)}
                className={`rounded-full border px-3 py-1.5 text-sm ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:border-brand-400'}`}
              >
                {s.name}
              </button>
            );
          })}
        </div>
        {selected.length > 1 && (
          <Select label="Primary specialty" value={primary ?? ''} onChange={(e) => setPrimary(e.target.value)}>
            {selected.map((id) => (
              <option key={id} value={id}>
                {specialties.data?.find((s) => s.id === id)?.name ?? id}
              </option>
            ))}
          </Select>
        )}
        <Button onClick={() => save.mutate()} disabled={selected.length === 0} loading={save.isPending}>
          Save specialties
        </Button>
      </CardBody>
    </Card>
  );
}

function VerificationCard({ profile: p }: { profile: DoctorProfile }) {
  const { refreshMe } = useAuth();
  const settings = usePublicSettings();
  const fee = settings.data?.doctor_verification_fee ?? 0;
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [license, setLicense] = useState('');
  const [authority, setAuthority] = useState('');
  const [qualifications, setQualifications] = useState(p.qualifications ?? '');
  const [paymentReference, setPaymentReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('license_number', license.trim());
      fd.append('issuing_authority', authority.trim());
      fd.append('qualifications', qualifications.trim());
      if (paymentReference.trim()) fd.append('payment_reference', paymentReference.trim());
      files.forEach((f) => fd.append('documents', f));
      return api.post('/doctor/verification', fd);
    },
    onSuccess: async () => {
      toast.success('Verification submitted', 'An administrator will review your documents.');
      setFiles([]);
      setLicense('');
      setAuthority('');
      setPaymentReference('');
      await refreshMe();
      void queryClient.invalidateQueries({ queryKey: ['doctor', 'profile'] });
    },
    onError: (err) => toast.error('Submission failed', errorMessage(err)),
  });

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(f.type)) {
        toast.error(`${f.name}: use PDF, JPEG or PNG`);
        continue;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`${f.name} is larger than 10 MB`);
        continue;
      }
      if (next.length >= 5) {
        toast.error('Attach at most 5 documents');
        break;
      }
      next.push(f);
    }
    setFiles(next);
    if (fileRef.current) fileRef.current.value = '';
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (license.trim().length < 3) e.license = 'Enter your licence or registration number';
    if (authority.trim().length < 2) e.authority = 'Enter the issuing authority';
    if (qualifications.trim().length < 3) e.qualifications = 'List your qualifications';
    if (files.length === 0) e.files = 'Attach at least one document';
    if (fee > 0 && paymentReference.trim().length < 4) e.payment = 'Enter the payment reference for the verification fee';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const status = p.verification_status;
  return (
    <Card>
      <CardHeader title="Verification" description="Patients can find and book you only after an administrator verifies your credentials." />
      <CardBody className="space-y-4">
        {(status === 'unverified' || status === 'rejected') && (
          <DoctorVerificationNotice
            fee={fee}
            currency={settings.currency}
            paymentInstructions={settings.data?.payment_instructions}
            onRequestVerification={() => {
              const el = document.getElementById('verification-form');
              el?.scrollIntoView({ behavior: 'smooth' });
              el?.querySelector('input')?.focus({ preventScroll: true });
            }}
          />
        )}

        {status === 'verified' && (
          <Alert variant="success" title="You are verified">
            Verified on {p.verified_at ? formatDate(p.verified_at) : '–'}. Your profile is visible to patients.
          </Alert>
        )}
        {status === 'pending' && (
          <Alert variant="info" title="Under review">
            Submitted {p.latest_verification ? formatDate(p.latest_verification.created_at) : ''}. You will get a notification when it is reviewed.
          </Alert>
        )}
        {status === 'rejected' && (
          <Alert variant="error" title="Not approved">
            {p.latest_verification?.admin_notes ?? 'Please check your details and submit again.'}
          </Alert>
        )}
        {(status === 'unverified' || status === 'rejected') && (
          <form
            id="verification-form"
            noValidate
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (validate()) submit.mutate();
            }}
          >
            <Input label="Licence / registration number" required value={license} onChange={(e) => setLicense(e.target.value)} maxLength={64} error={errors.license} />
            <Input label="Issuing authority" required placeholder="e.g. Kenya Medical Practitioners and Dentists Council" value={authority} onChange={(e) => setAuthority(e.target.value)} maxLength={120} error={errors.authority} />
            <div className="sm:col-span-2">
              <Textarea label="Qualifications" required rows={3} maxLength={2000} value={qualifications} onChange={(e) => setQualifications(e.target.value)} error={errors.qualifications} />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <p className="text-sm font-medium text-slate-700">Supporting documents <span className="text-red-600">*</span></p>
              <p className="text-xs text-slate-500">Licence, practising certificate or degree certificates. PDF, JPEG or PNG, up to 10 MB each, at most 5 files. Only you and administrators can view them.</p>
              <input ref={fileRef} type="file" multiple accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => addFiles(e.target.files)} aria-label="Choose documents" />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" aria-hidden="true" /> Add documents
              </Button>
              {files.length > 0 && (
                <ul className="space-y-1">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-1.5 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                        <span className="truncate">{f.name}</span>
                        <span className="text-xs text-slate-400">{formatBytes(f.size)}</span>
                      </span>
                      <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="text-slate-400 hover:text-red-600">
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {errors.files && <p role="alert" className="text-xs font-medium text-red-600">{errors.files}</p>}
            </div>
            {fee > 0 && (
              <div className="sm:col-span-2">
                <Input
                  label={`Verification fee payment reference (${formatMoney(fee, settings.currency)})`}
                  required
                  placeholder="e.g. M-Pesa transaction code"
                  hint={settings.data?.payment_instructions}
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  maxLength={64}
                  error={errors.payment}
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <Button type="submit" variant="teal" loading={submit.isPending}>
                <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Submit for verification
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}