-- =============================================================================
-- MediConnect: staff permissions, posting restrictions, platform fees and
-- doctor plans (Pro subscription, Featured listing boost)
--
-- Staff accounts get admin-area access one area at a time through
-- profiles.permissions. Administrators implicitly hold every permission, so
-- the existing admin policies stay in place and staff policies are added
-- alongside them (permissive policies are OR'ed).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column permissions text[] not null default '{}',
  add column can_send_messages boolean not null default true,
  add column can_post_reviews boolean not null default true,
  add column can_book_appointments boolean not null default true;

alter table public.profiles add constraint profiles_permissions_known check (
  permissions <@ array['users', 'verifications', 'appointments', 'reviews', 'specialties', 'plans', 'activity']::text[]
);
comment on column public.profiles.permissions is
  'Admin areas a staff account may use. Ignored for other roles; administrators hold every permission.';

alter table public.doctor_profiles
  add column pro_until timestamptz,
  add column featured_until timestamptz;

alter table public.appointments
  add column service_fee numeric(10, 2) not null default 0 check (service_fee >= 0);

alter table public.doctor_verification_requests
  add column payment_reference text
    check (payment_reference is null or char_length(btrim(payment_reference)) between 4 and 64);

insert into public.system_settings (key, value, description) values
  ('platform_service_fee', '200', 'Platform service fee added to every booking'),
  ('doctor_verification_fee', '3000', 'One-time fee doctors pay before their credentials are reviewed (0 turns it off)'),
  ('pro_plan_monthly_price', '2500', 'Price of one month of the doctor Pro plan'),
  ('featured_boost_weekly_price', '1500', 'Price of one week of Featured listing'),
  ('payment_instructions', '"Pay by M-Pesa and enter the transaction code. Contact support for the paybill number."',
   'How doctors pay platform fees; shown next to every fee')
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Permission helpers
-- -----------------------------------------------------------------------------
create or replace function private.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.role = 'admin' or (p.role = 'staff' and p_permission = any (p.permissions))
    from public.profiles p
    where p.id = auth.uid() and p.account_status = 'active'
  ), false);
$$;

create or replace function private.is_staff_or_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_user_role() in ('admin', 'staff'), false);
$$;

grant execute on function private.has_permission(text), private.is_staff_or_admin()
to authenticated, service_role;

-- Clients can never change their own permissions or restrictions.
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
       or new.permissions is distinct from old.permissions
       or new.can_send_messages is distinct from old.can_send_messages
       or new.can_post_reviews is distinct from old.can_post_reviews
       or new.can_book_appointments is distinct from old.can_book_appointments
       or new.created_at is distinct from old.created_at then
      raise exception 'You cannot change role, permissions, account status or identity fields'
        using errcode = 'PT403';
    end if;
  end if;
  return new;
end;
$$;

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
       or new.pro_until is distinct from old.pro_until
       or new.featured_until is distinct from old.featured_until
       or new.created_at is distinct from old.created_at then
      raise exception 'Verification, plan and rating fields are managed by the platform'
        using errcode = 'PT403';
    end if;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Posting restrictions. Triggers rather than policies so they also apply to
-- inserts made inside SECURITY DEFINER functions such as book_appointment.
-- -----------------------------------------------------------------------------
create or replace function private.enforce_posting_restrictions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  if tg_table_name = 'messages' then
    select p.can_send_messages into v_allowed from public.profiles p where p.id = new.sender_id;
    if v_allowed is false then
      raise exception 'Your account cannot send messages right now. Please contact support.' using errcode = 'PT403';
    end if;
  elsif tg_table_name = 'reviews' then
    select p.can_post_reviews into v_allowed from public.profiles p where p.id = new.patient_id;
    if v_allowed is false then
      raise exception 'Your account cannot post reviews right now. Please contact support.' using errcode = 'PT403';
    end if;
  elsif tg_table_name = 'appointments' then
    select p.can_book_appointments into v_allowed from public.profiles p where p.id = new.patient_id;
    if v_allowed is false then
      raise exception 'Your account cannot book appointments right now. Please contact support.' using errcode = 'PT403';
    end if;
  end if;
  return new;
end;
$$;

create trigger messages_posting_restrictions
  before insert on public.messages
  for each row execute function private.enforce_posting_restrictions();
create trigger reviews_posting_restrictions
  before insert or update of rating, comment on public.reviews
  for each row execute function private.enforce_posting_restrictions();
