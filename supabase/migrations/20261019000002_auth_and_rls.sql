-- =============================================================================
-- MediConnect: authentication hooks, privilege protection and Row Level Security
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper functions used by RLS policies. SECURITY DEFINER so they can read
-- profiles without recursing into the profiles policies.
-- -----------------------------------------------------------------------------
create or replace function private.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid() and p.account_status = 'active';
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_user_role() = 'admin', false);
$$;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_user_role() is not null;
$$;

create or replace function private.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id and cp.user_id = auth.uid()
  );
$$;

-- True when the current user and p_other share at least one appointment.
create or replace function private.shares_appointment(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.appointments a
    where (a.patient_id = auth.uid() and a.doctor_id = p_other)
       or (a.doctor_id = auth.uid() and a.patient_id = p_other)
  );
$$;

create or replace function private.is_public_doctor(p_doctor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.doctor_profiles d
    join public.profiles p on p.id = d.id
    where d.id = p_doctor_id
      and d.verification_status = 'verified'
      and p.role = 'doctor'
      and p.account_status = 'active'
  );
$$;

grant execute on function
  private.current_user_role(),
  private.is_admin(),
  private.is_active_user(),
  private.is_conversation_participant(uuid),
  private.shares_appointment(uuid),
  private.is_public_doctor(uuid)
to authenticated, service_role;
grant execute on function private.is_public_doctor(uuid) to anon;

-- True when the statement comes straight from an API client (anon or
-- authenticated database role). SECURITY DEFINER functions run as their owner,
-- and the service role is trusted, so neither counts as a client.
create or replace function private.is_client_request()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('anon', 'authenticated');
$$;

-- -----------------------------------------------------------------------------
-- New auth user -> profile. Self-registration may request 'doctor' (which
-- grants nothing until an admin verifies the doctor) but never 'admin'.
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_name text;
  v_tz text;
begin
  v_role := case
    when new.raw_user_meta_data ->> 'requested_role' = 'doctor' then 'doctor'::public.user_role
    else 'patient'::public.user_role
  end;

  v_name := left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120);
  if char_length(v_name) < 2 then
    v_name := left(coalesce(split_part(new.email, '@', 1), 'User'), 120);
    if char_length(v_name) < 2 then
      v_name := 'User';
    end if;
  end if;

  v_tz := coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC');
  if not private.is_valid_timezone(v_tz) then
    v_tz := 'UTC';
  end if;

  insert into public.profiles (id, role, full_name, timezone)
  values (new.id, v_role, v_name, v_tz);

  if v_role = 'doctor' then
    insert into public.doctor_profiles (id) values (new.id);
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Privilege protection: clients can never change their own role, account
-- status, verification status or ratings, whatever the RLS policy allows.
-- Only SECURITY DEFINER admin functions and the service role can.
-- -----------------------------------------------------------------------------
create or replace function private.protect_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_client_request() then
    if new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.account_status is distinct from old.account_status
       or new.created_at is distinct from old.created_at then
      raise exception 'You cannot change role, account status or identity fields'
        using errcode = 'PT403';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute function private.protect_profile_columns();

create or replace function private.protect_doctor_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_client_request() then
    if new.id is distinct from old.id
       or new.verification_status is distinct from old.verification_status
       or new.verified_at is distinct from old.verified_at
       or new.rating_avg is distinct from old.rating_avg
       or new.rating_count is distinct from old.rating_count
       or new.created_at is distinct from old.created_at then
      raise exception 'Verification and rating fields are managed by the platform'
        using errcode = 'PT403';
    end if;
  end if;
  return new;
end;
$$;

create trigger doctor_profiles_protect_columns
  before update on public.doctor_profiles
  for each row execute function private.protect_doctor_columns();

create or replace function private.protect_review_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.is_client_request() then
    if new.appointment_id is distinct from old.appointment_id
       or new.patient_id is distinct from old.patient_id
       or new.doctor_id is distinct from old.doctor_id
       or new.status is distinct from old.status
       or new.moderated_by is distinct from old.moderated_by
       or new.moderated_at is distinct from old.moderated_at
       or new.moderation_note is distinct from old.moderation_note then
      raise exception 'Only rating and comment can be edited' using errcode = 'PT403';
    end if;
  end if;
  return new;
end;
$$;

create trigger reviews_protect_columns
  before update on public.reviews
  for each row execute function private.protect_review_columns();

