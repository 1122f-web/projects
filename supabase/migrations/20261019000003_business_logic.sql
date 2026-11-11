-- =============================================================================
-- MediConnect: business logic
-- Booking, scheduling, status workflow, chat, notifications, reviews,
-- verification and administration. Client-callable functions live in public
-- (exposed as RPC); internals live in private.
--
-- Error convention: functions raise SQLSTATE 'PTxxx' so the Data API answers
-- with HTTP status xxx and the backend can relay a safe, friendly message.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Settings helpers
-- -----------------------------------------------------------------------------
create or replace function private.setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::integer end
     from public.system_settings s where s.key = p_key),
    p_default
  );
$$;

create or replace function private.format_ts(p_ts timestamptz, p_tz text)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_ts at time zone p_tz, 'Dy DD Mon YYYY, HH24:MI') || ' (' || p_tz || ')';
$$;

create or replace function private.display_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.role = 'doctor' then coalesce(d.title || ' ', '') || p.full_name else p.full_name end
  from public.profiles p
  left join public.doctor_profiles d on d.id = p.id
  where p.id = p_user_id;
$$;

-- -----------------------------------------------------------------------------
-- Notifications helper. Notification text never includes clinical details
-- (visit reasons, message contents) so emails carry no health information.
-- -----------------------------------------------------------------------------
create or replace function private.notify(
  p_user_id uuid,
  p_type public.notification_type,
  p_title text,
  p_body text,
  p_link text default null,
  p_data jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_email boolean;
begin
  select p.email_notifications into v_email from public.profiles p where p.id = p_user_id;
  if not found then
    return null;
  end if;

  insert into public.notifications (user_id, type, title, body, link, data, email_status)
  values (
    p_user_id, p_type, left(p_title, 200), left(p_body, 1000), p_link,
    coalesce(p_data, '{}'::jsonb),
    case when v_email then 'pending'::public.email_status else 'skipped'::public.email_status end
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.notify_admins(
  p_type public.notification_type,
  p_title text,
  p_body text,
  p_link text default null,
  p_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid;
begin
  for v_admin in
    select p.id from public.profiles p where p.role = 'admin' and p.account_status = 'active'
  loop
    perform private.notify(v_admin, p_type, p_title, p_body, p_link, p_data);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Doctor directory helpers
-- -----------------------------------------------------------------------------
create or replace function private.is_bookable_doctor(p_doctor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_public_doctor(p_doctor_id)
     and coalesce((select d.is_accepting_patients from public.doctor_profiles d where d.id = p_doctor_id), false);
$$;

-- All slots generated from the weekly schedule between two doctor-local dates.
create or replace function private.slot_candidates(p_doctor_id uuid, p_from date, p_to date)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with doc as (
    select d.id, d.slot_duration_minutes as dur, p.timezone as tz
    from public.doctor_profiles d
    join public.profiles p on p.id = d.id
    where d.id = p_doctor_id
  ),
  days as (
    select g::date as day
    from generate_series(p_from::timestamp, least(p_to, p_from + 62)::timestamp, interval '1 day') g
  ),
  local_slots as (
    select doc.tz, doc.dur, s as local_start
    from doc
    cross join days
    join public.doctor_availability av
      on av.doctor_id = doc.id and av.day_of_week = extract(dow from days.day)
    cross join lateral generate_series(
      days.day + av.start_time,
      days.day + av.end_time - make_interval(mins => doc.dur),
      make_interval(mins => doc.dur)
    ) s
  )
  select
    (local_start at time zone tz) as starts_at,
    ((local_start + make_interval(mins => dur)) at time zone tz) as ends_at
  from local_slots;
$$;

-- Bookable slots: inside the booking window, not overlapping an active
-- appointment (optionally ignoring one being rescheduled) or time off.
create or replace function private.available_slots(
  p_doctor_id uuid,
  p_from date,
  p_to date,
  p_exclude_appointment uuid default null
)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.starts_at, c.ends_at
  from private.slot_candidates(p_doctor_id, p_from, p_to) c
  where c.starts_at >= now() + make_interval(hours => private.setting_int('min_booking_notice_hours', 1))
    and c.starts_at <= now() + make_interval(days => private.setting_int('max_booking_days_ahead', 60))
    and not exists (
      select 1 from public.appointments a
      where a.doctor_id = p_doctor_id
        and a.status in ('pending', 'confirmed', 'rescheduled')
        and (p_exclude_appointment is null or a.id <> p_exclude_appointment)
        and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(c.starts_at, c.ends_at, '[)')
    )
    and not exists (
      select 1 from public.doctor_time_off t
      where t.doctor_id = p_doctor_id
        and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(c.starts_at, c.ends_at, '[)')
    )
  order by c.starts_at;
$$;

-- Returns the slot end time, or raises 409 when the slot cannot be booked.
create or replace function private.assert_slot_available(
  p_doctor_id uuid,
  p_starts_at timestamptz,
  p_exclude_appointment uuid default null
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_day date;
  v_end timestamptz;
begin
  select p.timezone into v_tz from public.profiles p where p.id = p_doctor_id;
  if v_tz is null then
    raise exception 'Doctor not found' using errcode = 'PT404';
  end if;
  v_day := (p_starts_at at time zone v_tz)::date;

  select s.ends_at into v_end
  from private.available_slots(p_doctor_id, v_day, v_day, p_exclude_appointment) s
  where s.starts_at = p_starts_at;

  if v_end is null then
    raise exception 'This time slot is not available. Please choose another time.'
      using errcode = 'PT409';
  end if;
  return v_end;
end;
$$;

-- Public: list bookable slots for a verified doctor (max 31 days per call).
create or replace function public.get_available_slots(p_doctor_id uuid, p_from date, p_to date)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.starts_at, s.ends_at
  from private.available_slots(p_doctor_id, p_from, least(p_to, p_from + 31)) s
  where private.is_bookable_doctor(p_doctor_id) and p_to >= p_from;
$$;

-- Public: search the doctor directory. Only verified, active doctors appear.
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
    select d.*, p.full_name, p.avatar_url, p.timezone
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

-- Public: a verified doctor's profile page data.
create or replace function public.get_doctor_public(p_doctor_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', d.id,
    'full_name', p.full_name,
    'title', d.title,
    'avatar_url', p.avatar_url,
    'bio', d.bio,
    'qualifications', d.qualifications,
    'years_experience', d.years_experience,
    'languages', d.languages,
    'consultation_fee', d.consultation_fee,
    'clinic_name', d.clinic_name,
    'clinic_address', d.clinic_address,
    'city', d.city,
    'offers_online', d.offers_online,
    'offers_in_person', d.offers_in_person,
    'slot_duration_minutes', d.slot_duration_minutes,
    'is_accepting_patients', d.is_accepting_patients,
    'rating_avg', d.rating_avg,
    'rating_count', d.rating_count,
    'timezone', p.timezone,
    'verified_at', d.verified_at,
    'specialties', coalesce((
      select jsonb_agg(jsonb_build_object('id', sp.id, 'name', sp.name, 'slug', sp.slug, 'is_primary', ds.is_primary)
                       order by ds.is_primary desc, sp.name)
      from public.doctor_specialties ds
      join public.specialties sp on sp.id = ds.specialty_id
      where ds.doctor_id = d.id
    ), '[]'::jsonb),
    'availability', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day_of_week', av.day_of_week,
        'start_time', to_char(av.start_time, 'HH24:MI'),
        'end_time', to_char(av.end_time, 'HH24:MI')
      ) order by av.day_of_week, av.start_time)
      from public.doctor_availability av
      where av.doctor_id = d.id
    ), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(r.obj order by r.created_at desc)
      from (
        select rv.created_at, jsonb_build_object(
          'id', rv.id,
          'rating', rv.rating,
          'comment', rv.comment,
          'created_at', rv.created_at,
          -- Only a first name and initial, to limit exposure of patients.
          'patient_name', split_part(pp.full_name, ' ', 1) || coalesce(
            ' ' || nullif(left(split_part(pp.full_name, ' ', 2), 1), '') || '.', '')
        ) as obj
        from public.reviews rv
        join public.profiles pp on pp.id = rv.patient_id
        where rv.doctor_id = d.id and rv.status = 'published'
        order by rv.created_at desc
        limit 20
      ) r
    ), '[]'::jsonb)
  )
  from public.doctor_profiles d
  join public.profiles p on p.id = d.id
  where d.id = p_doctor_id and private.is_public_doctor(d.id);
