import type { AppointmentStatus } from './types';

export const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const safeTz = (tz?: string | null) => {
  if (!tz) return browserTimeZone();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return browserTimeZone();
  }
};

export function formatDateTime(iso: string, tz?: string | null): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTz(tz),
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
}

export function formatDate(iso: string, tz?: string | null): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTz(tz),
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

export function formatTime(iso: string, tz?: string | null): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: safeTz(tz), hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** YYYY-MM-DD of an instant in a given time zone. */
export function dateKey(iso: string | Date, tz?: string | null): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: safeTz(tz), year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    typeof iso === 'string' ? new Date(iso) : iso,
  );
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 7 * 86400) return `${Math.round(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatMoney(amount: number, currency = 'KES'): string {
  try {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  completed: 'Completed',
  rescheduled: 'Rescheduled',
};

export const consultationLabel = (t: string) => (t === 'online' ? 'Online' : 'In person');

export function initials(name: string): string {
  return name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export function doctorName(d: { title?: string | null; full_name?: string | null; profile?: { full_name: string } | null } | null | undefined): string {
  if (!d) return 'Doctor';
  const name = d.full_name ?? d.profile?.full_name ?? 'Doctor';
  return d.title ? `${d.title} ${name}` : name;
}