-- -----------------------------------------------------------------------------
-- Audit helper
-- -----------------------------------------------------------------------------
create or replace function private.write_audit(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

-- Audit trigger for admin-managed reference tables.
create or replace function private.audit_table_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit(
    lower(tg_op) || '_' || tg_table_name,
    tg_table_name,
    coalesce(
      case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'id',
      case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'key'
    ),
    jsonb_build_object(
      'old', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
      'new', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
    )
  );
  return null;
end;
$$;

create trigger specialties_audit
  after insert or update or delete on public.specialties
  for each row execute function private.audit_table_change();
create trigger system_settings_audit
  after insert or update or delete on public.system_settings
  for each row execute function private.audit_table_change();

-- =============================================================================
-- Row Level Security
-- Every table has RLS enabled. Anything not explicitly allowed is denied.
-- =============================================================================
alter table public.profiles enable row level security;
alter table public.doctor_profiles enable row level security;
alter table public.specialties enable row level security;
alter table public.doctor_specialties enable row level security;
alter table public.doctor_availability enable row level security;
alter table public.doctor_time_off enable row level security;
alter table public.appointments enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.reviews enable row level security;
alter table public.review_reports enable row level security;
alter table public.doctor_verification_requests enable row level security;
alter table public.audit_logs enable row level security;
alter table public.system_settings enable row level security;
alter table public.contact_messages enable row level security;

-- Public directory data is served through curated SECURITY DEFINER functions
-- (search_doctors, get_doctor_public), so anonymous visitors never read raw
-- tables that contain personal data.
revoke all on public.profiles, public.appointments, public.messages, public.notifications,
  public.conversations, public.conversation_participants, public.audit_logs,
  public.doctor_verification_requests, public.review_reports, public.doctor_time_off
from anon;

-- profiles -------------------------------------------------------------------
create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: read appointment counterparts" on public.profiles
  for select to authenticated using (private.shares_appointment(id));
create policy "profiles: admins read all" on public.profiles
  for select to authenticated using (private.is_admin());
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and private.is_active_user())
  with check (id = (select auth.uid()));
-- No insert/delete policies: rows are created by the auth trigger only.

-- doctor_profiles ------------------------------------------------------------
create policy "doctor_profiles: read own" on public.doctor_profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "doctor_profiles: read verified" on public.doctor_profiles
  for select to authenticated using (private.is_public_doctor(id));
create policy "doctor_profiles: admins read all" on public.doctor_profiles
  for select to authenticated using (private.is_admin());
create policy "doctor_profiles: doctor updates own" on public.doctor_profiles
  for update to authenticated
  using (id = (select auth.uid()) and private.current_user_role() = 'doctor')
  with check (id = (select auth.uid()));

-- specialties ----------------------------------------------------------------
create policy "specialties: anyone reads active" on public.specialties
  for select to anon, authenticated using (is_active or private.is_admin());
create policy "specialties: admins insert" on public.specialties
  for insert to authenticated with check (private.is_admin());
create policy "specialties: admins update" on public.specialties
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "specialties: admins delete" on public.specialties
  for delete to authenticated using (private.is_admin());

-- doctor_specialties ---------------------------------------------------------
create policy "doctor_specialties: read public or own" on public.doctor_specialties
  for select to anon, authenticated
  using (private.is_public_doctor(doctor_id) or doctor_id = (select auth.uid()) or private.is_admin());
create policy "doctor_specialties: doctor inserts own" on public.doctor_specialties
  for insert to authenticated
  with check (doctor_id = (select auth.uid()) and private.current_user_role() = 'doctor');
create policy "doctor_specialties: doctor updates own" on public.doctor_specialties
  for update to authenticated
  using (doctor_id = (select auth.uid()) and private.current_user_role() = 'doctor')
  with check (doctor_id = (select auth.uid()));
create policy "doctor_specialties: doctor deletes own" on public.doctor_specialties
  for delete to authenticated
  using (doctor_id = (select auth.uid()) and private.current_user_role() = 'doctor');

-- doctor_availability --------------------------------------------------------
create policy "availability: read public or own" on public.doctor_availability
  for select to anon, authenticated
  using (private.is_public_doctor(doctor_id) or doctor_id = (select auth.uid()) or private.is_admin());
create policy "availability: doctor inserts own" on public.doctor_availability
  for insert to authenticated
  with check (doctor_id = (select auth.uid()) and private.current_user_role() = 'doctor');
create policy "availability: doctor updates own" on public.doctor_availability
  for update to authenticated
  using (doctor_id = (select auth.uid()) and private.current_user_role() = 'doctor')
  with check (doctor_id = (select auth.uid()));
