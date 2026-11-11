import { serviceClient } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';
import { renderNotificationEmail, sendEmail } from '../services/email.js';

interface ClaimedEmail {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  email: string | null;
  full_name: string;
}

/** Sends emails for notifications queued in the database (outbox pattern). */
export async function processEmailOutbox(limit = 25): Promise<{ sent: number; failed: number }> {
  if (!config.emailEnabled) return { sent: 0, failed: 0 };

  const { data, error } = await serviceClient.rpc('claim_pending_emails', { p_limit: limit });
  if (error) {
    logger.error({ err: error }, 'failed to claim pending emails');
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  for (const item of (data ?? []) as ClaimedEmail[]) {
    if (!item.email) {
      await serviceClient
        .from('notifications')
        .update({ email_status: 'skipped', email_error: 'No email address' })
        .eq('id', item.id);
      continue;
    }
    try {
      await sendEmail(
        renderNotificationEmail({ to: item.email, name: item.full_name, title: item.title, body: item.body, link: item.link }),
      );
      await serviceClient
        .from('notifications')
        .update({ email_status: 'sent', email_sent_at: new Date().toISOString(), email_error: null })
        .eq('id', item.id);
      sent += 1;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message.slice(0, 300) : 'Unknown error';
      logger.warn({ err, notificationId: item.id }, 'email delivery failed');
      await serviceClient.from('notifications').update({ email_status: 'failed', email_error: message }).eq('id', item.id);
    }
  }
  return { sent, failed };
}

/** Sends due appointment reminders and closes stale unconfirmed requests. */
export async function runScheduledJobs(): Promise<{ expired: number; reminders: number }> {
  const { data, error } = await serviceClient.rpc('run_scheduled_jobs');
  if (error) {
    logger.error({ err: error }, 'scheduled jobs failed');
    return { expired: 0, reminders: 0 };
  }
  return data as { expired: number; reminders: number };
}

/** Runs everything once (used by the cron endpoint and the worker loop). */
export async function runAllJobs() {
  const scheduled = await runScheduledJobs();
  const email = await processEmailOutbox(100);
  return { ...scheduled, emails_sent: email.sent, emails_failed: email.failed };
}

/** Starts in-process timers. Returns a stop function. */
export function startWorker(options: { emailIntervalMs?: number; jobsIntervalMs?: number } = {}) {
  const emailMs = options.emailIntervalMs ?? 30_000;
  const jobsMs = options.jobsIntervalMs ?? 5 * 60_000;
  let running = { email: false, jobs: false };

  if (!config.emailEnabled) {
    logger.warn('SMTP_HOST is not set: email notifications will stay queued until SMTP is configured');
  }

  const emailTimer = setInterval(async () => {
    if (running.email) return;
    running = { ...running, email: true };
    try {
      await processEmailOutbox();
    } finally {
      running = { ...running, email: false };
    }
  }, emailMs);

  const jobsTimer = setInterval(async () => {
    if (running.jobs) return;
    running = { ...running, jobs: true };
    try {
      const result = await runScheduledJobs();
      if (result.expired || result.reminders) logger.info(result, 'scheduled jobs ran');
    } finally {
      running = { ...running, jobs: false };
    }
  }, jobsMs);

  void runScheduledJobs();
  logger.info({ emailMs, jobsMs }, 'background worker started');

  return () => {
    clearInterval(emailTimer);
    clearInterval(jobsTimer);
  };
}
