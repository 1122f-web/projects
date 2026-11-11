import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Stethoscope, User } from 'lucide-react';
import { Logo } from '../../components/layout/Logo';
import { Checkbox, Input } from '../../components/ui/Field';
import { Button } from '../../components/ui/Button';
import { Alert, Spinner } from '../../components/ui/Feedback';
import { homePathFor, safeNext, useAuth } from '../../context/AuthContext';
import { api, errorMessage } from '../../lib/api';
import { applyServerErrors, emailRule, passwordRule } from '../../lib/forms';
import { browserTimeZone } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { isAuthSessionMissingError, isAuthWeakPasswordError, type AuthError } from '@supabase/supabase-js';
import { useToast } from '../../components/ui/Toast';

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-gradient-to-b from-brand-50 to-white px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

const loginSchema = z.object({ email: emailRule, password: z.string().min(1, 'Enter your password') });


export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const onSubmit = form.handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      const me = await signIn(email, password);
      navigate(safeNext(params.get('next')) ?? homePathFor(me.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <AuthShell
      title="Welcome back"
      subtitle={
        <>
          New to MediConnect?{' '}
          <Link to="/register" className="font-medium text-brand-700 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {params.get('confirmed') && <Alert variant="success">Email confirmed. You can sign in now.</Alert>}
        {params.get('reset') && <Alert variant="success">Password updated. Sign in with your new password.</Alert>}
        {error && <Alert variant="error">{error}</Alert>}
        <Input label="Email" type="email" autoComplete="email" required {...form.register('email')} error={form.formState.errors.email?.message} />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          {...form.register('password')}
          error={form.formState.errors.password?.message}
        />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-brand-700 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

const registerSchema = z
  .object({
    full_name: z.string().trim().min(2, 'Enter your full name').max(120),
    email: emailRule,
    password: passwordRule,
    confirm: z.string(),
    role: z.enum(['patient', 'doctor']),
    accept_terms: z.boolean().refine((v) => v, 'You must accept the terms and privacy policy'),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
type RegisterValues = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      full_name: '',
      email: '',
      password: '',
      confirm: '',
      role: params.get('role') === 'doctor' ? 'doctor' : 'patient',
      accept_terms: false,
    },
  });
  const role = form.watch('role');

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const result = await api.post<{ requires_email_confirmation: boolean; message: string }>('/auth/register', {
        full_name: values.full_name,
        email: values.email,
        password: values.password,
        role: values.role,
        timezone: browserTimeZone(),
        accept_terms: values.accept_terms,
      });
      if (result.requires_email_confirmation) {
        setDone(result.message);
        return;
      }
      const me = await signIn(values.email, values.password);
      toast.success('Welcome to MediConnect');
      navigate(me.role === 'doctor' ? '/doctor/profile' : homePathFor(me.role), { replace: true });
    } catch (err) {
      if (!applyServerErrors(err, form.setError)) setError(errorMessage(err));
    }
  });

  if (done) {
    return (
      <AuthShell title="Check your email">
        <Alert variant="success">{done}</Alert>
        <Link to="/login" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
          Go to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle={
        <>
          Already registered?{' '}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Alert variant="error">{error}</Alert>}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">I am a</legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: 'patient', label: 'Patient', icon: User },
                { value: 'doctor', label: 'Doctor', icon: Stethoscope },
              ] as const
            ).map((o) => (
              <label
                key={o.value}
                className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm font-medium ${
                  role === o.value ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <input type="radio" value={o.value} className="sr-only" {...form.register('role')} />
                <o.icon className="h-4 w-4" aria-hidden="true" /> {o.label}
              </label>
            ))}
          </div>
          {role === 'doctor' && (
            <p className="mt-2 text-xs text-slate-500">
              After signing up you will complete your professional profile and submit your licence for verification. Patients can book
              you once an administrator approves it.
            </p>
          )}
        </fieldset>
        <Input label="Full name" autoComplete="name" required {...form.register('full_name')} error={form.formState.errors.full_name?.message} />
        <Input label="Email" type="email" autoComplete="email" required {...form.register('email')} error={form.formState.errors.email?.message} />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 8 characters with uppercase, lowercase and a number."
          {...form.register('password')}
          error={form.formState.errors.password?.message}
        />
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          {...form.register('confirm')}
          error={form.formState.errors.confirm?.message}
        />
        <Checkbox
          {...form.register('accept_terms')}
          error={form.formState.errors.accept_terms?.message}
          label={
            <>
              I agree to the{' '}
              <Link to="/terms" className="text-brand-700 underline" target="_blank">
                Terms
              </Link>{' '}
              and{' '}
              <Link to="/privacy" className="text-brand-700 underline" target="_blank">
                Privacy Policy
              </Link>
            </>
          }
        />
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: emailRule })), defaultValues: { email: '' } });

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    // Same response whether or not the account exists, to avoid revealing registered emails.
    if (err && err.status === 429) setError('Too many requests. Please wait a minute and try again.');
    else setSent(true);
  });

  return (
    <AuthShell title="Reset your password" subtitle="We will email you a link to choose a new password.">
      {sent ? (
        <Alert variant="success">If an account exists for that email, a reset link is on its way.</Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <Input label="Email" type="email" autoComplete="email" required {...form.register('email')} error={form.formState.errors.email?.message} />
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
      <Link to="/login" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
        Back to sign in
      </Link>
    </AuthShell>
  );
}

const resetSchema = z
  .object({ password: passwordRule, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

type LinkState = { status: 'checking' } | { status: 'ready' } | { status: 'invalid'; reason: string };

/**
 * Turns the recovery link into a session. Supabase can send it in three shapes:
 * `?code=` (PKCE, exchanged by supabase-js on start-up), `#access_token=` (links
 * sent from the dashboard or the server) and `?token_hash=` (custom email
 * templates). Link errors such as an expired or reused link come back as
 * `error_description` in the query or the hash.
 */
const EXPIRED_LINK = 'Reset link has expired or is invalid. Please request a new one.';

// Recovery tokens are single-use and StrictMode runs effects twice in development,
// so the link is verified once per page load and every caller shares the result.
let recoveryCheck: Promise<LinkState> | null = null;
const verifyRecoveryLink = () => (recoveryCheck ??= readRecoveryLink());

async function readRecoveryLink(): Promise<LinkState> {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const linkError = query.get('error_description') ?? hash.get('error_description');
  if (linkError) return { status: 'invalid', reason: linkError.replace(/\+/g, ' ') };

  const tokenHash = query.get('token_hash');
  if (tokenHash) {
    const { data, error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
    return error || !data.session ? { status: 'invalid', reason: EXPIRED_LINK } : { status: 'ready' };
  }

  // Resolves once supabase-js has finished reading (and exchanging) a ?code= link.
  const { error: initError } = await supabase.auth.initialize();
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  if (accessToken && refreshToken) {
    // The PKCE client ignores implicit-flow links, so set that session here.
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    return error ? { status: 'invalid', reason: error.message } : { status: 'ready' };
  }

  const { data } = await supabase.auth.getSession();
  if (data.session) return { status: 'ready' };
  if (initError && /code verifier/i.test(initError.message)) {
    return { status: 'invalid', reason: 'Open the link in the same browser where you asked for it, or request a new one.' };
  }
  return { status: 'invalid', reason: initError?.message ?? EXPIRED_LINK };
}

function describeUpdateError(err: AuthError): string {
  if (err.code === 'same_password' || /different/i.test(err.message)) return 'Choose a password you have not used before.';
  // Lists what the password is missing (length, characters, found in a data breach).
  if (isAuthWeakPasswordError(err)) return err.message;
  return `Could not update the password: ${err.message}`;
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [link, setLink] = useState<LinkState>({ status: 'checking' });
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema), defaultValues: { password: '', confirm: '' } });

  useEffect(() => {
    let active = true;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (active && session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN')) setLink({ status: 'ready' });
    });
    verifyRecoveryLink().then((result) => {
      if (!active) return;
      // An auth event may already have marked the link valid; never downgrade that.
      setLink((current) => (current.status === 'ready' ? current : result));
      // Tokens are single-use: drop them from the address bar so a refresh or a shared URL cannot leak them.
      if (window.location.search || window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      if (isAuthSessionMissingError(err) || err.status === 401 || err.code === 'session_not_found' || err.code === 'session_expired') {
        setLink({ status: 'invalid', reason: 'Your reset session has ended. Please request a new link.' });
      } else {
        setError(describeUpdateError(err));
      }
      return;
    }
    recoveryCheck = null;
    // The recovery session should not stay signed in; the user signs in with the new password.
    await supabase.auth.signOut();
    toast.success('Password updated', 'Sign in with your new password.');
    navigate('/login', { replace: true });
  });

  return (
    <AuthShell title="Choose a new password">
      {link.status === 'checking' ? (
        <Spinner label="Checking your reset link" />
      ) : link.status === 'invalid' ? (
        <Alert variant="error" title="This link is invalid or has expired">
          <p>{link.reason}</p>
          <Link to="/forgot-password" className="mt-1 inline-block underline">
            Request a new reset link
          </Link>
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <fieldset disabled={form.formState.isSubmitting} className="space-y-4">
            {error && <Alert variant="error">{error}</Alert>}
            <Input label="New password" type="password" autoComplete="new-password" required {...form.register('password')} error={form.formState.errors.password?.message} />
            <Input label="Confirm new password" type="password" autoComplete="new-password" required {...form.register('confirm')} error={form.formState.errors.confirm?.message} />
            <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
              Update password
            </Button>
          </fieldset>
        </form>
      )}
    </AuthShell>
  );
}
