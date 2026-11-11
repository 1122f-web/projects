# Security

## Secrets

| Value | Where it may live |
|---|---|
| Supabase URL, anon or publishable key | Frontend and backend (public by design; RLS protects the data) |
| Supabase service-role or secret key | **Backend environment only.** Never in the frontend, never in Git. |
| SMTP credentials, `CRON_SECRET` | Backend environment only |

`.env` files are ignored by Git (`.gitignore`), and only `.env.example` files with
placeholders are committed. If a secret is ever committed, rotate it in the provider's
dashboard. Deleting the commit is not enough.

## Controls in place

| Area | Control |
|---|---|
| Authentication | Supabase Auth with email and password and the PKCE flow. Passwords need 8+ characters with mixed case and a digit (checked by the API, the form and Supabase). Email confirmation and reset links redirect only to allow-listed URLs. |
| Authorisation | RLS on every table. The API uses the caller's token, so RLS still applies behind the API. Role checks happen in the API and again in the database functions. |
| Privilege escalation | Sign-up cannot create admins. Triggers block role, status, verification and rating changes from clients. Admins cannot demote themselves. `make-admin` needs the service-role key. Every admin action is written to `audit_logs`. |
| Suspension | The profile status blocks API use, and an Auth ban blocks sign-in and token refresh. |
| Data minimisation | A doctor sees patient contact details only for their own appointments. Reviews show the first name and initial only. Notifications and emails exclude clinical details. Reasons for visits are visible only to the doctor, the patient and admins. |
| Input validation | zod schemas on every route (unknown fields rejected where it matters). Database checks and constraints back them up. |
| Files | Type detected from content (magic bytes), not the name or declared type. Size limits. Random object names. Private buckets with Storage RLS. Short-lived signed URLs. |
| Web | Helmet security headers, CORS allow-list, 100 KB JSON limit, rate limits, no stack traces or SQL errors in responses, HTML-escaped email templates, and internal links only in notifications. |
| Abuse | Per-action rate limits, a honeypot on the contact form, and the "registrations closed" switch enforced in the database. |

## Known limitations and recommendations

- **No compliance claim.** The app has not been assessed against Kenya's Data Protection
  Act 2019, HIPAA, GDPR or any other regulation. Real deployments need a data protection
  impact assessment, a lawful basis and consent wording reviewed by someone qualified,
  data processing agreements with Supabase and the email provider, and a retention and
  deletion policy.
- **Data is not end-to-end encrypted.** Supabase encrypts it at rest and in transit, but
  administrators of the Supabase project can read it.
- **Possible account enumeration.** With email confirmation **disabled**, registering with an
  existing email returns "already exists", which reveals that the account exists. Keep
  confirmation enabled in production, where Supabase returns a neutral response.
- **Rate limits are per process.** The limiter uses in-memory counters. If you run several
  API instances, put a shared store (for example Redis) behind `express-rate-limit`, or use
  your host's rate limiting.
- **No multi-factor authentication.** Supabase supports TOTP MFA; enabling it for admin
  accounts is a recommended next step.
- **Video calls are out of scope.** Online consultations are arranged through chat.
- **No malware scanning of uploads.** Type and size are checked, but files are not
  virus-scanned. Add a scanning step (for example ClamAV, or a provider service) before
  production use.

## Reporting a problem

Contact the project maintainer privately rather than opening a public issue.
