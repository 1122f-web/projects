# Testing

| Suite | Command | Needs | Count |
|---|---|---|---|
| Backend unit | `npm run test:unit -w backend` | nothing | 14 |
| Backend integration | `npm run test:integration -w backend` | local Supabase (`npm run db:start`, `npm run db:reset`) | 53 |
| Frontend unit | `npm test -w frontend` | nothing | 12 |
| Browser end-to-end | `npm run test:e2e` | local Supabase, `npm run seed:dev`, and Playwright's Chromium | 16 (8 desktop + 8 mobile) |

`npm test` at the root runs the backend suites, then the frontend unit tests.

## What is covered

**Security and RLS (`backend/tests/integration/security.test.ts`)**
- Registration validation, the admin role refused at sign-up (through the API and through Supabase directly), and the "registrations closed" switch for both paths.
- Missing or forged tokens; patients and doctors kept out of admin routes and each other's routes.
- Escalation attempts:
  - `role` in `PATCH /me`
  - direct `profiles.role` updates
  - a doctor self-verifying or faking ratings
  - calling `grant_admin_by_email`, `admin_set_user_role`, `run_scheduled_jobs` and `claim_pending_emails` as a normal user
  - an admin demoting themselves
- The anonymous key reads nothing from private tables.
- One patient cannot read another's appointments, profiles or notifications, nor the audit log.
- Forged appointments and notifications are refused, and direct status changes are blocked.
- Suspension blocks the API and sign-in, and reactivation restores both.

**Booking (`booking.test.ts`)**
- Slot generation in the doctor's time zone (08:00 Nairobi = 05:00 UTC).
- Unverified doctors cannot be booked.
- Booking removes the slot.
- A second booking gets 409, and **6 simultaneous bookings produce exactly 1 success**.
- A patient cannot hold two appointments at the same time.
- Past times, off-grid times and times beyond the booking window are rejected, as are invalid inputs.
- Transition rules: confirm, reject, cancel, complete, and a reschedule that frees the old slot.
- Reviews only after completion, once each, with the rating average updated.

**Messaging (`messaging.test.ts`)**
- Automatic conversations, with outsiders blocked through the API and through direct inserts.
- Sender spoofing blocked, and messages cannot be edited or deleted.
- Unread counts, read receipts and coalesced notifications.
- Real images accepted and served by signed URL to participants only.
- Fake PDFs, HTML disguised as PNG, and files over 10 MB are rejected.
- **Realtime: a participant receives a new message and an outsider subscribed to the same filter receives nothing.**

**Notifications (`notifications.test.ts`)**
- Booking and confirmation notifications, with no clinical text.
- Read and delete are limited to the owner.
- The cron endpoint requires its secret.
- Reminders are sent once, and stale requests are auto-cancelled.
- Email is delivered through SMTP to Mailpit, and skipped for users who opted out.

**Rate limiting (`rate-limit.test.ts`):** the contact form and registration limits.

**Unit tests:**
- file type detection and validation, error mapping, input parsing, password rules and HTML escaping
- frontend: time zone formatting, the API client and route guards

**Browser tests (`frontend/tests/e2e`)**, run on a desktop and a Pixel 7 viewport:
- Every public, patient, doctor and admin page loads without script errors or server errors.
- No element sticks out sideways, even where it would be clipped rather than scrollable.
- Role redirects work, login returns you to the page you asked for, and a wrong password shows a clear error.
- Full journey:
  - a patient books and the slot disappears for another patient
  - the doctor confirms and the patient's page updates live
  - they chat both ways in real time with a read receipt
  - a fake PDF is refused
  - the patient cancels

## Running the browser tests

```bash
npm run db:start && npm run db:reset && npm run seed:dev
npx playwright install chromium          # once, unless you already have a Chromium
npm run test:e2e                          # starts the API and web app if they are not running
# or point at an existing Chromium:
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run test:e2e
```

The browser tests use the fictional seeded accounts and cancel what they book, so you can
run them repeatedly.

## Tips

- Right after `npm run db:reset`, Supabase Realtime needs a few seconds to reconnect. If the
  realtime test fails immediately after a reset, run it again.
- The integration tests refuse to run unless `SUPABASE_URL` points at localhost, because
  they create and delete accounts.
- Rate limiting is turned off for the suite (`DISABLE_RATE_LIMIT=true` in `tests/setup.ts`)
  except in `rate-limit.test.ts`. It cannot be disabled when `NODE_ENV=production`.
