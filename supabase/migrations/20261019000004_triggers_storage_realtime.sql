-- =============================================================================
-- MediConnect: event triggers (notifications, conversations, ratings,
-- verification), Storage buckets with policies, and Realtime publication.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Appointments: create the conversation and notify the right people
-- -----------------------------------------------------------------------------
create or replace function private.on_appointment_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation uuid;
  v_patient_tz text;
  v_doctor_tz text;
begin
  insert into public.conversations (patient_id, doctor_id)
  values (new.patient_id, new.doctor_id)
  on conflict (patient_id, doctor_id) do nothing;

  select c.id into v_conversation from public.conversations c
  where c.patient_id = new.patient_id and c.doctor_id = new.doctor_id;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_conversation, new.patient_id), (v_conversation, new.doctor_id)
  on conflict do nothing;

  select timezone into v_patient_tz from public.profiles where id = new.patient_id;
  select timezone into v_doctor_tz from public.profiles where id = new.doctor_id;

  perform private.notify(new.patient_id, 'appointment_booked', 'Appointment request sent',
    'Your appointment request with ' || private.display_name(new.doctor_id) || ' for '
      || private.format_ts(new.starts_at, v_patient_tz)
      || ' was received. You will be notified when the doctor confirms it.',
    '/patient/appointments/' || new.id, jsonb_build_object('appointment_id', new.id));

  perform private.notify(new.doctor_id, 'appointment_booked', 'New appointment request',
    private.display_name(new.patient_id) || ' requested an appointment for '
      || private.format_ts(new.starts_at, v_doctor_tz) || '.',
    '/doctor/appointments/' || new.id, jsonb_build_object('appointment_id', new.id));
  return new;
end;
$$;

create trigger appointments_after_insert
  after insert on public.appointments
  for each row execute function private.on_appointment_created();

create or replace function private.on_appointment_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient_tz text;
  v_doctor_tz text;
  v_doctor_name text := private.display_name(new.doctor_id);
  v_patient_name text := private.display_name(new.patient_id);
  v_note text := case when new.status_note is not null and new.status_note is distinct from old.status_note
                      then ' Note: ' || new.status_note else '' end;
  v_patient_link text := '/patient/appointments/' || new.id;
  v_doctor_link text := '/doctor/appointments/' || new.id;
  v_data jsonb := jsonb_build_object('appointment_id', new.id, 'status', new.status);
