import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { runAllJobs } from '../worker/jobs.js';

export const internalRouter = Router();

function secretMatches(provided: string | undefined): boolean {
  if (!config.CRON_SECRET || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(config.CRON_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/internal/run-jobs
 * For hosts with an external scheduler (cron, GitHub Actions). Requires the
 * header `x-cron-secret: <CRON_SECRET>`. Disabled when CRON_SECRET is unset.
 */
internalRouter.post('/run-jobs', async (req, res) => {
  if (!secretMatches(req.header('x-cron-secret'))) throw new HttpError(401, 'Unauthorized', 'unauthorized');
  res.json(await runAllJobs());
});
