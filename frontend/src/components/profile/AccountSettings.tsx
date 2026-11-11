import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Camera, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api, errorMessage } from '../../lib/api';
import { applyServerErrors, passwordRule } from '../../lib/forms';
import { browserTimeZone } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Checkbox, Input, Select } from '../ui/Field';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/Misc';
import { useToast } from '../ui/Toast';
import { ConfirmDialog } from '../ui/Modal';

const zones = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
})();

const schema = z.object({
  full_name: z.string().trim().min(2, 'Enter your full name').max(120),
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\+?[0-9 ()-]{7,20}$/.test(v), 'Enter a valid phone number'),
  date_of_birth: z.string().refine((v) => v === '' || (new Date(v) <= new Date() && new Date(v).getFullYear() > 1900), 'Enter a valid date in the past'),
  gender: z.enum(['', 'female', 'male', 'other', 'prefer_not_to_say']),
  timezone: z.string().min(1),
  email_notifications: z.boolean(),
});
type Values = z.infer<typeof schema>;

export function AccountSettings({ showPersonal = true }: { showPersonal?: boolean }) {
  const { me, refreshMe } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const form = useForm<Values>({ resolver: zodResolver(schema) });
  useEffect(() => {
    if (me)
      form.reset({
        full_name: me.full_name,
        phone: me.phone ?? '',
        date_of_birth: me.date_of_birth ?? '',
        gender: me.gender ?? '',
        timezone: me.timezone,
        email_notifications: me.email_notifications,
      });
  }, [me, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api.patch('/me', {
        full_name: v.full_name,
        phone: v.phone || null,
        ...(showPersonal ? { date_of_birth: v.date_of_birth || null, gender: v.gender || null } : {}),
        timezone: v.timezone,
        email_notifications: v.email_notifications,
      });
      await refreshMe();
      toast.success('Profile saved');
    } catch (err) {
      if (!applyServerErrors(err, form.setError)) toast.error('Could not save your profile', errorMessage(err));
    }
  });

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      toast.error('Choose a JPEG, PNG or WebP image under 2 MB');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('avatar', file);
      await api.post('/me/avatar', fd);
      await refreshMe();
      toast.success('Photo updated');
    } catch (err) {
      toast.error('Could not upload the photo', errorMessage(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeAvatar = async () => {
    try {
      await api.del('/me/avatar');
      await refreshMe();
      toast.success('Photo removed');
    } catch (err) {
      toast.error('Could not remove the photo', errorMessage(err));
    } finally {
      setConfirmRemove(false);
    }
  };

  if (!me) return null;
  // Intl's list omits aliases such as "UTC", so the saved zone is always included.
  const tzOptions = [...new Set([me.timezone, ...(zones.length ? zones : [browserTimeZone()]), 'UTC'])].sort();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Account" description={me.email ?? undefined} />
        <CardBody>
          <div className="mb-6 flex flex-wrap items-center gap-4">
            <Avatar name={me.full_name} url={me.avatar_url} size="xl" />
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => uploadAvatar(e.target.files?.[0])} aria-label="Upload profile photo" />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} loading={uploading}>
                <Camera className="h-4 w-4" aria-hidden="true" /> {me.avatar_url ? 'Change photo' : 'Upload photo'}
              </Button>
              {me.avatar_url && (
                <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove
                </Button>
              )}
            </div>
          </div>
          <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" required autoComplete="name" {...form.register('full_name')} error={form.formState.errors.full_name?.message} />
            <Input label="Phone" type="tel" autoComplete="tel" placeholder="+254 700 000000" {...form.register('phone')} error={form.formState.errors.phone?.message} />
            {showPersonal && (
              <>
                <Input label="Date of birth" type="date" max={new Date().toISOString().slice(0, 10)} {...form.register('date_of_birth')} error={form.formState.errors.date_of_birth?.message} />
                <Select label="Gender" {...form.register('gender')}>
                  <option value="">Not specified</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </Select>
              </>
            )}
            <Select label="Time zone" hint="Appointment times are shown in this time zone." {...form.register('timezone')}>
              {tzOptions.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
            <div className="flex items-end pb-2">
              <Checkbox label="Send me email notifications" {...form.register('email_notifications')} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" loading={form.formState.isSubmitting}>
                Save changes
              </Button>
            </div>
          </form>
          {showPersonal && <p className="mt-4 text-xs text-slate-500">Phone, date of birth and gender are optional and shared only with doctors you book.</p>}
        </CardBody>
      </Card>
      <ChangePassword />
      <ConfirmDialog
        open={confirmRemove}
        title="Remove profile photo"
        message="Your initials will be shown instead."
        confirmLabel="Remove"
        tone="danger"
        onClose={() => setConfirmRemove(false)}
        onConfirm={removeAvatar}
      />
    </div>
  );
}

const pwSchema = z
  .object({ password: passwordRule, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

function ChangePassword() {
  const toast = useToast();
  const form = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema), defaultValues: { password: '', confirm: '' } });
  const onSubmit = form.handleSubmit(async ({ password }) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast.error('Could not change the password', error.message.includes('different') ? 'Choose a password you have not used before.' : 'Please sign in again and retry.');
      return;
    }
    form.reset();
    toast.success('Password changed');
  });
  return (
    <Card>
      <CardHeader title="Change password" />
      <CardBody>
        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Input label="New password" type="password" autoComplete="new-password" {...form.register('password')} error={form.formState.errors.password?.message} />
          <Input label="Confirm new password" type="password" autoComplete="new-password" {...form.register('confirm')} error={form.formState.errors.confirm?.message} />
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary" loading={form.formState.isSubmitting}>
              Update password
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
