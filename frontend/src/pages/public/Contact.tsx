import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { Mail, MessageSquare, Clock } from 'lucide-react';
import { Input, Textarea } from '../../components/ui/Field';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Feedback';
import { api, errorMessage } from '../../lib/api';
import { applyServerErrors, emailRule } from '../../lib/forms';
import { usePublicSettings } from '../../hooks/useSettings';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(120),
  email: emailRule,
  subject: z.string().trim().min(2, 'Enter a subject').max(150),
  message: z.string().trim().min(10, 'Please write at least 10 characters').max(3000),
  website: z.string().max(0).optional(),
});
type Values = z.infer<typeof schema>;

export function ContactPage() {
  const settings = usePublicSettings();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', email: '', subject: '', message: '', website: '' } });
  const { register, handleSubmit, formState, reset, setError: setFieldError } = form;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post('/contact', values);
      setSent(true);
      reset();
    } catch (err) {
      if (!applyServerErrors(err, setFieldError)) setError(errorMessage(err));
    }
  });

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-5">
      <div className="lg:col-span-2">
        <h1 className="text-3xl font-bold">Contact us</h1>
        <p className="mt-3 text-slate-600">Questions about your account, a booking or joining as a doctor? Send us a message.</p>
        <ul className="mt-8 space-y-4 text-sm text-slate-600">
          <li className="flex gap-3">
            <Mail className="h-5 w-5 text-brand-600" aria-hidden="true" />
            <span>{settings.data?.support_email ?? 'support@example.com'}</span>
          </li>
          <li className="flex gap-3">
            <Clock className="h-5 w-5 text-brand-600" aria-hidden="true" />
            <span>We reply within two working days.</span>
          </li>
          <li className="flex gap-3">
            <MessageSquare className="h-5 w-5 text-brand-600" aria-hidden="true" />
            <span>For questions about your care, message your doctor from your dashboard.</span>
          </li>
        </ul>
        <div className="mt-8">
          <Alert variant="warning" title="Medical emergency?">
            Do not use this form. Call your local emergency number.
          </Alert>
        </div>
      </div>
      <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-xl border border-slate-200 p-6 shadow-sm lg:col-span-3">
        {sent && <Alert variant="success" title="Message sent">Thank you. Our team will reply by email.</Alert>}
        {error && <Alert variant="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Your name" required autoComplete="name" {...register('name')} error={formState.errors.name?.message} />
          <Input label="Email" type="email" required autoComplete="email" {...register('email')} error={formState.errors.email?.message} />
        </div>
        <Input label="Subject" required {...register('subject')} error={formState.errors.subject?.message} />
        <Textarea label="Message" required rows={6} {...register('message')} error={formState.errors.message?.message} />
        <div className="hidden" aria-hidden="true">
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" {...register('website')} />
          </label>
        </div>
        <Button type="submit" loading={formState.isSubmitting}>
          Send message
        </Button>
      </form>
    </div>
  );
}
