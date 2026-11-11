drop function if exists public.search_doctors_with_locations(
  text, uuid, numeric, numeric, date, text, text, integer, integer
);

drop function if exists public.search_doctors_with_locations(
  text, uuid, numeric, numeric, date, public.consultation_type, text, integer, integer
);

notify pgrst, 'reload schema';
