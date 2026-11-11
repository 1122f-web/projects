-- =============================================================================
-- MediConnect: core schema
-- Tables, enums, constraints and indexes. Security (RLS) lives in later files.
-- Profile data is kept in public.profiles; credentials stay in auth.users
-- (managed and hashed by Supabase Auth). No passwords are ever stored here.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

-- Internal schema for helpers and trigger functions. It is not exposed through
-- the Data API, so nothing in it can be called directly by clients.
create schema if not exists private;
revoke all on schema private from public;
-- Usage lets RLS policies and constraints call the few helpers that are
-- explicitly granted below; every other private function stays non-executable.
grant usage on schema private to anon, authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('patient', 'doctor', 'admin');
create type public.account_status as enum ('active', 'suspended');
create type public.verification_status as enum ('unverified', 'pending', 'verified', 'rejected');
create type public.appointment_status as enum ('pending', 'confirmed', 'rejected', 'cancelled', 'completed', 'rescheduled');
create type public.consultation_type as enum ('online', 'in_person');
create type public.request_status as enum ('pending', 'approved', 'rejected');
create type public.review_status as enum ('published', 'hidden');
create type public.report_status as enum ('open', 'resolved', 'dismissed');
create type public.email_status as enum ('pending', 'sending', 'sent', 'failed', 'skipped');
create type public.notification_type as enum (
  'appointment_booked',
  'appointment_confirmed',
  'appointment_rejected',
  'appointment_cancelled',
  'appointment_rescheduled',
  'appointment_completed',
  'appointment_reminder',
  'new_message',
  'verification_submitted',
  'verification_approved',
  'verification_rejected',
  'review_received',
  'account_status_changed',
  'system'
);

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.is_valid_timezone(tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz);
$$;
grant execute on function private.is_valid_timezone(text) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- profiles: one row per auth user (created by trigger on auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'patient',
  account_status public.account_status not null default 'active',
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  phone text check (phone is null or phone ~ '^\+?[0-9 ()-]{7,20}$'),
  date_of_birth date check (date_of_birth is null or date_of_birth > date '1900-01-01'),
  gender text check (gender is null or gender in ('female', 'male', 'other', 'prefer_not_to_say')),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 1000),
  timezone text not null default 'UTC' check (private.is_valid_timezone(timezone)),
  email_notifications boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Application profile for every auth user. Credentials live only in auth.users.';
