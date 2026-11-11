import type { ReactNode } from 'react';
import type { AppointmentStatus, VerificationStatus } from '../../lib/types';
import { STATUS_LABELS } from '../../lib/format';

const tones = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-brand-50 text-brand-700 ring-brand-200',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200',
} as const;

export type Tone = keyof typeof tones;

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

const statusTone: Record<AppointmentStatus, Tone> = {
  pending: 'amber',
  confirmed: 'teal',
  rejected: 'red',
  cancelled: 'gray',
  completed: 'blue',
  rescheduled: 'purple',
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  return <Badge tone={statusTone[status]}>{STATUS_LABELS[status]}</Badge>;
}

const verificationTone: Record<VerificationStatus, Tone> = {
  unverified: 'gray',
  pending: 'amber',
  verified: 'teal',
  rejected: 'red',
};
const verificationLabel: Record<VerificationStatus, string> = {
  unverified: 'Not verified',
  pending: 'Verification pending',
  verified: 'Verified',
  rejected: 'Verification rejected',
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  return <Badge tone={verificationTone[status]}>{verificationLabel[status]}</Badge>;
}
