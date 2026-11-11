import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { api, ApiError } from '../lib/api';
import type { Me, Role } from '../lib/types';

interface AuthState {
  session: Session | null;
  me: Me | null;
  loading: boolean;
  /** True after a PASSWORD_RECOVERY link was opened. */
  recovering: boolean;
  signIn: (email: string, password: string) => Promise<Me>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function homePathFor(role: Role | undefined): string {
  if (role === 'admin' || role === 'staff') return '/admin';
  if (role === 'doctor') return '/doctor';
  return '/patient';
}

/** Only allow post-login redirects to paths inside this app (no //evil.com or /\\evil.com). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  return next;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') {
        setRecovering(false);
        queryClient.clear();
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  const userId = session?.user.id;
  const meQuery = useQuery({
    queryKey: ['me', userId],
    queryFn: () => api.get<Me>('/me'),
    enabled: Boolean(userId),
    staleTime: 60_000,
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
  });

  // A token the API rejects (revoked or banned) ends the local session too, except
  // the short-lived recovery session the reset page still needs for updateUser().
  useEffect(() => {
    if (recovering || window.location.pathname === '/reset-password') return;
    if (meQuery.error instanceof ApiError && meQuery.error.status === 401) {
      void supabase.auth.signOut();
    }
  }, [meQuery.error, recovering]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (/banned/i.test(error.message)) throw new Error('This account is suspended. Please contact support.');
        if (/confirm/i.test(error.message)) throw new Error('Please confirm your email address first. Check your inbox.');
        throw new Error('Incorrect email or password');
      }
      setSession(data.session);
      const me = await api.get<Me>('/me');
      queryClient.setQueryData(['me', data.user.id], me);
      return me;
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    queryClient.clear();
  }, [queryClient]);

  const refreshMe = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['me'] });
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      me: session ? (meQuery.data ?? null) : null,
      loading: sessionLoading || (Boolean(session) && meQuery.isLoading),
      recovering,
      signIn,
      signOut,
      refreshMe,
    }),
    [session, meQuery.data, meQuery.isLoading, sessionLoading, recovering, signIn, signOut, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
