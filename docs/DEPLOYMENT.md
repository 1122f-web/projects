# Deployment

The recommended setup costs nothing to start:

| Part | Host |
|---|---|
| Database, Auth, Realtime, Storage | Supabase (hosted project) |
| API and worker | Render, Railway or Fly.io (any Node 22 host) |
| Web app | Vercel or Netlify (static site) |
| Email | Any SMTP provider (Resend, Brevo, SendGrid, Mailgun, Postmark, Amazon SES) |

## What you must configure yourself

None of these exist yet. Nothing in this repository is connected to a real account.

1. **Create a Supabase project** at https://supabase.com/dashboard and note:
   - the **Project URL**
   - the **anon / publishable key**
   - the **service_role / secret key** (Project Settings → API). This one is secret.
2. **Apply the migrations** from your computer:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
3. **Auth settings** in the Supabase dashboard (Authentication):
   - URL Configuration → **Site URL**: your web app URL, for example `https://mediconnect.vercel.app`.
   - URL Configuration → **Redirect URLs**: `https://<your-web-app>/login`, `https://<your-web-app>/reset-password`
     (plus `http://localhost:5173/**` if you also develop against this project).
   - Providers → Email: keep **Confirm email** on. Sign In / Providers → Passwords:
     minimum length **8**, require **lowercase, uppercase and digits** (the same rules as the app).
   - **SMTP Settings**: enter your SMTP provider. Supabase's built-in sender is only for testing
     and is heavily rate limited, so sign-up confirmation and reset emails need this.
4. **SMTP account** for the app's own notification emails. This can be the same provider as
   step 3. You need the host, port, username, password and a verified sender address
   (`EMAIL_FROM`).
5. **Deploy the API** (next section) with the environment variables listed there.
6. **Deploy the web app** with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_API_URL`.
7. Set the API's `FRONTEND_URL` to the web app's exact origin (CORS) and redeploy it.
8. **Create the first admin.** Register normally in the web app, then from a machine that has
   the backend environment:
   ```bash
   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run make-admin -- you@example.com
   ```
   Alternatively, run `select public.grant_admin_by_email('you@example.com');` in the
   Supabase SQL editor. Further admins can then be promoted from Admin → Users.
9. Sign in as admin and check **Admin → Settings** (platform name, support email, currency,
   windows, reminder hours).
10. Optional: **a custom domain** on the web host, then update the Site URL, the Redirect
    URLs, `FRONTEND_URL` and `APP_URL`.

Do **not** run `npm run seed:dev` against production. It refuses to run against a non-local
database unless forced.

## API (Render example)

The repository includes `render.yaml`:

1. In Render, choose **New → Blueprint** and pick this repository.
2. Fill in the variables Render asks for. The blueprint generates `CRON_SECRET` itself.

To set it up manually instead, create a Web Service with:
- Build: `npm ci && npm run build --workspace backend`
- Start: `npm run start --workspace backend`
- Health check: `/api/health`

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key (**secret**) |
| `FRONTEND_URL` | `https://<your-web-app>` (comma-separate several origins) |
| `APP_URL` | Optional; the URL used in email links (defaults to the first `FRONTEND_URL`) |
| `TRUST_PROXY` | `1` on Render, Railway, Fly and Heroku, so rate limits see real client IPs |
| `ENABLE_WORKER` | `true` to send emails and reminders from the API process |
| `CRON_SECRET` | A long random string (at least 24 characters) if you use an external scheduler |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Your SMTP provider (`SMTP_SECURE=true` for port 465) |
| `EMAIL_FROM` | `MediConnect <no-reply@your-domain>` (must be a verified sender) |

**Free hosting tiers that sleep.** Render's free plan stops idle services, which also pauses
the in-process worker. Either:
- run the worker as its own always-on process: `npm run worker --workspace backend`, with the same variables, or
- keep `ENABLE_WORKER=true` and call the job endpoint every 5 minutes from a scheduler (cron-job.org, a GitHub Actions schedule, or Render Cron):
  ```bash
  curl -X POST https://<your-api>/api/internal/run-jobs -H "x-cron-secret: $CRON_SECRET"
  ```

**Docker.** `backend/Dockerfile` builds the API from the repository root
(`docker build -f backend/Dockerfile .`) for Fly.io, Railway or any container host.
*It has not been test-built in the development sandbox* (that sandbox could not reach the
npm registry from inside Docker), so run one build yourself before relying on it.

**Several instances.** Rate limits are kept in memory per instance. See SECURITY.md.

## Web app (Vercel or Netlify)

- Root directory: `frontend`
- Build command: `npm run build`; output directory: `dist`
  - On Vercel, when the root is `frontend`, set the install command to `cd .. && npm ci` so the workspace lock file is used.
- Environment variables:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | anon / publishable key (**never** the service-role key) |
| `VITE_API_URL` | `https://<your-api>` (no trailing slash and no `/api`) |
| `VITE_GOOGLE_MAPS_API_KEY` | Browser-restricted Google Maps JavaScript API key for clinic maps |
| `VITE_GOOGLE_MAP_ID` | Optional Google Maps map ID |

`vercel.json` (Vercel) and `public/_redirects` and `public/_headers` (Netlify) already
configure single-page routing and security headers.

Optional extra hardening is a Content Security Policy tailored to your URLs. Add it as a header:
```
default-src 'self'; img-src 'self' data: https://<ref>.supabase.co; connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co https://<your-api>; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'
```

## GitHub

The project is not yet in a Git repository. To publish it:

```bash
git init && git add . && git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<you>/mediconnect.git
git push -u origin main
```

Before the first push:
- Check `git status` shows no `.env` files. They are ignored, but check anyway.
- Run `git grep -n "service_role\|SMTP_PASS="` and make sure only placeholders appear.

`.github/workflows/ci.yml` runs lint, typecheck, build, the unit and integration tests
against a throwaway local Supabase, and the browser tests on every push and pull request.
*It has not been run on GitHub yet.* Check the first run.

## Updating

1. New database changes go in a new migration file (`npx supabase migration new <name>`),
   tested locally with `npm run db:reset`, then applied with `npx supabase db push`.
2. Deploy the API, then the web app.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Web app shows "Configuration needed" | The `VITE_SUPABASE_*` variables were missing at build time. Set them and rebuild. |
| Browser console shows CORS errors | `FRONTEND_URL` on the API does not exactly match the web app origin (scheme, host, no trailing slash) |
| Sign-up emails never arrive | Custom SMTP is not configured in Supabase Auth, or the sender is not verified |
| Confirmation link opens localhost | Supabase Auth Site URL or Redirect URLs still point at localhost |
| Notifications show in the app but no emails arrive | `SMTP_*` unset on the API (the log says email is disabled), the worker is not running, or the API is asleep. Check `notifications.email_error` in the SQL editor. |
| Everyone gets rate-limited together | `TRUST_PROXY` is not set behind the host's proxy, so all clients look like one IP |
| "Live" indicator stays on "Connecting" | Realtime blocked by a network or firewall (it uses WebSockets to `wss://<ref>.supabase.co`) |
| 401 on every API call | The API and web app point at different Supabase projects |
| `db push` fails on `btree_gist` | Enable the extension under Database → Extensions, then push again |
