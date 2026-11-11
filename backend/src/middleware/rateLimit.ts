import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { config } from '../config.js';

function keyFor(req: Request): string {
  return req.auth?.userId ? `user:${req.auth.userId}` : `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
}

function limiter(windowMs: number, limit: number, message: string, extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: keyFor,
    skip: () => !config.rateLimitEnabled,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'rate_limited', message } });
    },
    ...extra,
  });
}

const minute = 60_000;

// Keyed by IP (it runs before authentication); generous so users behind one NAT are not blocked.
export const apiLimiter = limiter(15 * minute, 1500, 'Too many requests. Please slow down and try again shortly.');
export const registerLimiter = limiter(60 * minute, 10, 'Too many registration attempts. Please try again later.');
export const contactLimiter = limiter(60 * minute, 5, 'Too many messages sent. Please try again later.');
export const bookingLimiter = limiter(60 * minute, 30, 'Too many booking attempts. Please try again later.');
export const messageLimiter = limiter(minute, 30, 'You are sending messages too quickly.');
export const uploadLimiter = limiter(60 * minute, 40, 'Too many uploads. Please try again later.');
export const adminWriteLimiter = limiter(minute, 60, 'Too many administrative actions. Please slow down.');
