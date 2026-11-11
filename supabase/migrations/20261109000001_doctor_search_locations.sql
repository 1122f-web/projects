-- Add public doctor coordinates to the paginated directory response so clients
-- can calculate distances without exposing any additional profile fields.
alter table public.doctor_profiles
  add column if not exists latitude double precision
    check (latitude is null or latitude between -90 and 90),
  add column if not exists longitude double precision
    check (longitude is null or longitude between -180 and 180);

create or replace function public.search_doctors_with_locations(
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
  with result as (
    select public.search_doctors(
      p_query,
      p_specialty_id,
      p_min_fee,
      p_max_fee,
      p_available_on,
      p_consultation_type,
      p_sort,
      p_limit,
      p_offset
    ) as payload
  ),
  located_items as (
    select
      item.value || jsonb_build_object(
        'latitude', doctor.latitude,
        'longitude', doctor.longitude
      ) as item,
      item.ordinality
    from result
    cross join lateral jsonb_array_elements(coalesce(result.payload -> 'items', '[]'::jsonb))
      with ordinality as item(value, ordinality)
    left join public.doctor_profiles doctor on doctor.id = (item.value ->> 'id')::uuid
  )
  select jsonb_set(
    result.payload,
    '{items}',
    coalesce(
      (select jsonb_agg(located_items.item order by located_items.ordinality) from located_items),
      '[]'::jsonb
    )
  )
  from result;
$$;

revoke all on function public.search_doctors_with_locations(
  text, uuid, numeric, numeric, date, public.consultation_type, text, integer, integer
) from public;
grant execute on function public.search_doctors_with_locations(
  text, uuid, numeric, numeric, date, public.consultation_type, text, integer, integer
) to anon, authenticated, service_role;