create trigger appointments_posting_restrictions
  before insert on public.appointments
  for each row execute function private.enforce_posting_restrictions();

-- -----------------------------------------------------------------------------
-- Fees
-- -----------------------------------------------------------------------------
-- The service fee is fixed at booking time so later price changes do not
-- alter existing appointments.
create or replace function private.set_appointment_service_fee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.service_fee := greatest(private.setting_int('platform_service_fee', 0), 0);
  return new;
end;
$$;

create trigger appointments_service_fee
  before insert on public.appointments
  for each row execute function private.set_appointment_service_fee();

create or replace function private.before_verification_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.doctor_profiles d
             where d.id = new.doctor_id and d.verification_status = 'verified') then
    raise exception 'Your profile is already verified' using errcode = 'PT409';
  end if;
  if exists (select 1 from public.doctor_verification_requests r
             where r.doctor_id = new.doctor_id and r.status = 'pending') then
    raise exception 'You already have a verification request awaiting review' using errcode = 'PT409';
  end if;
  new.payment_reference := nullif(btrim(coalesce(new.payment_reference, '')), '');
  if private.setting_int('doctor_verification_fee', 0) > 0 and new.payment_reference is null then
    raise exception 'Enter the payment reference for the verification fee' using errcode = 'PT422';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- doctor_plan_requests: a doctor pays (outside the app, e.g. M-Pesa) and
-- submits the reference; staff with the "plans" permission confirm payment.
-- -----------------------------------------------------------------------------
create type public.plan_kind as enum ('pro', 'featured');

create table public.doctor_plan_requests (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctor_profiles (id) on delete cascade,
  plan public.plan_kind not null,
  periods integer not null default 1 check (periods between 1 and 12),
  amount numeric(10, 2) not null default 0 check (amount >= 0),
  payment_reference text not null check (char_length(btrim(payment_reference)) between 4 and 64),
  status public.request_status not null default 'pending',
  admin_notes text check (admin_notes is null or char_length(admin_notes) <= 1000),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.doctor_plan_requests is 'Pro plan and Featured boost purchases awaiting payment confirmation.';
create unique index plan_requests_one_pending
  on public.doctor_plan_requests (doctor_id, plan) where status = 'pending';
create index plan_requests_status_idx on public.doctor_plan_requests (status, created_at);
create trigger doctor_plan_requests_updated_at before update on public.doctor_plan_requests
  for each row execute function private.set_updated_at();

alter table public.doctor_plan_requests enable row level security;
revoke all on public.doctor_plan_requests from anon;

create policy "plan_requests: doctor or staff reads" on public.doctor_plan_requests
  for select to authenticated using (doctor_id = (select auth.uid()) or private.has_permission('plans'));
create policy "plan_requests: doctor requests own" on public.doctor_plan_requests
  for insert to authenticated
  with check (doctor_id = (select auth.uid()) and private.current_user_role() = 'doctor');

-- The price is always taken from settings and review fields always start empty.
create or replace function private.before_plan_request_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.doctor_profiles d
                 where d.id = new.doctor_id and d.verification_status = 'verified') then
    raise exception 'Get your profile verified before buying a plan or boost' using errcode = 'PT409';
  end if;
  if exists (select 1 from public.doctor_plan_requests r
             where r.doctor_id = new.doctor_id and r.plan = new.plan and r.status = 'pending') then
    raise exception 'You already have a request for this plan awaiting confirmation' using errcode = 'PT409';
  end if;
  new.payment_reference := btrim(new.payment_reference);
  new.amount := new.periods * greatest(private.setting_int(
    case when new.plan = 'pro' then 'pro_plan_monthly_price' else 'featured_boost_weekly_price' end, 0), 0);
  new.status := 'pending';
  new.admin_notes := null;
  new.reviewed_by := null;
  new.reviewed_at := null;
  return new;
end;
$$;

create trigger plan_requests_before_insert
  before insert on public.doctor_plan_requests
  for each row execute function private.before_plan_request_insert();

create or replace function private.after_plan_request_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify_admins('system',
    case when new.plan = 'pro' then 'Pro plan request' else 'Featured boost request' end,
    private.display_name(new.doctor_id) || ' submitted payment reference ' || new.payment_reference || '.',
    '/admin/plans', jsonb_build_object('request_id', new.id));
  return new;