create policy "availability: doctor deletes own" on public.doctor_availability
  for delete to authenticated
  using (doctor_id = (select auth.uid()) and private.current_user_role() = 'doctor');

-- doctor_time_off (private to the doctor; slot functions read it as definer)
create policy "time_off: doctor reads own" on public.doctor_time_off
  for select to authenticated using (doctor_id = (select auth.uid()) or private.is_admin());
create policy "time_off: doctor inserts own" on public.doctor_time_off
  for insert to authenticated
  with check (doctor_id = (select auth.uid()) and private.current_user_role() = 'doctor');
create policy "time_off: doctor deletes own" on public.doctor_time_off
  for delete to authenticated
  using (doctor_id = (select auth.uid()) and private.current_user_role() = 'doctor');

-- appointments ---------------------------------------------------------------
-- Reads: the two parties and admins. Writes: only through the booking and
-- status functions (no insert/update/delete policies at all).
create policy "appointments: parties read" on public.appointments
  for select to authenticated
  using (patient_id = (select auth.uid()) or doctor_id = (select auth.uid()));
create policy "appointments: admins read" on public.appointments
  for select to authenticated using (private.is_admin());

-- conversations / participants / messages ------------------------------------
create policy "conversations: participants read" on public.conversations
  for select to authenticated using (private.is_conversation_participant(id));
create policy "participants: participants read" on public.conversation_participants
  for select to authenticated using (private.is_conversation_participant(conversation_id));
create policy "messages: participants read" on public.messages
  for select to authenticated using (private.is_conversation_participant(conversation_id));
create policy "messages: participants send" on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and private.is_active_user()
    and private.is_conversation_participant(conversation_id)
    and (attachment_path is null or attachment_path like conversation_id::text || '/%')
  );

-- notifications --------------------------------------------------------------
create policy "notifications: owner reads" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
-- Marking read and deleting go through functions; no direct writes.

-- reviews --------------------------------------------------------------------
create policy "reviews: read published" on public.reviews
  for select to anon, authenticated
  using (status = 'published' and private.is_public_doctor(doctor_id));
create policy "reviews: authors and subjects read own" on public.reviews
  for select to authenticated
  using (patient_id = (select auth.uid()) or doctor_id = (select auth.uid()) or private.is_admin());
create policy "reviews: patient reviews own completed appointment" on public.reviews
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and status = 'published'
    and moderated_by is null
    and private.is_active_user()
    and exists (
      select 1 from public.appointments a
      where a.id = appointment_id
        and a.patient_id = (select auth.uid())
        and a.doctor_id = reviews.doctor_id
        and a.status = 'completed'
    )
  );
create policy "reviews: patient edits own" on public.reviews
  for update to authenticated
  using (patient_id = (select auth.uid()) and private.is_active_user())
  with check (patient_id = (select auth.uid()));

-- review_reports -------------------------------------------------------------
create policy "review_reports: reporter or admin reads" on public.review_reports
  for select to authenticated using (reporter_id = (select auth.uid()) or private.is_admin());
create policy "review_reports: users report visible reviews" on public.review_reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and status = 'open'
    and resolved_by is null
    and private.is_active_user()
    and exists (select 1 from public.reviews r where r.id = review_id)
  );

-- doctor_verification_requests -----------------------------------------------
create policy "verification: doctor reads own" on public.doctor_verification_requests
  for select to authenticated using (doctor_id = (select auth.uid()) or private.is_admin());
create policy "verification: doctor submits own" on public.doctor_verification_requests
  for insert to authenticated
  with check (
    doctor_id = (select auth.uid())
    and private.current_user_role() = 'doctor'
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and admin_notes is null
    and not exists (
      select 1 from unnest(document_paths) as p(path)
      where p.path not like (select auth.uid())::text || '/%'
    )
  );

-- audit_logs (read-only for admins; written by definer functions) -------------
create policy "audit_logs: admins read" on public.audit_logs
  for select to authenticated using (private.is_admin());

-- system_settings ------------------------------------------------------------
create policy "settings: anyone reads" on public.system_settings
  for select to anon, authenticated using (true);
-- Updates go through admin_update_setting() for validation.

-- contact_messages -----------------------------------------------------------
create policy "contact: anyone submits" on public.contact_messages
  for insert to anon, authenticated with check (status = 'new');
create policy "contact: admins read" on public.contact_messages
  for select to authenticated using (private.is_admin());
create policy "contact: admins update" on public.contact_messages
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
