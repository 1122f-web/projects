-- =============================================================================
-- MediConnect: enforce the "allow_registrations" setting for every sign-up,
-- including direct calls to Supabase Auth with the public key.
-- Accounts provisioned with the service role (seed and test scripts) set
-- app_metadata.provisioned = true, which clients cannot set themselves.
-- =============================================================================

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
  if coalesce((new.raw_app_meta_data ->> 'provisioned')::boolean, false) is false
     and (select s.value from public.system_settings s where s.key = 'allow_registrations') = 'false'::jsonb then
    raise exception 'New registrations are currently closed' using errcode = 'PT403';
  end if;

  -- Sign-up can only ever create patients or (unverified) doctors. Admins are
  -- granted later by an existing admin or the server-side make-admin script.
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
