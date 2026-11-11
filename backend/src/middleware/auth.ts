import type { NextFunction, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { anonClient, userClient } from '../lib/supabase.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export type Role = 'patient' | 'doctor' | 'admin' | 'staff';

/** Admin areas a staff account can be granted. Administrators hold all of them. */
export const PERMISSIONS = ['users', 'verifications', 'appointments', 'reviews', 'specialties', 'plans', 'activity'] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface AuthContext {
  userId: string;
  email: string | null;
  role: Role;
  accountStatus: 'active' | 'suspended';
  /** Granted admin areas (staff only; empty for other roles). */
  permissions: Permission[];
  token: string;
  /** Supabase client scoped to this user (RLS enforced). */
  db: SupabaseClient;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token || token.length > 4096) return null;
  return token;
}

async function resolveAuth(token: string): Promise<AuthContext | null> {
  // getUser validates the token with Supabase Auth, so revoked sessions and
  // banned users are rejected even before the JWT expires.
  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data.user) return null;

  const db = userClient(token);
  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('role, account_status, permissions')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profileError) {
    logger.error({ err: profileError }, 'failed to load profile for auth');
    return null;
  }
  if (!profile) return null;

  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    role: profile.role as Role,
    accountStatus: profile.account_status as AuthContext['accountStatus'],
    permissions: (profile.permissions ?? []) as Permission[],
    token,
    db,
  };
}

interface AuthOptions {
  /** Allow suspended accounts (used by GET /me so the UI can explain the suspension). */
  allowSuspended?: boolean;
}

/** Requires a valid Supabase access token. */
export function requireAuth(options: AuthOptions = {}) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearerToken(req);
    if (!token) return next(unauthorized());
    const auth = await resolveAuth(token);
    if (!auth) return next(unauthorized('Your session has expired. Please sign in again.'));
    if (auth.accountStatus === 'suspended' && !options.allowSuspended) {
      return next(forbidden('Your account is suspended. Please contact support.'));
    }
    req.auth = auth;
    next();
  };
}

/** Attaches auth when a valid token is present but does not require one. */
export function optionalAuth() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearerToken(req);
    if (token) {
      const auth = await resolveAuth(token);
      if (auth && auth.accountStatus === 'active') req.auth = auth;
    }
    next();
  };
}

/** Requires one of the given roles. Must run after requireAuth. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden());
    next();
  };
}

/**
 * Requires an administrator, or a staff account holding the permission.
 * Must run after requireAuth. The database functions check the same rule.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    const { role, permissions } = req.auth;
    if (role === 'admin' || (role === 'staff' && permissions.includes(permission))) return next();
    next(forbidden());
  };
}

/** Narrowing helper for handlers mounted behind requireAuth. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