create index profiles_role_idx on public.profiles (role);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- doctor_profiles: professional data for users with role = doctor
-- -----------------------------------------------------------------------------
create table public.doctor_profiles (
  id uuid primary key references public.profiles (id) on delete cascade,
  title text not null default 'Dr.' check (char_length(title) <= 20),
  bio text check (bio is null or char_length(bio) <= 3000),
  qualifications text check (qualifications is null or char_length(qualifications) <= 2000),
  years_experience integer check (years_experience is null or years_experience between 0 and 70),
  languages text[] not null default array['English']
    check (cardinality(languages) <= 10),
  consultation_fee numeric(10, 2) not null default 0
    check (consultation_fee >= 0 and consultation_fee <= 1000000),
  clinic_name text check (clinic_name is null or char_length(clinic_name) <= 150),
  clinic_address text check (clinic_address is null or char_length(clinic_address) <= 300),
  city text check (city is null or char_length(city) <= 100),
  offers_online boolean not null default true,
  offers_in_person boolean not null default true,
  slot_duration_minutes integer not null default 30
    check (slot_duration_minutes in (15, 20, 30, 45, 60, 90, 120)),
  is_accepting_patients boolean not null default true,
  verification_status public.verification_status not null default 'unverified',
  verified_at timestamptz,
  rating_avg numeric(3, 2) not null default 0,
  rating_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint doctor_offers_a_consultation_type check (offers_online or offers_in_person)
);
create index doctor_profiles_verification_idx on public.doctor_profiles (verification_status);
create index doctor_profiles_fee_idx on public.doctor_profiles (consultation_fee);
create trigger doctor_profiles_updated_at before update on public.doctor_profiles
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- specialties and doctor_specialties
-- -----------------------------------------------------------------------------
create table public.specialties (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  description text check (description is null or char_length(description) <= 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger specialties_updated_at before update on public.specialties
  for each row execute function private.set_updated_at();

create table public.doctor_specialties (
  doctor_id uuid not null references public.doctor_profiles (id) on delete cascade,
  specialty_id uuid not null references public.specialties (id) on delete restrict,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (doctor_id, specialty_id)
);
create index doctor_specialties_specialty_idx on public.doctor_specialties (specialty_id);
create unique index doctor_specialties_one_primary on public.doctor_specialties (doctor_id) where is_primary;

-- -----------------------------------------------------------------------------
-- doctor_availability: weekly recurring working hours, in the doctor's
-- profile timezone. day_of_week: 0 = Sunday ... 6 = Saturday.
-- doctor_time_off: one-off blocked periods (absolute timestamps).
-- -----------------------------------------------------------------------------
create table public.doctor_availability (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctor_profiles (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_time_order check (end_time > start_time),
  constraint availability_no_overlap exclude using gist (
    doctor_id with =,
    day_of_week with =,
    tsrange(date '2000-01-01' + start_time, date '2000-01-01' + end_time, '[)') with &&
  )
);
create index doctor_availability_doctor_idx on public.doctor_availability (doctor_id, day_of_week);
create trigger doctor_availability_updated_at before update on public.doctor_availability
  for each row execute function private.set_updated_at();

create table public.doctor_time_off (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctor_profiles (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_off_order check (ends_at > starts_at)
);
create index doctor_time_off_doctor_idx on public.doctor_time_off (doctor_id, starts_at);
create trigger doctor_time_off_updated_at before update on public.doctor_time_off
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- appointments
-- Double-booking is impossible at the database level: two exclusion
-- constraints reject overlapping active appointments for the same doctor or
-- the same patient, even under concurrent requests.
-- -----------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles (id) on delete restrict,
  doctor_id uuid not null references public.doctor_profiles (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  consultation_type public.consultation_type not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  status public.appointment_status not null default 'pending',
  fee numeric(10, 2) not null check (fee >= 0),
  doctor_notes text check (doctor_notes is null or char_length(doctor_notes) <= 4000),
  status_note text check (status_note is null or char_length(status_note) <= 500),
  cancelled_by uuid references public.profiles (id) on delete set null,
  rescheduled_by uuid references public.profiles (id) on delete set null,
  previous_starts_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_time_order check (ends_at > starts_at),
  constraint appointment_distinct_parties check (patient_id <> doctor_id),
  constraint appointments_doctor_no_overlap exclude using gist (
    doctor_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending', 'confirmed', 'rescheduled')),
  constraint appointments_patient_no_overlap exclude using gist (
    patient_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending', 'confirmed', 'rescheduled'))
);
create index appointments_patient_idx on public.appointments (patient_id, starts_at desc);
create index appointments_doctor_idx on public.appointments (doctor_id, starts_at desc);
create index appointments_status_start_idx on public.appointments (status, starts_at);
create trigger appointments_updated_at before update on public.appointments
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- conversations, conversation_participants, messages
-- One conversation per patient-doctor pair, created when the patient first
-- books with that doctor. Participants hold per-user read state.
-- -----------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles (id) on delete cascade,
  doctor_id uuid not null references public.doctor_profiles (id) on delete cascade,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_unique_pair unique (patient_id, doctor_id)
);
create index conversations_doctor_idx on public.conversations (doctor_id);
create trigger conversations_updated_at before update on public.conversations
  for each row execute function private.set_updated_at();

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default '-infinity',
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_participants_user_idx on public.conversation_participants (user_id);
create trigger conversation_participants_updated_at before update on public.conversation_participants
  for each row execute function private.set_updated_at();

-- Messages are immutable once sent, so they carry created_at only.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text check (body is null or char_length(body) between 1 and 4000),
  attachment_path text check (attachment_path is null or char_length(attachment_path) <= 300),
  attachment_name text check (attachment_name is null or char_length(attachment_name) <= 200),
  attachment_mime text check (attachment_mime is null or attachment_mime in
    ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  attachment_size integer check (attachment_size is null or attachment_size between 1 and 10485760),
  created_at timestamptz not null default now(),
  constraint message_has_content check (body is not null or attachment_path is not null),
  constraint message_attachment_complete check (
    (attachment_path is null and attachment_name is null and attachment_mime is null and attachment_size is null)
    or (attachment_path is not null and attachment_name is not null and attachment_mime is not null and attachment_size is not null)
  )
);
create index messages_conversation_idx on public.messages (conversation_id, created_at desc);

-- -----------------------------------------------------------------------------
-- notifications (in-app) with an email outbox status per row
-- -----------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type public.notification_type not null,
  title text not null check (char_length(title) <= 200),
  body text not null check (char_length(body) <= 1000),
  link text check (link is null or link ~ '^/[A-Za-z0-9/_?=&-]*$'),
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  email_status public.email_status not null default 'pending',
  email_attempts smallint not null default 0,
  email_sent_at timestamptz,
  email_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_user_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_email_pending_idx on public.notifications (created_at) where email_status = 'pending';
create trigger notifications_updated_at before update on public.notifications
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- reviews and review_reports
-- -----------------------------------------------------------------------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments (id) on delete cascade,
  patient_id uuid not null references public.profiles (id) on delete cascade,
  doctor_id uuid not null references public.doctor_profiles (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 2000),
  status public.review_status not null default 'published',
  moderated_by uuid references public.profiles (id) on delete set null,
  moderated_at timestamptz,
  moderation_note text check (moderation_note is null or char_length(moderation_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reviews_doctor_idx on public.reviews (doctor_id, created_at desc);
create index reviews_patient_idx on public.reviews (patient_id);
create trigger reviews_updated_at before update on public.reviews
  for each row execute function private.set_updated_at();

create table public.review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  status public.report_status not null default 'open',
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_reports_once_per_user unique (review_id, reporter_id)
);
create index review_reports_status_idx on public.review_reports (status, created_at desc);
create trigger review_reports_updated_at before update on public.review_reports
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- doctor_verification_requests
-- -----------------------------------------------------------------------------
create table public.doctor_verification_requests (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctor_profiles (id) on delete cascade,
  license_number text not null check (char_length(btrim(license_number)) between 3 and 64),
  issuing_authority text not null check (char_length(btrim(issuing_authority)) between 2 and 120),
  qualifications text not null check (char_length(btrim(qualifications)) between 3 and 2000),
  document_paths text[] not null default '{}' check (cardinality(document_paths) <= 5),
  status public.request_status not null default 'pending',
  admin_notes text check (admin_notes is null or char_length(admin_notes) <= 1000),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index verification_one_pending_per_doctor
  on public.doctor_verification_requests (doctor_id) where status = 'pending';
create index verification_status_idx on public.doctor_verification_requests (status, created_at);
create trigger doctor_verification_requests_updated_at before update on public.doctor_verification_requests
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- audit_logs: append-only record of sensitive actions
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (char_length(action) <= 100),
  entity_type text not null check (char_length(entity_type) <= 60),
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id);

-- -----------------------------------------------------------------------------
-- system_settings: admin-managed key/value configuration
-- -----------------------------------------------------------------------------
create table public.system_settings (
  key text primary key check (key ~ '^[a-z_]{2,60}$'),
  value jsonb not null,
  description text,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger system_settings_updated_at before update on public.system_settings
  for each row execute function private.set_updated_at();

insert into public.system_settings (key, value, description) values
  ('platform_name', '"MediConnect"', 'Name shown in the interface and emails'),
  ('support_email', '"support@example.com"', 'Contact address shown to users'),
  ('currency', '"KES"', 'ISO 4217 currency code for consultation fees'),
  ('cancellation_window_hours', '12', 'Patients may cancel or reschedule confirmed appointments up to this many hours before the start'),
  ('min_booking_notice_hours', '1', 'Earliest a slot can be booked, in hours from now'),
  ('max_booking_days_ahead', '60', 'How far ahead patients may book, in days'),
  ('reminder_hours_before', '24', 'When appointment reminders are sent, in hours before the start'),
  ('allow_registrations', 'true', 'Whether new accounts may register');

-- -----------------------------------------------------------------------------
-- contact_messages: submissions from the public Contact Us form
-- -----------------------------------------------------------------------------
create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  subject text not null check (char_length(btrim(subject)) between 2 and 150),
  message text not null check (char_length(btrim(message)) between 10 and 3000),
  status text not null default 'new' check (status in ('new', 'handled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contact_messages_status_idx on public.contact_messages (status, created_at desc);
create trigger contact_messages_updated_at before update on public.contact_messages
  for each row execute function private.set_updated_at();
