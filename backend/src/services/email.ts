import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!config.emailEnabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailContent {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function renderNotificationEmail(input: {
  to: string;
  name: string;
  title: string;
  body: string;
  link: string | null;
}): EmailContent {
  const url = input.link ? new URL(input.link, config.appUrl).toString() : config.appUrl;
  const subject = `${input.title} | MediConnect`;
  const text = `Hello ${input.name},\n\n${input.body}\n\nOpen MediConnect: ${url}\n\nYou are receiving this because email notifications are on in your MediConnect profile.`;
  const html = `<!doctype html>
<html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:92%">
        <tr><td style="background:#0b6bcb;padding:18px 24px;color:#ffffff;font-size:18px;font-weight:bold">MediConnect</td></tr>
        <tr><td style="padding:24px">
          <p style="margin:0 0 12px">Hello ${escapeHtml(input.name)},</p>
          <h1 style="font-size:18px;margin:0 0 8px;color:#0b6bcb">${escapeHtml(input.title)}</h1>
          <p style="margin:0 0 20px;line-height:1.5">${escapeHtml(input.body)}</p>
          <a href="${escapeHtml(url)}" style="display:inline-block;background:#0d9488;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold">Open MediConnect</a>
        </td></tr>
        <tr><td style="padding:16px 24px;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0">
          You are receiving this because email notifications are on in your MediConnect profile. You can turn them off in your profile settings.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return { to: input.to, subject, text, html };
}

/** Sends an email. Returns false when no SMTP server is configured. */
export async function sendEmail(content: EmailContent): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;
  await t.sendMail({ from: config.EMAIL_FROM, ...content });
  logger.debug({ to: content.to, subject: content.subject }, 'email sent');
  return true;
}
