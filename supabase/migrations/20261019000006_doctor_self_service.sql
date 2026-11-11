-- =============================================================================
-- MediConnect: doctor self-service helpers (atomic schedule and specialty
-- updates) and visibility of a doctor's profile to their own patients.
-- =============================================================================

-- Patients keep seeing the doctor of their past appointments even if the
-- doctor is later unverified or suspended.
create policy "doctor_profiles: appointment counterparts read" on public.doctor_profiles
  for select to authenticated using (private.shares_appointment(id));

-- Replaces the caller's weekly schedule in one transaction.
-- p_slots: [{"day_of_week": 1, "start_time": "09:00", "end_time": "12:00"}, ...]
create or replace function public.set_doctor_availability(p_slots jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if private.current_user_role() is distinct from 'doctor' then
    raise exception 'Only doctors can manage availability' using errcode = 'PT403';
  end if;
  if jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) > 50 then
    raise exception 'Provide up to 50 availability blocks' using errcode = 'PT422';
  end if;

  delete from public.doctor_availability where doctor_id = v_uid;
  begin
    insert into public.doctor_availability (doctor_id, day_of_week, start_time, end_time)
    select v_uid, (s ->> 'day_of_week')::smallint, (s ->> 'start_time')::time, (s ->> 'end_time')::time
    from jsonb_array_elements(p_slots) s;
  exception
    when exclusion_violation then
      raise exception 'Availability blocks on the same day cannot overlap' using errcode = 'PT422';
    when check_violation or invalid_datetime_format or invalid_text_representation or not_null_violation then
      raise exception 'Each block needs a valid day and a start time before its end time' using errcode = 'PT422';
  end;
end;
$$;

-- Replaces the caller's specialties in one transaction.
create or replace function public.set_doctor_specialties(p_specialty_ids uuid[], p_primary_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if private.current_user_role() is distinct from 'doctor' then
    raise exception 'Only doctors can manage specialties' using errcode = 'PT403';
  end if;
  if coalesce(cardinality(p_specialty_ids), 0) not between 1 and 5 then
    raise exception 'Choose between 1 and 5 specialties' using errcode = 'PT422';
  end if;
  if exists (
    select 1 from unnest(p_specialty_ids) as i(id)
    where not exists (select 1 from public.specialties s where s.id = i.id and s.is_active)
  ) then
    raise exception 'One of the selected specialties is not available' using errcode = 'PT422';
  end if;
  if p_primary_id is not null and not (p_primary_id = any (p_specialty_ids)) then
    raise exception 'The primary specialty must be one of the selected specialties' using errcode = 'PT422';
  end if;

  delete from public.doctor_specialties where doctor_id = v_uid;
  insert into public.doctor_specialties (doctor_id, specialty_id, is_primary)
  select distinct v_uid, i.id, i.id = coalesce(p_primary_id, p_specialty_ids[1])
  from unnest(p_specialty_ids) as i(id);
end;
$$;

revoke execute on function public.set_doctor_availability(jsonb), public.set_doctor_specialties(uuid[], uuid)
  from public, anon;
grant execute on function public.set_doctor_availability(jsonb), public.set_doctor_specialties(uuid[], uuid)
  to authenticated;
