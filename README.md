# MediConnect: Doctor Appointment Booking and Live Chat

MediConnect lets patients find verified doctors, book appointments in real time and
chat securely with their doctor. Doctors manage their schedule and requests, and
administrators verify doctors and moderate the platform.

Built as a University of Embu final-year Computer Science project.

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Tailwind CSS 4, Vite, TanStack Query, React Router |
| Backend | Node.js 22, Express 5, TypeScript, zod |
| Database, Auth, Realtime, Storage | Supabase (PostgreSQL 17, Row Level Security) |
| Email | Any SMTP provider, via a database outbox and a worker |
| Tests | Vitest, Supertest, Testing Library, Playwright |

## Features

**Patients** register and sign in, search doctors by name, specialty, city, fee,
consultation type and availability, view profiles and reviews, and book an open slot.
They can then reschedule or cancel within the rules and chat with the doctor in real
time, with attachments and read receipts. They get in-app and email notifications and
reminders, and can review a doctor after a completed visit.

**Doctors** build a professional profile and submit licence documents for verification.
They set a weekly schedule and time off, then accept, reject, reschedule, cancel or
complete appointments. They write consultation notes and chat with their patients.

**Administrators** see platform statistics and approve or reject doctor verifications
with the documents in view. They manage users (suspend, reactivate, change role) and
appointments, specialties and reviews (moderation and reports). They also read contact
messages, edit platform settings and review a full audit log.

**Booking rules** are enforced in the database:
- Exclusion constraints make double-booking impossible, even under concurrent requests, for both the doctor and the patient.
- Slots are generated in the doctor's time zone and shown in each viewer's own time zone.
- A minimum booking notice, a maximum booking window and a cancellation window all apply.
- Statuses are Pending, Confirmed, Rejected, Cancelled, Completed and Rescheduled, with explicit transition rules.

## Security model

- **Roles cannot be self-assigned.** Sign-up can create only patients or (unverified) doctors.
  - Only an existing admin, or the server-side `make-admin` script, can grant admin.
  - Database triggers block clients from changing their role, account status, verification status or rating.
- **Row Level Security on every table.** The backend calls Supabase *with the user's own token*, so RLS applies to API calls exactly as it would to a direct client.
  - The service-role key is used only for token checks, Auth bans, the email outbox, scheduled jobs and the admin bootstrap script.
- Business rules live in `SECURITY DEFINER` functions with a fixed `search_path`.
- **Uploads** are checked by their real content (magic bytes), size-limited and stored in private buckets. They are served through short-lived signed URLs.
- **The API** uses Helmet headers, a CORS allow-list, body size limits, per-action rate limits and zod validation on every input, and returns errors that never leak database details.
- **Notifications and emails never contain the reason for a visit** or any message text.

See [docs/SECURITY.md](docs/SECURITY.md) for details and known limitations. **This project
has not been assessed for compliance with any healthcare regulation** (for example Kenya's
Data Protection Act 2019 or HIPAA). Do that assessment before handling real patient data.

## Quick start (local)

You need Node.js 22.9 or later, and Docker for the local Supabase stack.

```bash
npm install
npm run db:start                  # starts local Supabase (Postgres, Auth, Realtime, Storage, Mailpit)
npm run db:reset                  # applies supabase/migrations
cp backend/.env.example backend/.env    # then paste the local keys printed by db:start
cp frontend/.env.example frontend/.env
npm run seed:dev                  # optional: fictional demo accounts
npm run dev                       # API on :4000, web app on :5173
```

For local development, `backend/.env` needs:
- `SUPABASE_URL=http://127.0.0.1:54321`, with the anon and service-role keys printed by `npx supabase status`
- `SMTP_HOST=127.0.0.1` and `SMTP_PORT=54325`, so emails land in Mailpit at http://127.0.0.1:54324

The `frontend/.env` file needs the same URL and anon key. Never put the service-role key there.

Demo accounts created by `npm run seed:dev` are all fictional and use the password `DemoPass123`:

| Role | Email |
|---|---|
| Patient | patient.jane@demo.mediconnect.test, patient.peter@demo.mediconnect.test |
| Doctor | dr.amani@demo.mediconnect.test (and dr.otieno, dr.njeri, dr.kamau) |
| Admin | admin@demo.mediconnect.test |

The seed script refuses to run against a non-local database.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API and web app with reload |
| `npm run build` | Production builds of both |
| `npm run lint` / `npm run typecheck` | ESLint and TypeScript for both |
| `npm test` | Backend unit and integration tests (needs local Supabase), then frontend unit tests |
| `npm run test:e2e` | Playwright browser tests on desktop and mobile viewports (needs seeded local stack) |
| `npm run make-admin -- someone@example.com` | Grants admin to an existing account (needs the service-role key) |
| `npm run db:reset` / `npm run db:push` | Rebuild the local database / apply migrations to the linked project |

## Repository layout

```
backend/    Express API, worker, scripts, tests
frontend/   React app, unit tests, Playwright tests
supabase/   config.toml and SQL migrations (schema, RLS, functions, triggers, storage)
docs/       API, database, deployment, security and testing guides
```

## Documentation

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): production setup, and **the exact list of things you must configure**
- [docs/API.md](docs/API.md): every endpoint, with examples
- [docs/DATABASE.md](docs/DATABASE.md): tables, functions, policies and migrations
- [docs/SECURITY.md](docs/SECURITY.md): threat model, controls and limitations
- [docs/TESTING.md](docs/TESTING.md): what the tests cover and how to run them