begin
  select timezone into v_patient_tz from public.profiles where id = new.patient_id;
  select timezone into v_doctor_tz from public.profiles where id = new.doctor_id;

  -- Time change (reschedule): notify whoever did not make the change.
  if new.starts_at is distinct from old.starts_at then
    if new.rescheduled_by = new.doctor_id then
      perform private.notify(new.patient_id, 'appointment_rescheduled', 'Appointment rescheduled',
        v_doctor_name || ' moved your appointment to ' || private.format_ts(new.starts_at, v_patient_tz)
          || '. Please confirm the new time or cancel.' || v_note,
        v_patient_link, v_data);
    else
      perform private.notify(new.doctor_id, 'appointment_rescheduled', 'Reschedule request',
        v_patient_name || ' asked to move their appointment to '
          || private.format_ts(new.starts_at, v_doctor_tz) || '. Please confirm or reject it.' || v_note,
        v_doctor_link, v_data);
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'confirmed' then
    if old.status = 'rescheduled' and old.rescheduled_by = new.doctor_id then
      perform private.notify(new.doctor_id, 'appointment_confirmed', 'New time accepted',
        v_patient_name || ' accepted the new time: ' || private.format_ts(new.starts_at, v_doctor_tz) || '.',
        v_doctor_link, v_data);
    else
      perform private.notify(new.patient_id, 'appointment_confirmed', 'Appointment confirmed',
        v_doctor_name || ' confirmed your appointment on ' || private.format_ts(new.starts_at, v_patient_tz) || '.' || v_note,
        v_patient_link, v_data);
    end if;
  elsif new.status = 'rejected' then
    perform private.notify(new.patient_id, 'appointment_rejected', 'Appointment request declined',
      v_doctor_name || ' could not accept your appointment on '
        || private.format_ts(new.starts_at, v_patient_tz) || '.' || v_note,
      v_patient_link, v_data);
  elsif new.status = 'cancelled' then
    if new.cancelled_by = new.patient_id then
      perform private.notify(new.doctor_id, 'appointment_cancelled', 'Appointment cancelled',
        v_patient_name || ' cancelled the appointment on ' || private.format_ts(new.starts_at, v_doctor_tz) || '.' || v_note,
        v_doctor_link, v_data);
    elsif new.cancelled_by = new.doctor_id then
      perform private.notify(new.patient_id, 'appointment_cancelled', 'Appointment cancelled',
        v_doctor_name || ' cancelled your appointment on ' || private.format_ts(new.starts_at, v_patient_tz) || '.' || v_note,
        v_patient_link, v_data);
    else
      -- Cancelled by an administrator or closed automatically.
      perform private.notify(new.patient_id, 'appointment_cancelled', 'Appointment cancelled',
        'Your appointment with ' || v_doctor_name || ' on ' || private.format_ts(new.starts_at, v_patient_tz)
          || ' was cancelled.' || v_note,
        v_patient_link, v_data);
      perform private.notify(new.doctor_id, 'appointment_cancelled', 'Appointment cancelled',
        'The appointment with ' || v_patient_name || ' on ' || private.format_ts(new.starts_at, v_doctor_tz)
          || ' was cancelled.' || v_note,
        v_doctor_link, v_data);
    end if;
  elsif new.status = 'completed' then
    perform private.notify(new.patient_id, 'appointment_completed', 'Appointment completed',
      'Your appointment with ' || v_doctor_name || ' is complete. You can now leave a review.',
      v_patient_link, v_data);
  end if;
  return new;
end;
$$;

create trigger appointments_after_update
  after update of status, starts_at on public.appointments
  for each row execute function private.on_appointment_changed();

-- -----------------------------------------------------------------------------
-- Messages: bump the conversation, mark the sender's read state, and notify
-- the recipient (one unread notification per conversation, updated in place).
-- -----------------------------------------------------------------------------
create or replace function private.on_message_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
  v_role public.user_role;
  v_sender_name text := private.display_name(new.sender_id);
  v_updated integer;
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  update public.conversation_participants
  set last_read_at = greatest(last_read_at, new.created_at)
  where conversation_id = new.conversation_id and user_id = new.sender_id;

  for v_recipient, v_role in
    select cp.user_id, p.role
    from public.conversation_participants cp
    join public.profiles p on p.id = cp.user_id
    where cp.conversation_id = new.conversation_id and cp.user_id <> new.sender_id
  loop
    update public.notifications
    set data = jsonb_set(data, '{count}', to_jsonb(coalesce((data ->> 'count')::integer, 1) + 1)),
        body = 'You have ' || (coalesce((data ->> 'count')::integer, 1) + 1) || ' unread messages from ' || v_sender_name || '.'
    where user_id = v_recipient and type = 'new_message' and read_at is null
      and data ->> 'conversation_id' = new.conversation_id::text;
    get diagnostics v_updated = row_count;

    if v_updated = 0 then
      perform private.notify(v_recipient, 'new_message', 'New message from ' || v_sender_name,
        'You have a new message from ' || v_sender_name || '. Sign in to read it.',
        case when v_role = 'doctor' then '/doctor/messages/' else '/patient/messages/' end || new.conversation_id,
        jsonb_build_object('conversation_id', new.conversation_id, 'count', 1));
    end if;
  end loop;
  return new;
end;
$$;

create trigger messages_after_insert
  after insert on public.messages
  for each row execute function private.on_message_created();

