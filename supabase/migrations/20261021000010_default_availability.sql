-- =============================================================================
-- MediConnect: default weekly hours for doctors
-- Slots are not stored; they are generated from doctor_availability and the
-- doctor's slot_duration_minutes (default 30). Giving every new doctor
-- Monday to Friday, 09:00 to 17:00 therefore produces 16 half-hour slots a day
-- as soon as the doctor is verified. Doctors change it on the Schedule page.
-- =============================================================================

create or replace function private.add_default_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.doctor_availability (doctor_id, day_of_week, start_time, end_time)
  select new.id, d, time '09:00', time '17:00'
  from generate_series(1, 5) d
  where not exists (select 1 from public.doctor_availability a where a.doctor_id = new.id);
  return new;
end;
$$;

-- Fires for self-registered doctors (handle_new_user) and for accounts an
-- administrator turns into doctors (admin_set_user_role).
create trigger doctor_profiles_default_availability
  after insert on public.doctor_profiles
  for each row execute function private.add_default_availability();

-- Existing doctors with no hours yet. Verified doctors are skipped: an empty
-- schedule may be deliberate, and adding hours would open them to bookings.
insert into public.doctor_availability (doctor_id, day_of_week, start_time, end_time)
select dp.id, d, time '09:00', time '17:00'
from public.doctor_profiles dp
cross join generate_series(1, 5) d
where dp.verification_status <> 'verified'
  and not exists (select 1 from public.doctor_availability a where a.doctor_id = dp.id);