$$;

-- -----------------------------------------------------------------------------
-- Booking
-- -----------------------------------------------------------------------------
create or replace function private.raise_overlap(p_constraint text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_constraint = 'appointments_patient_no_overlap' then
    raise exception 'You already have another appointment at this time.' using errcode = 'PT409';
  end if;
  raise exception 'This time slot was just booked by someone else. Please choose another time.'
    using errcode = 'PT409';
end;
$$;

create or replace function public.book_appointment(
  p_doctor_id uuid,
  p_starts_at timestamptz,
  p_consultation_type public.consultation_type,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_doc public.doctor_profiles;
  v_end timestamptz;
  v_id uuid;
  v_constraint text;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = 'PT401';
  end if;
  if private.current_user_role() is distinct from 'patient' then
    raise exception 'Only patient accounts can book appointments' using errcode = 'PT403';
  end if;
  if not private.is_public_doctor(p_doctor_id) then
    raise exception 'Doctor not found' using errcode = 'PT404';
  end if;

  select * into v_doc from public.doctor_profiles d where d.id = p_doctor_id;
  if not v_doc.is_accepting_patients then
    raise exception 'This doctor is not accepting new appointments right now' using errcode = 'PT409';
  end if;
  if (p_consultation_type = 'online' and not v_doc.offers_online)
     or (p_consultation_type = 'in_person' and not v_doc.offers_in_person) then
    raise exception 'This doctor does not offer that consultation type' using errcode = 'PT422';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000 then
    raise exception 'Please describe the reason for your visit (3 to 1000 characters)' using errcode = 'PT422';
  end if;

  v_end := private.assert_slot_available(p_doctor_id, p_starts_at, null);

  begin
    insert into public.appointments (patient_id, doctor_id, starts_at, ends_at, consultation_type, reason, fee)
    values (v_uid, p_doctor_id, p_starts_at, v_end, p_consultation_type, btrim(p_reason), v_doc.consultation_fee)
    returning id into v_id;
  exception when exclusion_violation then
    get stacked diagnostics v_constraint = constraint_name;
    perform private.raise_overlap(v_constraint);
  end;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Status workflow
--   doctor : pending -> confirmed | rejected
--            rescheduled (by patient) -> confirmed | rejected
--            pending | confirmed | rescheduled -> cancelled (note required)
--            confirmed -> completed (after start time)
--   patient: rescheduled (by doctor) -> confirmed
--            pending -> cancelled (any time before start)
--            confirmed | rescheduled -> cancelled (outside the policy window)
--   admin  : pending | confirmed | rescheduled -> cancelled
-- -----------------------------------------------------------------------------
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
  v_is_admin := v_role = 'admin';
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

create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_starts_at timestamptz,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_appt public.appointments;
  v_window integer := private.setting_int('cancellation_window_hours', 12);
  v_end timestamptz;
  v_constraint text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null or private.current_user_role() is null then
    raise exception 'Authentication required' using errcode = 'PT401';
  end if;

  select * into v_appt from public.appointments a where a.id = p_appointment_id for update;
  if not found or (v_appt.patient_id <> v_uid and v_appt.doctor_id <> v_uid) then
    raise exception 'Appointment not found' using errcode = 'PT404';
  end if;
  if v_appt.status not in ('pending', 'confirmed', 'rescheduled') or v_appt.starts_at <= now() then
    raise exception 'This appointment can no longer be rescheduled' using errcode = 'PT409';
  end if;
  if v_appt.patient_id = v_uid and v_appt.status in ('confirmed', 'rescheduled')
     and v_appt.starts_at < now() + make_interval(hours => v_window) then
    raise exception 'Confirmed appointments can only be rescheduled at least % hours before the start time', v_window
      using errcode = 'PT422';
  end if;
  if p_new_starts_at = v_appt.starts_at then
    raise exception 'Please choose a different time' using errcode = 'PT422';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'Note must be 500 characters or fewer' using errcode = 'PT422';
  end if;

  v_end := private.assert_slot_available(v_appt.doctor_id, p_new_starts_at, v_appt.id);

  begin
    update public.appointments
    set previous_starts_at = starts_at,
        starts_at = p_new_starts_at,
        ends_at = v_end,
        status = 'rescheduled',
        rescheduled_by = v_uid,
        reminder_sent_at = null,
        status_note = v_note
    where id = v_appt.id;
  exception when exclusion_violation then
    get stacked diagnostics v_constraint = constraint_name;
    perform private.raise_overlap(v_constraint);
  end;
end;
$$;

create or replace function public.set_appointment_notes(p_appointment_id uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_notes is not null and char_length(p_notes) > 4000 then
    raise exception 'Notes must be 4000 characters or fewer' using errcode = 'PT422';
  end if;
  update public.appointments
  set doctor_notes = nullif(btrim(coalesce(p_notes, '')), '')
  where id = p_appointment_id and doctor_id = auth.uid() and private.current_user_role() = 'doctor';
  if not found then
    raise exception 'Appointment not found' using errcode = 'PT404';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Chat
-- -----------------------------------------------------------------------------
create or replace function public.get_my_conversations()
returns table (
  conversation_id uuid,
  other_user_id uuid,
  other_name text,
  other_avatar_url text,
  other_role public.user_role,
  other_last_read_at timestamptz,
  my_last_read_at timestamptz,
  last_message_body text,
  last_message_has_attachment boolean,
  last_message_sender_id uuid,
  last_message_at timestamptz,
  unread_count integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    op.user_id,
    private.display_name(op.user_id),
    other.avatar_url,
    other.role,
    nullif(op.last_read_at, '-infinity'),
    nullif(me.last_read_at, '-infinity'),
    lm.body,
    lm.attachment_path is not null,
    lm.sender_id,
    c.last_message_at,
    (select count(*)::integer from public.messages m
      where m.conversation_id = c.id and m.sender_id <> me.user_id and m.created_at > me.last_read_at),
    c.created_at
  from public.conversation_participants me
  join public.conversations c on c.id = me.conversation_id
  join public.conversation_participants op on op.conversation_id = c.id and op.user_id <> me.user_id
  join public.profiles other on other.id = op.user_id
  left join lateral (
    select m.body, m.attachment_path, m.sender_id
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where me.user_id = auth.uid()
  order by coalesce(c.last_message_at, c.created_at) desc;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  update public.conversation_participants
  set last_read_at = greatest(last_read_at, v_now)
  where conversation_id = p_conversation_id and user_id = auth.uid();
  if not found then
    raise exception 'Conversation not found' using errcode = 'PT404';
  end if;

  update public.notifications
  set read_at = v_now
  where user_id = auth.uid() and type = 'new_message' and read_at is null
    and data ->> 'conversation_id' = p_conversation_id::text;
  return v_now;
end;
$$;

-- -----------------------------------------------------------------------------
-- Notifications (client side)
-- -----------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.delete_notification(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications where id = p_id and user_id = auth.uid();
  if not found then
    raise exception 'Notification not found' using errcode = 'PT404';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Doctor verification (admin)
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
  if not private.is_admin() then
    raise exception 'Administrator access required' using errcode = 'PT403';
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

-- -----------------------------------------------------------------------------
-- Administration
-- -----------------------------------------------------------------------------
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
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not private.is_admin() then
    raise exception 'Administrator access required' using errcode = 'PT403';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own account status' using errcode = 'PT422';
  end if;
  if p_status = 'suspended' and v_reason is null then
    raise exception 'Please record a reason for the suspension' using errcode = 'PT422';
  end if;

  select account_status into v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'User not found' using errcode = 'PT404';
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

  update public.profiles set role = p_role where id = p_user_id;
  if p_role = 'doctor' then
    insert into public.doctor_profiles (id) values (p_user_id) on conflict (id) do nothing;
  end if;
  perform private.write_audit('role_changed', 'profile', p_user_id::text,
    jsonb_build_object('from', v_old, 'to', p_role));
end;
$$;

-- Bootstrap: grant admin by email. Executable only with the service role
-- (backend script `npm run make-admin`) or directly in the SQL editor.
create or replace function public.grant_admin_by_email(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_old public.user_role;
begin
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_id is null then
    raise exception 'No user with that email' using errcode = 'PT404';
  end if;
  select role into v_old from public.profiles where id = v_id;
  update public.profiles set role = 'admin', account_status = 'active' where id = v_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values (null, 'admin_granted', 'profile', v_id::text,
          jsonb_build_object('from', v_old, 'via', 'service_role'));
  return v_id;
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
  if not private.is_admin() then
    raise exception 'Administrator access required' using errcode = 'PT403';
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
  if not private.is_admin() then
    raise exception 'Administrator access required' using errcode = 'PT403';
  end if;
  return jsonb_build_object(
    'users', (select jsonb_object_agg(role, n) from (select role, count(*) n from public.profiles group by role) x),
    'suspended_users', (select count(*) from public.profiles where account_status = 'suspended'),
    'doctors_verified', (select count(*) from public.doctor_profiles where verification_status = 'verified'),
    'pending_verifications', (select count(*) from public.doctor_verification_requests where status = 'pending'),
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
  if not private.is_admin() then
    raise exception 'Administrator access required' using errcode = 'PT403';
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
  if not private.is_admin() then
    raise exception 'Administrator access required' using errcode = 'PT403';
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

  if p_key in ('cancellation_window_hours', 'min_booking_notice_hours', 'max_booking_days_ahead', 'reminder_hours_before') then
    if v_type <> 'number' then
      raise exception '% must be a whole number', p_key using errcode = 'PT422';
    end if;
    v_num := (p_value #>> '{}')::numeric;
    if v_num <> trunc(v_num)
       or (p_key = 'cancellation_window_hours' and v_num not between 0 and 168)
       or (p_key = 'min_booking_notice_hours' and v_num not between 0 and 168)
       or (p_key = 'max_booking_days_ahead' and v_num not between 1 and 365)
       or (p_key = 'reminder_hours_before' and v_num not between 1 and 168) then
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
  else
    if v_type <> 'string' or char_length(p_value #>> '{}') not between 1 and 100 then
      raise exception '% must be text up to 100 characters', p_key using errcode = 'PT422';
    end if;
  end if;

  update public.system_settings set value = p_value, updated_by = auth.uid() where key = p_key;
end;
$$;

-- -----------------------------------------------------------------------------
-- Scheduled jobs and email outbox (service role only)
-- -----------------------------------------------------------------------------
create or replace function public.run_scheduled_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours integer := private.setting_int('reminder_hours_before', 24);
  v_expired integer := 0;
  v_reminders integer := 0;
  r record;
begin
  -- Requests nobody confirmed before the start time are closed automatically
  -- so the slot history stays accurate.
  for r in
    update public.appointments
    set status = 'cancelled', status_note = 'Closed automatically: not confirmed before the start time'
    where status in ('pending', 'rescheduled') and starts_at <= now()
    returning id, patient_id, doctor_id
  loop
    v_expired := v_expired + 1;
  end loop;

  for r in
    update public.appointments a
    set reminder_sent_at = now()
    where a.status = 'confirmed'
      and a.reminder_sent_at is null
      and a.starts_at > now()
      and a.starts_at <= now() + make_interval(hours => v_hours)
    returning a.id, a.patient_id, a.doctor_id, a.starts_at, a.consultation_type
  loop
    v_reminders := v_reminders + 1;
    perform private.notify(r.patient_id, 'appointment_reminder', 'Upcoming appointment reminder',
      'Reminder: your ' || replace(r.consultation_type::text, '_', '-') || ' appointment with '
        || private.display_name(r.doctor_id) || ' is on '
        || private.format_ts(r.starts_at, (select timezone from public.profiles where id = r.patient_id)) || '.',
      '/patient/appointments/' || r.id, jsonb_build_object('appointment_id', r.id));
    perform private.notify(r.doctor_id, 'appointment_reminder', 'Upcoming appointment reminder',
      'Reminder: you have an appointment with ' || private.display_name(r.patient_id) || ' on '
        || private.format_ts(r.starts_at, (select timezone from public.profiles where id = r.doctor_id)) || '.',
      '/doctor/appointments/' || r.id, jsonb_build_object('appointment_id', r.id));
  end loop;

  return jsonb_build_object('expired', v_expired, 'reminders', v_reminders);
end;
$$;

-- Atomically claims notifications whose email still needs sending.
create or replace function public.claim_pending_emails(p_limit integer default 25)
returns table (
  id uuid,
  type public.notification_type,
  title text,
  body text,
  link text,
  email text,
  full_name text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select n.id
    from public.notifications n
    where (n.email_status = 'pending'
           or (n.email_status = 'failed' and n.email_attempts < 3 and n.updated_at < now() - interval '5 minutes')
           or (n.email_status = 'sending' and n.updated_at < now() - interval '10 minutes'))
      and n.created_at > now() - interval '2 days'
    order by n.created_at
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
    for update skip locked
  ),
  claimed as (
    update public.notifications n
    set email_status = 'sending', email_attempts = n.email_attempts + 1
    from candidates c
    where n.id = c.id
    returning n.id, n.type, n.title, n.body, n.link, n.user_id
  )
  select c.id, c.type, c.title, c.body, c.link, u.email::text, p.full_name
  from claimed c
  join auth.users u on u.id = c.user_id
  join public.profiles p on p.id = c.user_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- Supabase grants EXECUTE on new public functions to anon and authenticated by
-- default, so each one is set explicitly here.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.get_available_slots(uuid, date, date),
  public.search_doctors(text, uuid, numeric, numeric, date, public.consultation_type, text, integer, integer),
  public.get_doctor_public(uuid)
to anon, authenticated;

grant execute on function
  public.book_appointment(uuid, timestamptz, public.consultation_type, text),
  public.update_appointment_status(uuid, public.appointment_status, text),
  public.reschedule_appointment(uuid, timestamptz, text),
  public.set_appointment_notes(uuid, text),
  public.get_my_conversations(),
  public.mark_conversation_read(uuid),
  public.mark_notifications_read(uuid[]),
  public.delete_notification(uuid),
  public.admin_review_verification(uuid, boolean, text),
  public.admin_set_account_status(uuid, public.account_status, text),
  public.admin_set_user_role(uuid, public.user_role),
  public.admin_list_users(text, public.user_role, public.account_status, integer, integer),
  public.admin_stats(),
  public.admin_moderate_review(uuid, public.review_status, text),
  public.admin_resolve_report(uuid, public.report_status, text, boolean),
  public.admin_update_setting(text, jsonb)
to authenticated;

grant execute on function
  public.grant_admin_by_email(text),
  public.run_scheduled_jobs(),
  public.claim_pending_emails(integer)
to service_role;

grant execute on function private.setting_int(text, integer) to authenticated, anon, service_role;