-- -----------------------------------------------------------------------------
-- Reviews: keep the doctor's rating cache in sync and notify the doctor
-- -----------------------------------------------------------------------------
create or replace function private.refresh_doctor_rating(p_doctor_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.doctor_profiles d
  set rating_avg = coalesce((select round(avg(r.rating)::numeric, 2) from public.reviews r
                             where r.doctor_id = p_doctor_id and r.status = 'published'), 0),
      rating_count = (select count(*) from public.reviews r
                      where r.doctor_id = p_doctor_id and r.status = 'published')
  where d.id = p_doctor_id;
$$;

create or replace function private.on_review_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.refresh_doctor_rating(old.doctor_id);
    return old;
  end if;
  perform private.refresh_doctor_rating(new.doctor_id);
  if tg_op = 'INSERT' then
    perform private.notify(new.doctor_id, 'review_received', 'New review',
      'A patient left you a ' || new.rating || '-star review.', '/doctor/dashboard',
      jsonb_build_object('review_id', new.id));
  end if;
  return new;
end;
$$;

create trigger reviews_after_change
  after insert or update or delete on public.reviews
  for each row execute function private.on_review_changed();

-- -----------------------------------------------------------------------------
-- Verification requests: mark the doctor pending and alert administrators
-- -----------------------------------------------------------------------------
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
  return new;
end;
$$;

create trigger verification_before_insert
  before insert on public.doctor_verification_requests
  for each row execute function private.before_verification_insert();

create or replace function private.after_verification_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.doctor_profiles set verification_status = 'pending', verified_at = null
  where id = new.doctor_id;
  perform private.notify_admins('verification_submitted', 'Doctor verification request',
    private.display_name(new.doctor_id) || ' submitted credentials for verification.',
    '/admin/verifications', jsonb_build_object('request_id', new.id));
  return new;
end;
$$;

create trigger verification_after_insert
  after insert on public.doctor_verification_requests
  for each row execute function private.after_verification_insert();

-- Reports alert administrators too.
create or replace function private.after_report_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify_admins('system', 'Review reported',
    'A review was reported and needs moderation.', '/admin/reviews',
    jsonb_build_object('report_id', new.id, 'review_id', new.review_id));
  return new;
end;
$$;

create trigger review_reports_after_insert
  after insert on public.review_reports
  for each row execute function private.after_report_insert();

-- =============================================================================
-- Storage
--   avatars                 public read, owners write their own folder
--   verification-documents  private: the doctor and administrators only
--   chat-attachments        private: conversation participants only
-- Object paths: avatars/{user_id}/..., verification-documents/{doctor_id}/...,
-- chat-attachments/{conversation_id}/...
-- Uploads go through the backend (which checks file signatures) using the
-- user's own token, so these policies apply to every upload and download.
-- =============================================================================
-- Safe folder check: a folder name that is not a UUID simply fails the policy.
create or replace function private.can_access_conversation_folder(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_folder ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.is_conversation_participant(p_folder::uuid)
    else false
  end;
$$;
grant execute on function private.can_access_conversation_folder(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('verification-documents', 'verification-documents', false, 10485760,
    array['application/pdf', 'image/jpeg', 'image/png']),
  ('chat-attachments', 'chat-attachments', false, 10485760,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "avatars: owner uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner updates" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "verification docs: doctor uploads own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.current_user_role() = 'doctor'
  );
create policy "verification docs: doctor or admin reads" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'verification-documents'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or private.is_admin())
  );

create policy "chat attachments: participants upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and private.is_active_user()
    and private.can_access_conversation_folder((storage.foldername(name))[1])
  );
create policy "chat attachments: participants read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and private.can_access_conversation_folder((storage.foldername(name))[1])
  );

-- =============================================================================
-- Realtime: stream row changes (RLS is applied to every subscriber)
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

alter publication supabase_realtime add table
  public.messages,
  public.notifications,
  public.conversation_participants,
  public.appointments;