end;
$$;

create trigger plan_requests_after_insert
  after insert on public.doctor_plan_requests
  for each row execute function private.after_plan_request_insert();

create or replace function public.admin_review_plan_request(
  p_request_id uuid,
  p_approve boolean,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.doctor_plan_requests;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_label text;
begin
  if not private.has_permission('plans') then
    raise exception 'You do not have permission to manage plans' using errcode = 'PT403';
  end if;
  select * into v_req from public.doctor_plan_requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'Plan request not found' using errcode = 'PT404';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been reviewed' using errcode = 'PT409';
  end if;
  if not p_approve and v_notes is null then
    raise exception 'Please give the doctor a reason for the rejection' using errcode = 'PT422';
  end if;

  update public.doctor_plan_requests
  set status = case when p_approve then 'approved'::public.request_status else 'rejected'::public.request_status end,
      admin_notes = v_notes,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_request_id;

  -- Approving extends any time still remaining rather than replacing it.
  if p_approve and v_req.plan = 'pro' then
    update public.doctor_profiles
    set pro_until = greatest(coalesce(pro_until, now()), now()) + make_interval(months => v_req.periods)
    where id = v_req.doctor_id;
  elsif p_approve then
    update public.doctor_profiles
    set featured_until = greatest(coalesce(featured_until, now()), now()) + make_interval(days => 7 * v_req.periods)
    where id = v_req.doctor_id;
  end if;

  v_label := case when v_req.plan = 'pro' then 'Pro plan' else 'Featured boost' end;
  perform private.write_audit(
    case when p_approve then 'plan_request_approved' else 'plan_request_rejected' end,
    'doctor_plan_request', p_request_id::text,
    jsonb_build_object('doctor_id', v_req.doctor_id, 'plan', v_req.plan, 'periods', v_req.periods,
                       'amount', v_req.amount, 'notes', v_notes));
  if p_approve then
    perform private.notify(v_req.doctor_id, 'system', v_label || ' activated',
      'Your payment was confirmed and your ' || v_label || ' is now active.', '/doctor', jsonb_build_object('request_id', p_request_id));
  else
    perform private.notify(v_req.doctor_id, 'system', v_label || ' request not approved',
      'Your ' || v_label || ' request was not approved. Reason: ' || v_notes, '/doctor', jsonb_build_object('request_id', p_request_id));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Staff read access (added next to the existing admin policies)
-- -----------------------------------------------------------------------------
create policy "profiles: staff read all" on public.profiles
  for select to authenticated using (private.is_staff_or_admin());
create policy "doctor_profiles: staff read all" on public.doctor_profiles
  for select to authenticated using (private.is_staff_or_admin());
create policy "doctor_specialties: staff read" on public.doctor_specialties
  for select to authenticated using (private.has_permission('verifications'));
create policy "appointments: staff read" on public.appointments
  for select to authenticated using (private.has_permission('appointments'));
create policy "reviews: staff read" on public.reviews
  for select to authenticated using (private.has_permission('reviews'));
create policy "review_reports: staff read" on public.review_reports
  for select to authenticated using (private.has_permission('reviews'));
create policy "verification: staff read" on public.doctor_verification_requests
  for select to authenticated using (private.has_permission('verifications'));
create policy "verification docs: staff reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'verification-documents' and private.has_permission('verifications'));
create policy "specialties: staff read all" on public.specialties
  for select to authenticated using (private.has_permission('specialties'));
create policy "specialties: staff insert" on public.specialties
  for insert to authenticated with check (private.has_permission('specialties'));
create policy "specialties: staff update" on public.specialties
  for update to authenticated using (private.has_permission('specialties')) with check (private.has_permission('specialties'));
create policy "specialties: staff delete" on public.specialties
  for delete to authenticated using (private.has_permission('specialties'));
create policy "audit_logs: staff read" on public.audit_logs
  for select to authenticated using (private.has_permission('activity'));
create policy "contact: staff read" on public.contact_messages
  for select to authenticated using (private.has_permission('activity'));
create policy "contact: staff update" on public.contact_messages
  for update to authenticated using (private.has_permission('activity')) with check (private.has_permission('activity'));

-- -----------------------------------------------------------------------------
-- Admin functions: permission checks instead of admin-only checks
-- -----------------------------------------------------------------------------
create or replace function public.admin_review_verification(
  p_request_id uuid,
  p_approve boolean,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.doctor_verification_requests;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if not private.has_permission('verifications') then
    raise exception 'You do not have permission to review verifications' using errcode = 'PT403';
  end if;
  select * into v_req from public.doctor_verification_requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'Verification request not found' using errcode = 'PT404';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been reviewed' using errcode = 'PT409';
  end if;
  if not p_approve and v_notes is null then
    raise exception 'Please give the doctor a reason for the rejection' using errcode = 'PT422';
  end if;

  update public.doctor_verification_requests
  set status = case when p_approve then 'approved'::public.request_status else 'rejected'::public.request_status end,
      admin_notes = v_notes,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_request_id;

  update public.doctor_profiles
  set verification_status = case when p_approve then 'verified'::public.verification_status else 'rejected'::public.verification_status end,
      verified_at = case when p_approve then now() else null end
  where id = v_req.doctor_id;

  perform private.write_audit(
    case when p_approve then 'doctor_verification_approved' else 'doctor_verification_rejected' end,
    'doctor_verification_request', p_request_id::text,
    jsonb_build_object('doctor_id', v_req.doctor_id, 'notes', v_notes));

  if p_approve then
    perform private.notify(v_req.doctor_id, 'verification_approved', 'Your profile is verified',
      'An administrator verified your credentials. Patients can now find and book you.',
      '/doctor/profile', jsonb_build_object('request_id', p_request_id));
  else
    perform private.notify(v_req.doctor_id, 'verification_rejected', 'Verification not approved',
      'Your verification request was not approved. Reason: ' || v_notes,
      '/doctor/profile', jsonb_build_object('request_id', p_request_id));
  end if;
end;
$$;

-- Staff with the "users" permission may suspend patients and doctors, but
-- only administrators may suspend staff or other administrators.
create or replace function public.admin_set_account_status(
  p_user_id uuid,
  p_status public.account_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.account_status;
  v_role public.user_role;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not private.has_permission('users') then
    raise exception 'You do not have permission to manage users' using errcode = 'PT403';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own account status' using errcode = 'PT422';
  end if;
  if p_status = 'suspended' and v_reason is null then
    raise exception 'Please record a reason for the suspension' using errcode = 'PT422';
  end if;

  select account_status, role into v_old, v_role from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'User not found' using errcode = 'PT404';
  end if;
  if v_role in ('admin', 'staff') and not private.is_admin() then
    raise exception 'Only administrators can change staff or administrator accounts' using errcode = 'PT403';
  end if;
  if v_old = p_status then
    return;
  end if;

  update public.profiles set account_status = p_status where id = p_user_id;
  perform private.write_audit('account_' || p_status::text, 'profile', p_user_id::text,
    jsonb_build_object('from', v_old, 'to', p_status, 'reason', v_reason));
  if p_status = 'active' then
    perform private.notify(p_user_id, 'account_status_changed', 'Your account was reactivated',
      'You can sign in and use MediConnect again.', '/dashboard', '{}'::jsonb);
  else
    perform private.notify(p_user_id, 'account_status_changed', 'Your account was suspended',
      'Your account was suspended by an administrator. Contact support if you think this is a mistake.',
      null, '{}'::jsonb);
  end if;
end;
$$;

-- Role changes stay admin-only. Leaving the staff role clears its permissions.
create or replace function public.admin_set_user_role(p_user_id uuid, p_role public.user_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.user_role;
begin
  if not private.is_admin() then
    raise exception 'Administrator access required' using errcode = 'PT403';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own role' using errcode = 'PT422';
  end if;
  select role into v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'User not found' using errcode = 'PT404';
  end if;
  if v_old = p_role then
    return;
  end if;

  update public.profiles
  set role = p_role,
      permissions = case when p_role = 'staff' then permissions else '{}' end
  where id = p_user_id;
  if p_role = 'doctor' then
    insert into public.doctor_profiles (id) values (p_user_id) on conflict (id) do nothing;
  end if;
  perform private.write_audit('role_changed', 'profile', p_user_id::text,
    jsonb_build_object('from', v_old, 'to', p_role));
end;
$$;

create or replace function public.admin_set_staff_permissions(p_user_id uuid, p_permissions text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_old text[];
  v_new text[];
begin
  if not private.is_admin() then
    raise exception 'Administrator access required' using errcode = 'PT403';
  end if;
  select role, permissions into v_role, v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'User not found' using errcode = 'PT404';
  end if;
  if v_role <> 'staff' then
    raise exception 'Permissions can only be assigned to staff accounts' using errcode = 'PT422';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_new from unnest(coalesce(p_permissions, '{}')) x;
  if not v_new <@ array['users', 'verifications', 'appointments', 'reviews', 'specialties', 'plans', 'activity']::text[] then
    raise exception 'Unknown permission' using errcode = 'PT422';
  end if;
  if v_new = v_old then
    return;
  end if;

  update public.profiles set permissions = v_new where id = p_user_id;
  perform private.write_audit('permissions_changed', 'profile', p_user_id::text,
    jsonb_build_object('from', v_old, 'to', v_new));
end;
$$;

create or replace function public.admin_set_user_restrictions(
  p_user_id uuid,
  p_can_send_messages boolean,
  p_can_post_reviews boolean,
  p_can_book_appointments boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.profiles;
begin
  if not private.has_permission('users') then
    raise exception 'You do not have permission to manage users' using errcode = 'PT403';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot restrict your own account' using errcode = 'PT422';
  end if;
  select * into v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'User not found' using errcode = 'PT404';
  end if;
  if v_old.role in ('admin', 'staff') and not private.is_admin() then
    raise exception 'Only administrators can change staff or administrator accounts' using errcode = 'PT403';
  end if;
  if v_old.can_send_messages = p_can_send_messages
     and v_old.can_post_reviews = p_can_post_reviews
     and v_old.can_book_appointments = p_can_book_appointments then
    return;
  end if;

  update public.profiles
  set can_send_messages = p_can_send_messages,
      can_post_reviews = p_can_post_reviews,
      can_book_appointments = p_can_book_appointments
  where id = p_user_id;
  perform private.write_audit('restrictions_changed', 'profile', p_user_id::text,
    jsonb_build_object(
      'from', jsonb_build_object('can_send_messages', v_old.can_send_messages, 'can_post_reviews', v_old.can_post_reviews,
                                 'can_book_appointments', v_old.can_book_appointments),
      'to', jsonb_build_object('can_send_messages', p_can_send_messages, 'can_post_reviews', p_can_post_reviews,
                               'can_book_appointments', p_can_book_appointments)));
end;
$$;

create or replace function public.admin_list_users(
  p_search text default null,
  p_role public.user_role default null,
  p_status public.account_status default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('users') then
    raise exception 'You do not have permission to manage users' using errcode = 'PT403';
  end if;
  return (
    with matches as (
      select p.*, u.email::text as email, u.last_sign_in_at,
             d.verification_status
      from public.profiles p
      join auth.users u on u.id = p.id
      left join public.doctor_profiles d on d.id = p.id
      where (p_role is null or p.role = p_role)
        and (p_status is null or p.account_status = p_status)
        and (p_search is null or btrim(p_search) = ''
             or p.full_name ilike '%' || btrim(p_search) || '%'
             or u.email ilike '%' || btrim(p_search) || '%')
    )
    select jsonb_build_object(
      'total', (select count(*) from matches),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'email', m.email, 'full_name', m.full_name, 'role', m.role,
          'account_status', m.account_status, 'verification_status', m.verification_status,
          'permissions', m.permissions, 'can_send_messages', m.can_send_messages,
          'can_post_reviews', m.can_post_reviews, 'can_book_appointments', m.can_book_appointments,
          'created_at', m.created_at, 'last_sign_in_at', m.last_sign_in_at
        ) order by m.created_at desc)
        from (
          select * from matches order by created_at desc
          limit least(greatest(coalesce(p_limit, 25), 1), 100)
          offset greatest(coalesce(p_offset, 0), 0)
        ) m
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_staff_or_admin() then
    raise exception 'Administrator access required' using errcode = 'PT403';
  end if;
  return jsonb_build_object(
    'users', (select jsonb_object_agg(role, n) from (select role, count(*) n from public.profiles group by role) x),
    'suspended_users', (select count(*) from public.profiles where account_status = 'suspended'),
    'doctors_verified', (select count(*) from public.doctor_profiles where verification_status = 'verified'),
    'pending_verifications', (select count(*) from public.doctor_verification_requests where status = 'pending'),
    'pending_plan_requests', (select count(*) from public.doctor_plan_requests where status = 'pending'),
    'appointments', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                     from (select status, count(*) n from public.appointments group by status) x),
    'appointments_today', (select count(*) from public.appointments
                           where starts_at >= date_trunc('day', now()) and starts_at < date_trunc('day', now()) + interval '1 day'),
    'appointments_last_30_days', (select count(*) from public.appointments where created_at >= now() - interval '30 days'),
    'messages_last_7_days', (select count(*) from public.messages where created_at >= now() - interval '7 days'),
    'open_reports', (select count(*) from public.review_reports where status = 'open'),
    'new_contact_messages', (select count(*) from public.contact_messages where status = 'new'),
    'reviews', (select count(*) from public.reviews)
  );
end;
$$;

create or replace function public.admin_moderate_review(
  p_review_id uuid,
  p_status public.review_status,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.review_status;
begin
  if not private.has_permission('reviews') then
    raise exception 'You do not have permission to moderate reviews' using errcode = 'PT403';
  end if;
  select status into v_old from public.reviews where id = p_review_id for update;
  if not found then
    raise exception 'Review not found' using errcode = 'PT404';
  end if;
  update public.reviews
  set status = p_status, moderated_by = auth.uid(), moderated_at = now(),
      moderation_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_review_id;
  perform private.write_audit('review_' || p_status::text, 'review', p_review_id::text,
    jsonb_build_object('from', v_old, 'note', p_note));
end;
$$;

create or replace function public.admin_resolve_report(
  p_report_id uuid,
  p_status public.report_status,
  p_note text default null,
  p_hide_review boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review uuid;
begin
  if not private.has_permission('reviews') then
    raise exception 'You do not have permission to moderate reviews' using errcode = 'PT403';
  end if;
  if p_status = 'open' then
    raise exception 'Choose resolved or dismissed' using errcode = 'PT422';
  end if;
  update public.review_reports
  set status = p_status, resolved_by = auth.uid(), resolved_at = now(),
      resolution_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_report_id
  returning review_id into v_review;
  if v_review is null then
    raise exception 'Report not found' using errcode = 'PT404';
  end if;
  perform private.write_audit('report_' || p_status::text, 'review_report', p_report_id::text,
    jsonb_build_object('review_id', v_review, 'hide_review', p_hide_review, 'note', p_note));
  if p_hide_review then
    perform public.admin_moderate_review(v_review, 'hidden', coalesce(p_note, 'Hidden after report'));
  end if;
end;
$$;

-- Same as 0003 except that staff with the "appointments" permission may
-- cancel like an administrator.
create or replace function public.update_appointment_status(
  p_appointment_id uuid,
  p_status public.appointment_status,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.user_role := private.current_user_role();
  v_appt public.appointments;
  v_is_patient boolean;
  v_is_doctor boolean;
  v_is_admin boolean;
  v_window integer := private.setting_int('cancellation_window_hours', 12);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_allowed boolean := false;
begin
  if v_uid is null or v_role is null then
    raise exception 'Authentication required' using errcode = 'PT401';
  end if;

  select * into v_appt from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'Appointment not found' using errcode = 'PT404';
  end if;

  v_is_patient := v_appt.patient_id = v_uid;
  v_is_doctor := v_appt.doctor_id = v_uid;
  v_is_admin := private.has_permission('appointments');
  if not (v_is_patient or v_is_doctor or v_is_admin) then
    raise exception 'Appointment not found' using errcode = 'PT404';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'Note must be 500 characters or fewer' using errcode = 'PT422';
  end if;

  if p_status = 'confirmed' then
    v_allowed := v_appt.starts_at > now() and (
      (v_is_doctor and (v_appt.status = 'pending'
        or (v_appt.status = 'rescheduled' and v_appt.rescheduled_by is distinct from v_appt.doctor_id)))
      or (v_is_patient and v_appt.status = 'rescheduled' and v_appt.rescheduled_by = v_appt.doctor_id)
    );
  elsif p_status = 'rejected' then
    v_allowed := v_is_doctor and v_appt.starts_at > now()
      and v_appt.status in ('pending', 'rescheduled');
  elsif p_status = 'cancelled' then
    if v_appt.status not in ('pending', 'confirmed', 'rescheduled') then
      v_allowed := false;
    elsif v_is_patient then
      if v_appt.starts_at <= now() then
        v_allowed := false;
      elsif v_appt.status in ('confirmed', 'rescheduled')
            and v_appt.starts_at < now() + make_interval(hours => v_window) then
        raise exception 'Confirmed appointments can only be cancelled at least % hours before the start time. Please contact the doctor through Messages.', v_window
          using errcode = 'PT422';
      else
        v_allowed := true;
      end if;
    elsif v_is_doctor then
      if v_note is null then
        raise exception 'Please give the patient a reason for cancelling' using errcode = 'PT422';
      end if;
      v_allowed := v_appt.starts_at > now();
    elsif v_is_admin then
      v_allowed := true;
    end if;
  elsif p_status = 'completed' then
    v_allowed := v_is_doctor and v_appt.status = 'confirmed' and v_appt.starts_at <= now();
    if v_is_doctor and v_appt.status = 'confirmed' and v_appt.starts_at > now() then
      raise exception 'An appointment can only be marked completed after it has started' using errcode = 'PT422';
    end if;
  else
    raise exception 'Use rescheduling to change the appointment time' using errcode = 'PT422';
  end if;

  if not v_allowed then
    raise exception 'This appointment cannot be changed from % to %', v_appt.status, p_status
      using errcode = 'PT409';
  end if;

  update public.appointments
  set status = p_status,
      status_note = coalesce(v_note, case when p_status in ('confirmed', 'completed') then status_note end),
      cancelled_by = case when p_status = 'cancelled' then v_uid else cancelled_by end
  where id = p_appointment_id;

  if v_is_admin and not (v_is_patient or v_is_doctor) then
    perform private.write_audit('appointment_' || p_status::text, 'appointment', p_appointment_id::text,
      jsonb_build_object('from', v_appt.status, 'note', v_note));
  end if;
end;
$$;

create or replace function public.admin_update_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := jsonb_typeof(p_value);
  v_num numeric;
begin
  if not private.is_admin() then
    raise exception 'Administrator access required' using errcode = 'PT403';
  end if;
  if not exists (select 1 from public.system_settings where key = p_key) then
    raise exception 'Unknown setting' using errcode = 'PT404';
  end if;

  if p_key in ('cancellation_window_hours', 'min_booking_notice_hours', 'max_booking_days_ahead', 'reminder_hours_before',
               'platform_service_fee', 'doctor_verification_fee', 'pro_plan_monthly_price', 'featured_boost_weekly_price') then
    if v_type <> 'number' then
      raise exception '% must be a whole number', p_key using errcode = 'PT422';
    end if;
    v_num := (p_value #>> '{}')::numeric;
    if v_num <> trunc(v_num)
       or (p_key = 'cancellation_window_hours' and v_num not between 0 and 168)
       or (p_key = 'min_booking_notice_hours' and v_num not between 0 and 168)
       or (p_key = 'max_booking_days_ahead' and v_num not between 1 and 365)
       or (p_key = 'reminder_hours_before' and v_num not between 1 and 168)
       or (p_key in ('platform_service_fee', 'doctor_verification_fee', 'pro_plan_monthly_price', 'featured_boost_weekly_price')
           and v_num not between 0 and 1000000) then
      raise exception 'Value out of range for %', p_key using errcode = 'PT422';
    end if;
  elsif p_key = 'allow_registrations' then
    if v_type <> 'boolean' then
      raise exception 'allow_registrations must be true or false' using errcode = 'PT422';
    end if;
  elsif p_key = 'currency' then
    if v_type <> 'string' or (p_value #>> '{}') !~ '^[A-Z]{3}$' then
      raise exception 'currency must be a 3-letter ISO code' using errcode = 'PT422';
    end if;
  elsif p_key = 'support_email' then
    if v_type <> 'string' or (p_value #>> '{}') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'support_email must be an email address' using errcode = 'PT422';
    end if;
  elsif p_key = 'payment_instructions' then
    if v_type <> 'string' or char_length(p_value #>> '{}') not between 1 and 200 then
      raise exception 'payment_instructions must be text up to 200 characters' using errcode = 'PT422';
    end if;
  else
    if v_type <> 'string' or char_length(p_value #>> '{}') not between 1 and 100 then
      raise exception '% must be text up to 100 characters', p_key using errcode = 'PT422';
    end if;
  end if;

  update public.system_settings set value = p_value, updated_by = auth.uid() where key = p_key;
end;
$$;

-- -----------------------------------------------------------------------------
-- Directory: Featured doctors first, then Pro, in the default ("rating") sort.
-- Explicit sorts (fee, experience, name) are respected as chosen.
-- -----------------------------------------------------------------------------
create or replace function public.search_doctors(
  p_query text default null,
  p_specialty_id uuid default null,
  p_min_fee numeric default null,
  p_max_fee numeric default null,
  p_available_on date default null,
  p_consultation_type public.consultation_type default null,
  p_sort text default 'rating',
  p_limit integer default 12,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with matches as (
    select d.*, p.full_name, p.avatar_url, p.timezone,
           coalesce(d.featured_until > now(), false) as is_featured,
           coalesce(d.pro_until > now(), false) as is_pro
    from public.doctor_profiles d
    join public.profiles p on p.id = d.id
    where d.verification_status = 'verified'
      and p.role = 'doctor'
      and p.account_status = 'active'
      and (
        p_query is null or btrim(p_query) = ''
        or p.full_name ilike '%' || btrim(p_query) || '%'
        or d.city ilike '%' || btrim(p_query) || '%'
        or d.clinic_name ilike '%' || btrim(p_query) || '%'
        or exists (
          select 1 from public.doctor_specialties ds
          join public.specialties sp on sp.id = ds.specialty_id
          where ds.doctor_id = d.id and sp.name ilike '%' || btrim(p_query) || '%'
        )
      )
      and (p_specialty_id is null or exists (
        select 1 from public.doctor_specialties ds
        where ds.doctor_id = d.id and ds.specialty_id = p_specialty_id
      ))
      and (p_min_fee is null or d.consultation_fee >= p_min_fee)
      and (p_max_fee is null or d.consultation_fee <= p_max_fee)
      and (p_consultation_type is null
           or (p_consultation_type = 'online' and d.offers_online)
           or (p_consultation_type = 'in_person' and d.offers_in_person))
      and (p_available_on is null or (
        d.is_accepting_patients
        and exists (select 1 from private.available_slots(d.id, p_available_on, p_available_on))
      ))
  ),
  page as (
    select m.*
    from matches m
    order by
      case when p_sort = 'fee_asc' then m.consultation_fee end asc nulls last,
      case when p_sort = 'fee_desc' then m.consultation_fee end desc nulls last,
      case when p_sort = 'experience' then m.years_experience end desc nulls last,
      case when p_sort = 'name' then m.full_name end asc,
      case when coalesce(p_sort, 'rating') = 'rating' then m.is_featured end desc,
      case when coalesce(p_sort, 'rating') = 'rating' then m.is_pro end desc,
      m.rating_avg desc, m.rating_count desc, m.full_name asc
    limit least(greatest(coalesce(p_limit, 12), 1), 50)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from matches),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pg.id,
        'full_name', pg.full_name,
        'title', pg.title,
        'avatar_url', pg.avatar_url,
        'city', pg.city,
        'clinic_name', pg.clinic_name,
        'years_experience', pg.years_experience,
        'consultation_fee', pg.consultation_fee,
        'offers_online', pg.offers_online,
        'offers_in_person', pg.offers_in_person,
        'is_accepting_patients', pg.is_accepting_patients,
        'rating_avg', pg.rating_avg,
        'rating_count', pg.rating_count,
        'languages', pg.languages,
        'timezone', pg.timezone,
        'is_featured', pg.is_featured,
        'is_pro', pg.is_pro,
        'specialties', coalesce((
          select jsonb_agg(jsonb_build_object('id', sp.id, 'name', sp.name, 'is_primary', ds.is_primary)
                           order by ds.is_primary desc, sp.name)
          from public.doctor_specialties ds
          join public.specialties sp on sp.id = ds.specialty_id
          where ds.doctor_id = pg.id
        ), '[]'::jsonb)
      ))
      from page pg
    ), '[]'::jsonb)
  );
$$;

-- -----------------------------------------------------------------------------
-- Function privileges for the new public functions
-- -----------------------------------------------------------------------------
revoke execute on function
  public.admin_review_plan_request(uuid, boolean, text),
  public.admin_set_staff_permissions(uuid, text[]),
  public.admin_set_user_restrictions(uuid, boolean, boolean, boolean)
from public, anon;
grant execute on function
  public.admin_review_plan_request(uuid, boolean, text),
  public.admin_set_staff_permissions(uuid, text[]),
  public.admin_set_user_restrictions(uuid, boolean, boolean, boolean)
to authenticated;
