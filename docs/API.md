# API reference

Base URL: `http://localhost:4000/api` in development, or your deployed API URL plus `/api`.

**Authentication.** Send the Supabase access token of the signed-in user:
`Authorization: Bearer <access_token>`. The web app gets it from `supabase.auth`
after sign-in. All endpoints except the public ones need it.

**Errors** always look like this. The `details.fields` part appears only on validation errors:

```json
{ "error": { "code": "bad_request", "message": "Please check the highlighted fields",
             "details": { "fields": { "email": "Enter a valid email address" } } } }
```

| Status | Meaning |
|---|---|
| 400 | Invalid input (`details.fields` names each field) |
| 401 | Missing, expired or invalid token |
| 403 | Signed in but not allowed (wrong role, suspended account, registrations closed) |
| 404 | Not found, **or not yours** (other people's records are reported as not found) |
| 409 | Conflict: slot taken, invalid status change, duplicate review or account |
| 413 | File too large |
| 422 | A business rule refused the request (for example the cancellation window) |
| 429 | Rate limit reached |

**Rate limits** apply per client IP for anonymous calls and per user otherwise:

| Scope | Limit |
|---|---|
| All `/api` routes | 1500 per 15 min |
| Registration | 10 per hour |
| Contact form | 5 per hour |
| Booking and rescheduling | 30 per hour |
| Messages | 30 per minute |
| Uploads | 40 per hour |
| Admin writes | 60 per minute |

Times are ISO 8601 with an offset, for example `2026-10-20T06:00:00Z`. Dates for slot
queries are the doctor's local calendar dates.

---

## Public

### `GET /health`
`{ "status": "ok", "time": "..." }`

### `GET /specialties`
Active specialties: `[{ "id", "name", "slug", "description", "icon" }]`.

### `GET /settings/public`
Settings the interface needs, for example:
```json
{ "platform_name": "MediConnect", "support_email": "...", "currency": "KES",
  "cancellation_window_hours": 12, "min_booking_notice_hours": 1, "max_booking_days_ahead": 60,
  "allow_registrations": true }
```

### `GET /doctors`
Searches verified, active doctors. Query parameters (all optional):

| Parameter | Meaning |
|---|---|
| `q` | Free text: name, clinic, city or specialty |
| `specialty` | Specialty id |
| `min_fee`, `max_fee` | Fee range |
| `type` | `online` or `in_person` |
| `available_on` | `YYYY-MM-DD` |
| `sort` | `rating` (default), `fee_asc`, `fee_desc`, `experience` or `name` |
| `limit` | Up to 50 |
| `offset` | For paging |

```bash
curl "http://localhost:4000/api/doctors?q=embu&type=online&sort=fee_asc"
```
```json
{ "total": 1, "items": [{ "id": "99b6…", "title": "Dr.", "full_name": "Amani Wekesa", "city": "Embu",
  "clinic_name": "Embu Family Clinic", "consultation_fee": 1500, "rating_avg": 4.5, "rating_count": 2,
  "timezone": "Africa/Nairobi", "offers_online": true, "offers_in_person": true,
  "specialties": [{ "id": "…", "name": "General Practice", "is_primary": true }] }] }
```

### `GET /doctors/:id`
Public profile with bio, qualifications, languages, specialties and recent published
reviews. Reviewers are shown as first name plus initial.

### `GET /doctors/:id/slots?from=YYYY-MM-DD&to=YYYY-MM-DD`
Free slots, at most 31 days per request. The doctor's schedule, time off, existing
bookings, minimum notice and maximum booking window are all applied.
```json
[{ "starts_at": "2026-10-20T06:00:00+00:00", "ends_at": "2026-10-20T06:30:00+00:00" }]
```

### `POST /contact`
`{ "name", "email", "subject", "message" }` returns `201 { "message": "Thank you…" }`.
It has a hidden honeypot field, `website`, which must stay empty.

### `POST /auth/register`
```json
{ "email": "jane@example.com", "password": "GoodPass123", "full_name": "Jane Mwangi",
  "role": "patient", "timezone": "Africa/Nairobi", "accept_terms": true }
```
- `role` is `patient` (default) or `doctor`. Anything else, including `admin`, is rejected.
- Passwords need at least 8 characters with upper case, lower case and a digit.

It returns `201`:
```json
{ "user_id": "…", "role": "patient", "requires_email_confirmation": true,
  "message": "Account created. Check your email to confirm your address, then sign in." }
```
Sign-in, sign-out, password reset and email confirmation go straight to Supabase Auth
from the browser.

---

## Signed-in user

| Method and path | Description |
|---|---|
| `GET /me` | Own profile, including `role` and `account_status` (works while suspended so the UI can explain) |
| `PATCH /me` | `{ full_name?, phone?, date_of_birth?, gender?, timezone?, email_notifications? }`. Any other field, such as `role`, is a 400. |
| `POST /me/avatar` | multipart field `avatar`: JPEG, PNG or WebP, up to 2 MB |
| `DELETE /me/avatar` | Remove photo |

## Appointments

| Method and path | Who | Description |
|---|---|---|
| `POST /appointments` | patient | Book a slot (see below) |
| `GET /appointments?scope=upcoming\|past\|all&status=&limit=&offset=` | patient, doctor | Own appointments |
| `GET /appointments/:id` | the patient, the doctor, an admin | Details, plus `conversation_id`. The doctor also gets `patient_details` (phone, date of birth, gender, time zone). |
| `POST /appointments/:id/status` | depends on the rule | `{ "status": "confirmed\|rejected\|cancelled\|completed", "note"? }` |
| `POST /appointments/:id/reschedule` | patient or doctor | `{ "starts_at", "note"? }` sets the status to `rescheduled` until the other side accepts |
| `PUT /appointments/:id/notes` | doctor | `{ "notes": "…" }` consultation notes, visible to the patient |

Booking:
```bash
curl -X POST http://localhost:4000/api/appointments \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"doctor_id":"99b6…","starts_at":"2026-10-20T06:00:00Z","consultation_type":"online","reason":"Persistent cough"}'
```
It returns `201` with the appointment (status `pending`). If the slot was taken meanwhile:
```json
{ "error": { "code": "conflict", "message": "This time slot is not available" } }
```

Status rules:
- **Confirm or reject**: the doctor, while the appointment is pending, or rescheduled by the patient.
- **Accept a new time**: the patient, when the doctor proposed it.
- **Cancel by the patient**: allowed any time before the start for pending requests. A confirmed appointment can only be cancelled before the cancellation window (default 12 hours).
- **Cancel by the doctor**: allowed before the start, and needs a reason.
- **Complete**: the doctor, once a confirmed appointment has started.
- **Stale requests**: pending or rescheduled appointments still unconfirmed at the start time are cancelled automatically by the worker.

### `POST /appointments/:id/video`

For the patient or doctor of a **confirmed online** appointment, from 15 minutes before the
start until 30 minutes after the end. Creates the private Daily room on first use (shared by
both participants, recorded in `video_sessions`) and returns `{ "room_url", "token", "expires_at" }`.
The token is personal; the doctor's makes them the room owner. Returns 503 when
`DAILY_API_KEY` is not set, 409 outside the window or for in-person, unconfirmed appointments.

## Doctor self-service

| Method and path | Description |
|---|---|
| `GET /doctor/profile` | Own professional profile, specialties and latest verification request |
| `PATCH /doctor/profile` | Title, bio, qualifications, years of experience, languages, fee, clinic, city, slot length, consultation types, accepting bookings |
| `PUT /doctor/specialties` | `{ "specialty_ids": [..1-5], "primary_id"? }` |
| `GET /doctor/availability` / `PUT /doctor/availability` | `{ "blocks": [{ "day_of_week": 1, "start_time": "09:00", "end_time": "12:00" }] }` (0 = Sunday), replaced atomically, no overlaps |
| `GET /doctor/time-off`, `POST /doctor/time-off`, `DELETE /doctor/time-off/:id` | `{ "starts_at", "ends_at", "reason"? }` |
| `GET /doctor/verification` | Own verification requests |
| `POST /doctor/verification` | multipart: `license_number`, `issuing_authority`, `qualifications`, `payment_reference` (required while the `doctor_verification_fee` setting is above 0) and 1 to 5 `documents` (PDF, JPEG or PNG, up to 10 MB each) |
| `GET /doctor/plan-requests` | Own Pro plan and Featured boost requests, newest first |
| `POST /doctor/plan-requests` | `{ "plan": "pro\|featured", "periods"?: 1-12, "payment_reference" }`. Verified doctors only, one pending request per plan. The amount comes from the price settings. |

## Conversations

A conversation is created automatically for each patient and doctor pair at their first booking.

| Method and path | Description |
|---|---|
| `GET /conversations` | List with `other_name`, last message, `unread_count`, and both sides' read times |
| `GET /conversations/:id` | One conversation |
| `GET /conversations/:id/messages?before=ISO&limit=30` | History page, oldest to newest |
| `POST /conversations/:id/messages` | JSON `{ "body" }`, or multipart with `body` and/or `attachment` (PDF, JPEG, PNG or WebP, up to 10 MB) |
| `POST /conversations/:id/read` | Mark read (drives read receipts and unread counts) |
| `GET /conversations/:id/messages/:messageId/attachment` | `{ "url" }` signed for 5 minutes |

New messages and read receipts arrive in the browser through Supabase Realtime. RLS
means a client only receives rows it is allowed to read.

## Notifications

| Method and path | Description |
|---|---|
| `GET /notifications?unread_only=&limit=&offset=` | `{ "total", "unread", "items": [{ "id", "type", "title", "body", "link", "read_at", "created_at" }] }` |
| `GET /notifications/unread-count` | `{ "unread" }` |
| `POST /notifications/read` | `{ "ids"?: [] }` (omit `ids` to mark all as read) |
| `DELETE /notifications/:id` | Delete own notification |

## Reviews

| Method and path | Description |
|---|---|
| `GET /reviews/mine` | Reviews written (patient) or received (doctor) |
| `POST /reviews` | `{ "appointment_id", "rating": 1-5, "comment"? }`, once per completed appointment |
| `PATCH /reviews/:id` | Edit own review |
| `POST /reviews/:id/report` | `{ "reason" }` flags a review for moderation |

## Admin (role `admin`, or `staff` with the permission shown)

Staff accounts reach an area only when it is listed in their `permissions`. The same rule
is checked again in the database functions and RLS policies.

| Method and path | Permission | Description |
|---|---|---|
| `GET /admin/stats` | any staff | Counts for the dashboard |
| `GET /admin/users?search=&role=&status=` | `users` | Users with email, permissions and posting restrictions |
| `POST /admin/users/:id/status` | `users` | `{ "status": "active\|suspended", "reason"? }`. Reason is required to suspend. Also bans or unbans sign-in at the Auth level. Staff cannot suspend staff or admins. |
| `POST /admin/users/:id/restrictions` | `users` | `{ "can_send_messages", "can_post_reviews", "can_book_appointments" }` (booleans). Enforced by database triggers. |
| `POST /admin/users/:id/role` | admin only | `{ "role": "patient\|doctor\|staff\|admin" }`. Audited, and an admin cannot change their own role. Leaving `staff` clears the permissions. |
| `POST /admin/users/:id/permissions` | admin only | `{ "permissions": ["users", "verifications", "appointments", "reviews", "specialties", "plans", "activity"] }` (any subset; staff accounts only) |
| `GET /admin/plan-requests?status=pending`, `POST /admin/plan-requests/:id/decision` | `plans` | `{ "approve": true, "notes"? }`. Approving starts the plan or extends the current period. Notes are required to reject. |

The rows below need the permission for their area: `verifications`, `appointments`,
`specialties`, `reviews` (reviews and reports) and `activity` (audit logs and contact
messages). Settings are for administrators only.

| Method and path | Description |
|---|---|
| `GET /admin/verifications?status=pending`, `GET /admin/verifications/:id` | The detail includes 10-minute signed document URLs |
| `POST /admin/verifications/:id/decision` | `{ "approve": true, "notes"? }`. Notes are required to reject. |
| `GET /admin/appointments?status=&from=&to=`, `POST /admin/appointments/:id/cancel` | `{ "note" }` (reason, required) |
| `GET/POST /admin/specialties`, `PATCH/DELETE /admin/specialties/:id` | A specialty in use can be deactivated but not deleted |
| `GET /admin/reviews?status=`, `POST /admin/reviews/:id/moderate` | `{ "status": "published\|hidden", "note"? }` |
| `GET /admin/reports?status=open`, `POST /admin/reports/:id/resolve` | `{ "status": "resolved\|dismissed", "note"?, "hide_review"? }` |
| `GET /admin/audit-logs?action=&entity_type=` | Who did what, when |
| `GET /admin/settings`, `PUT /admin/settings/:key` | `{ "value" }`, validated per key in the database |
| `GET /admin/contact-messages?status=`, `PATCH /admin/contact-messages/:id` | `{ "status": "new\|handled" }` |

## Internal

### `POST /internal/run-jobs`
For an external scheduler. It needs the header `x-cron-secret: <CRON_SECRET>` and is
disabled when `CRON_SECRET` is unset. It runs reminders and the cleanup of stale
requests, then sends pending emails:
`{ "expired": 0, "reminders": 2, "emails_sent": 5, "emails_failed": 0 }`.
