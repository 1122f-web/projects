import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, type LucideIcon } from 'lucide-react';

export function Spinner({ label = 'Loading', className = '' }: { label?: string; className?: string }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-2 py-10 text-slate-500 ${className}`}>
      <Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-hidden="true" />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner />
    </div>
  );
}

const alertStyles = {
  error: { cls: 'border-red-200 bg-red-50 text-red-800', Icon: AlertCircle },
  success: { cls: 'border-teal-200 bg-teal-50 text-teal-800', Icon: CheckCircle2 },
  info: { cls: 'border-brand-200 bg-brand-50 text-brand-800', Icon: Info },
  warning: { cls: 'border-amber-200 bg-amber-50 text-amber-800', Icon: AlertCircle },
} as const;

export function Alert({
  variant = 'info',
  title,
  children,
  action,
}: {
  variant?: keyof typeof alertStyles;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const { cls, Icon } = alertStyles[variant];
  return (
    <div role={variant === 'error' ? 'alert' : 'status'} className={`flex gap-3 rounded-lg border p-3 text-sm ${cls}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex-1 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-brand-50 p-3 text-brand-600">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <Alert
      variant="error"
      title="Could not load this information"
      action={
        onRetry && (
          <button type="button" onClick={onRetry} className="text-sm font-semibold underline">
            Retry
          </button>
        )
      }
    >
      {message}
    </Alert>
  );
}
