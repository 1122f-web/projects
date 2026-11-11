import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const base =
  'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-500';
const ok = 'border-slate-300 focus:border-brand-500 focus:ring-brand-200';
const bad = 'border-red-400 focus:border-red-500 focus:ring-red-200';

interface FieldShellProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  id: string;
  children: ReactNode;
  hideLabel?: boolean;
}

function FieldShell({ label, error, hint, required, id, children, hideLabel }: FieldShellProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'block text-sm font-medium text-slate-700'}>
        {label}
        {required && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-slate-500">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

type Common = { label: string; error?: string; hint?: ReactNode; hideLabel?: boolean };

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Common>(function Input(
  { label, error, hint, hideLabel, id, className = '', required, ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} id={fieldId} hideLabel={hideLabel}>
      <input
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className={`${base} ${error ? bad : ok} h-10 ${className}`}
        {...rest}
      />
    </FieldShell>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & Common>(function Textarea(
  { label, error, hint, hideLabel, id, className = '', required, rows = 4, ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} id={fieldId} hideLabel={hideLabel}>
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className={`${base} ${error ? bad : ok} ${className}`}
        {...rest}
      />
    </FieldShell>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & Common>(function Select(
  { label, error, hint, hideLabel, id, className = '', required, children, ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} id={fieldId} hideLabel={hideLabel}>
      <select
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        className={`${base} ${error ? bad : ok} h-10 ${className}`}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
});

export function Checkbox({
  label,
  error,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; error?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          aria-invalid={error ? true : undefined}
          {...rest}
        />
        <span>{label}</span>
      </label>
      {error && <p role="alert" className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
