import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { Card, CardBody, CardHeader, PageHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Checkbox, Input } from '../../components/ui/Field';
import { ErrorState, Spinner } from '../../components/ui/Feedback';
import { useToast } from '../../components/ui/Toast';
import { formatDateTime } from '../../lib/format';

interface Setting {
  key: string;
  value: string | number | boolean;
  description: string | null;
  updated_at: string;
}

const LABELS: Record<string, string> = {
  platform_name: 'Platform name',
  support_email: 'Support email',
  currency: 'Currency (ISO code)',
  cancellation_window_hours: 'Cancellation window (hours)',
  min_booking_notice_hours: 'Minimum booking notice (hours)',
  max_booking_days_ahead: 'Booking horizon (days)',
  reminder_hours_before: 'Reminder time (hours before)',
  allow_registrations: 'Allow new registrations',
  platform_service_fee: 'Patient booking service fee',
  doctor_verification_fee: 'Doctor verification fee (one-time)',
  pro_plan_monthly_price: 'Pro plan price (per month)',
  featured_boost_weekly_price: 'Featured boost price (per week)',
  payment_instructions: 'Payment instructions for doctors',
};

export function AdminSettingsPage() {
  const query = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<Setting[]>('/admin/settings') });
  return (
    <div>
      <PageHeader title="System settings" description="Platform-wide rules. Changes take effect immediately and are recorded in the audit log." />
      {query.isLoading ? (
        <Spinner />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <Card>
          <CardHeader title="Settings" />
          <CardBody className="divide-y divide-slate-100">
            {query.data!.map((s) => (
              <SettingRow key={s.key} setting={s} />
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function SettingRow({ setting }: { setting: Setting }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [value, setValue] = useState<string | boolean>(typeof setting.value === 'boolean' ? setting.value : String(setting.value));
  useEffect(() => setValue(typeof setting.value === 'boolean' ? setting.value : String(setting.value)), [setting.value]);
  const isNumber = typeof setting.value === 'number';
  const isBool = typeof setting.value === 'boolean';
  const dirty = isBool ? value !== setting.value : value !== String(setting.value);

  const save = useMutation({
    mutationFn: () => {
      let v: string | number | boolean = value;
      if (isNumber) {
        if (!/^\d+$/.test(String(value))) throw new Error('Enter a whole number');
        v = Number(value);
      }
      return api.put(`/admin/settings/${setting.key}`, { value: v });
    },
    onSuccess: () => {
      toast.success('Setting saved');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => toast.error('Could not save the setting', errorMessage(err)),
  });

  return (
    <form
      className="flex flex-col gap-3 py-4 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex-1">
        {isBool ? (
          <Checkbox label={LABELS[setting.key] ?? setting.key} checked={value as boolean} onChange={(e) => setValue(e.target.checked)} />
        ) : (
          <Input
            label={LABELS[setting.key] ?? setting.key}
            value={value as string}
            inputMode={isNumber ? 'numeric' : undefined}
            onChange={(e) => setValue(e.target.value)}
            hint={setting.description ?? undefined}
            maxLength={200}
          />
        )}
        {isBool && setting.description && <p className="mt-1 text-xs text-slate-500">{setting.description}</p>}
        <p className="mt-1 text-[11px] text-slate-400">Last updated {formatDateTime(setting.updated_at)}</p>
      </div>
      <Button type="submit" variant="secondary" disabled={!dirty} loading={save.isPending}>
        Save
      </Button>
    </form>
  );
}
