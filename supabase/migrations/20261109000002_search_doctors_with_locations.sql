-- Define the RPC used by the public directory directly against the canonical
-- profile tables, and refresh PostgREST's function schema cache after deploy.
alter table public.doctor_profiles
  add column if not exists latitude double precision
    check (latitude is null or latitude between -90 and 90),
  add column if not exists longitude double precision
    check (longitude is null or longitude between -180 and 180);

drop function if exists public.search_doctors_with_locations(
  text, uuid, numeric, numeric, date, text, text, integer, integer
);

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
  with matches as (
    select
      d.*,
      p.full_name,
      p.avatar_url,
      p.timezone,
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
          select 1
          from public.doctor_specialties ds
          join public.specialties sp on sp.id = ds.specialty_id
          where ds.doctor_id = d.id and sp.name ilike '%' || btrim(p_query) || '%'
        )
      )
      and (
        p_specialty_id is null
        or exists (
          select 1
          from public.doctor_specialties ds
          where ds.doctor_id = d.id and ds.specialty_id = p_specialty_id
        )
      )
      and (p_min_fee is null or d.consultation_fee >= p_min_fee)
      and (p_max_fee is null or d.consultation_fee <= p_max_fee)
      and (
        p_consultation_type is null
        or (p_consultation_type = 'online' and d.offers_online)
        or (p_consultation_type = 'in_person' and d.offers_in_person)
      )
      and (
        p_available_on is null
        or (
          d.is_accepting_patients
          and exists (
            select 1
            from private.available_slots(d.id, p_available_on, p_available_on)
          )
        )
      )
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
      m.rating_avg desc,
      m.rating_count desc,
      m.full_name asc
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
        'latitude', pg.latitude,
        'longitude', pg.longitude,
        'city', pg.city,
        'clinic_name', pg.clinic_name,
        'clinic_address', pg.clinic_address,
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
          select jsonb_agg(
            jsonb_build_object('id', sp.id, 'name', sp.name, 'is_primary', ds.is_primary)
            order by ds.is_primary desc, sp.name
          )
          from public.doctor_specialties ds
          join public.specialties sp on sp.id = ds.specialty_id
          where ds.doctor_id = pg.id
        ), '[]'::jsonb)
      ) order by
        case when p_sort = 'fee_asc' then pg.consultation_fee end asc nulls last,
        case when p_sort = 'fee_desc' then pg.consultation_fee end desc nulls last,
        case when p_sort = 'experience' then pg.years_experience end desc nulls last,
        case when p_sort = 'name' then pg.full_name end asc,
        case when coalesce(p_sort, 'rating') = 'rating' then pg.is_featured end desc,
        case when coalesce(p_sort, 'rating') = 'rating' then pg.is_pro end desc,
        pg.rating_avg desc,
        pg.rating_count desc,
        pg.full_name asc
      )
      from page pg
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.search_doctors_with_locations(
  text, uuid, numeric, numeric, date, public.consultation_type, text, integer, integer
) from public;
grant execute on function public.search_doctors_with_locations(
  text, uuid, numeric, numeric, date, public.consultation_type, text, integer, integer
) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
