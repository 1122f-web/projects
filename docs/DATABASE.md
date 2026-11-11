# Database

Everything lives in `supabase/migrations`, applied in order by the Supabase CLI:

| Migration | Contents |
|---|---|
| `…0001_schema.sql` | Extensions (`btree_gist`), the `private` schema, enums, all tables, constraints, indexes, default settings |
| `…0002_auth_and_rls.sql` | Helpers (`private.is_admin()` and others), new-user trigger, column-protection triggers, audit trigger, RLS policies |
| `…0003_business_logic.sql` | Slot generation, booking, status changes, rescheduling, chat read state, admin functions, scheduled jobs, email outbox claim |
| `…0004_triggers_storage_realtime.sql` | Notification triggers, rating refresh, Storage buckets and policies, Realtime publication |
| `…0005_reference_data.sql` | 12 starter specialties |
| `…0006_doctor_self_service.sql` | Atomic schedule and specialty updates; doctors stay visible to their own past patients |
| `…0007_registration_switch.sql` | The "registrations closed" setting also applies to direct Supabase sign-ups |

Apply them locally with `npm run db:reset`, or to a hosted project with `npx supabase db push`
(see DEPLOYMENT.md). Never edit a migration that has already been applied to production;
add a new one instead.

## Tables

| Table | Purpose | Who can read (RLS) |
|---|---|---|
| `profiles` | One per auth user: role, account status, name, contact details, time zone, email preference | Self; the other party of a shared appointment; admins |
| `doctor_profiles` | Professional details, fee, clinic, slot length, verification status, rating | Anyone for verified active doctors; the doctor; their patients; admins |
| `specialties`, `doctor_specialties` | Specialty catalogue and each doctor's specialties | Public (active ones) |
| `doctor_availability` | Weekly blocks in the doctor's time zone; overlapping blocks are rejected. New doctors start with Monday to Friday, 09:00 to 17:00 (trigger on `doctor_profiles`) | Public for bookable doctors; the doctor |
| `doctor_time_off` | Blocked periods | The doctor; admins (slot generation reads it internally) |
| `appointments` | Bookings with status, reason, notes, reschedule and cancel metadata | The patient, the doctor, admins |
| `conversations`, `conversation_participants` | One per patient and doctor pair; each side's `last_read_at` | Participants only |
| `messages` | Text and attachment metadata; cannot be edited or deleted by users | Participants |
| `notifications` | In-app notifications, plus the email outbox columns (`email_status`, attempts, error) | The recipient |
| `reviews`, `review_reports` | One review per completed appointment; reports for moderation | Published reviews are public; authors; admins |
| `doctor_verification_requests` | Licence details and document paths | The doctor; admins |
| `audit_logs` | Admin and security-relevant actions | Admins |
| `system_settings` | Platform settings (currency, windows, reminders, registrations) | Anyone (they hold no secrets); changed only through `admin_update_setting` |
| `contact_messages` | Contact form submissions | Admins |
| `doctor_plan_requests` | Pro plan and Featured boost purchases with the payment reference, awaiting confirmation | The doctor; admins and staff with `plans` |

Staff accounts (`role = 'staff'`) read the admin tables for the areas in `profiles.permissions`
(`private.has_permission`). These policies sit alongside the admin policies; administrators
hold every permission.

## How the important rules are enforced

**No double-booking.** `appointments` has two exclusion constraints on `tstzrange(starts_at, ends_at)`:
- one per doctor (`appointments_doctor_no_overlap`)
- one per patient (`appointments_patient_no_overlap`)

Both only count `pending`, `confirmed` and `rescheduled` rows, so a cancelled slot frees up
immediately. Because this is enforced by PostgreSQL itself, two simultaneous requests cannot
both succeed. The test suite fires six at once and checks that exactly one wins.

**Valid slots only.** `book_appointment` and `reschedule_appointment` call
`private.assert_slot_available`, which regenerates the doctor's slot grid. That grid is
built in the doctor's time zone and takes into account:
- availability blocks and time off
- the minimum notice and maximum booking window
- whether the doctor is verified, accepting bookings and active

Any other time is rejected, so a client cannot book 09:07 or a time outside working hours.

**Status transitions** live in `update_appointment_status`; see the rules in API.md. Clients
cannot update `appointments` directly: there is no RLS update policy, and every change goes
through these functions.

**Roles and verification cannot be self-assigned.**
- `private.handle_new_user` (the trigger on `auth.users`) only creates `patient` or `doctor`.
- `protect_profile_columns` and `protect_doctor_columns` raise an error when a client request (`anon` or `authenticated`) touches the role, account status, verification status or rating columns.
- The same triggers protect `profiles.permissions`, the `can_*` posting flags and the doctor's `pro_until` / `featured_until`.
- Only `SECURITY DEFINER` admin functions, which check `private.is_admin()` or `private.has_permission()`, and the service role can change them.

**Posting restrictions.** `private.enforce_posting_restrictions` runs before inserts on
`messages` and `appointments` and before inserts and edits on `reviews`. It rejects the action
when the author's `can_send_messages`, `can_book_appointments` or `can_post_reviews` is false.
Because these are triggers, they also apply inside `book_appointment`.

**Fees.** `appointments.service_fee` is copied from the `platform_service_fee` setting when
the appointment is created, so later price changes leave existing bookings unchanged.
Verification and plan fees are paid outside the app: the doctor submits the payment
reference, and an administrator confirms it. `admin_review_plan_request` extends
`pro_until` by whole months or `featured_until` by whole weeks. In the default sort,
`search_doctors` lists Featured doctors first, then Pro doctors.

**Notifications** are inserted by triggers on appointments, messages, reviews, verification
requests and reports, so the API cannot forget one.
- The text never includes the reason for a visit or message contents.
- Chat notifications are coalesced into one unread notification per conversation.

**Email outbox.**
- Each notification starts with `email_status = 'pending'`, or `'skipped'` if the user opted out.
- `claim_pending_emails` locks a batch with `FOR UPDATE SKIP LOCKED`, so several workers can run safely.
- A failed email is retried after 5 minutes, up to 3 attempts in total.

**Scheduled jobs.** `run_scheduled_jobs()`:
- sends one reminder per confirmed appointment inside `reminder_hours_before` (default 24)
- auto-cancels requests that were never confirmed before their start time

## Storage

| Bucket | Public | Limit | Types | Access |
|---|---|---|---|---|
| `avatars` | yes | 2 MB | JPEG, PNG, WebP | Owner writes to `avatars/<user id>/…` |
| `verification-documents` | no | 10 MB | PDF, JPEG, PNG | Owner uploads; owner and admins read via signed URLs |
| `chat-attachments` | no | 10 MB | PDF, JPEG, PNG, WebP | Participants of the conversation in the path; signed URLs for 5 minutes |

## Realtime

The `supabase_realtime` publication includes `messages`, `notifications`,
`conversation_participants` (read receipts) and `appointments`. Realtime applies RLS, so
subscribers only receive rows they could select. The tests verify that an outsider receives
nothing.

## Helpful queries (SQL editor, service role)

```sql
-- Who is an admin?
select p.full_name, u.email from profiles p join auth.users u on u.id = p.id where p.role = 'admin';
-- Emails that keep failing
select id, user_id, type, email_attempts, email_error from notifications where email_status = 'failed';
-- Today's bookings per doctor
select doctor_id, count(*) from appointments where starts_at::date = current_date group by 1;
```
