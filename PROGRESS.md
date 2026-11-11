# Build progress

The working copy was built in a cloud container and synced here, without `node_modules`,
build output or any `.env` file.

| Phase | Status |
|---|---|
| 1. Architecture and project setup | Done |
| 2. Database schema and security policies | Done (supabase/migrations 0001 to 0007) |
| 3. Authentication and role-based access | Done |
| 4. Doctor profiles and verification | Done |
| 5. Appointment booking and availability | Done |
| 6. Real-time chat | Done |
| 7. Notifications (in-app, email outbox, reminders) | Done |
| 8. Dashboards and pages (frontend) | Done; every page checked in a real browser at desktop and phone sizes |
| 9. Testing and bug fixing | Done (results below) |
| 10. Deployment preparation and documentation | Done; see docs/DEPLOYMENT.md for what you must configure |

## Test results (run on 19 Oct 2026 against the local Supabase stack)

| Suite | Result |
|---|---|
| Backend unit (Vitest) | 14 / 14 passed |
| Backend integration (Vitest + Supertest, real local Supabase) | 53 / 53 passed |
| Frontend unit (Vitest + Testing Library) | 12 / 12 passed |
| Browser end-to-end (Playwright, desktop + Pixel 7) | 16 / 16 passed |
| ESLint, TypeScript, production builds, `npm audit` | Clean, 0 vulnerabilities |

The realtime integration test failed once immediately after a database reset, while
Supabase Realtime was reconnecting. It passed on the next runs (see docs/TESTING.md).

## Bugs found and fixed in phases 8 and 9

1. On phones, the booking, appointment, dashboard and doctor pages rendered wider than the
   screen (grid columns grew to fit the date strip). The pages now fit, and the browser tests
   check for clipped overflow.
2. After signing in from a protected link (`/login?next=...`), users landed on their
   dashboard instead of the page they asked for.
3. Live updates could be missed if a change happened while the realtime connection was
   still opening. The app now refreshes its data every time the connection goes live.
4. The time zone dropdown was blank for users whose time zone is "UTC".
5. The global rate limit (600 requests per 15 min per IP) could block many users sharing
   one network. It is now 1500, and the per-action limits are unchanged.
6. The "registrations closed" setting could be bypassed by calling Supabase sign-up directly.
   It is now enforced in the database (migration 0007).
7. Gender in the doctor's patient panel showed as "Not Provided" or "prefer not to say". It
   now uses proper labels.

## Not verified here

- `backend/Dockerfile` and `.github/workflows/ci.yml` were written but not run (no registry
  access from Docker in the sandbox, and no GitHub repository linked yet).
- Nothing has been deployed. No real Supabase, SMTP or hosting account was used.
