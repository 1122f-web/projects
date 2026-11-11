-- =============================================================================
-- MediConnect: video consultation rooms
-- One private Daily room per online appointment. Rooms are created by the
-- backend with the service role (the Daily API key never reaches browsers);
-- each participant joins with a short-lived meeting token, so the room URL
-- on its own does not let anyone in.
-- =============================================================================

-- A hand-made video_sessions table (id, appointment_id, room_name, room_url,
-- created_at) existed on the hosted project. Replace it only while it is empty;
-- with data in it, stop so nothing is lost.
do $$
begin
  if to_regclass('public.video_sessions') is not null
     and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'video_sessions' and column_name = 'expires_at') then
    if exists (select 1 from public.video_sessions) then
      raise exception 'public.video_sessions has rows in an older layout; migrate them by hand before applying this migration';
    end if;
    drop table public.video_sessions;
  end if;
end;
$$;

create table public.video_sessions (
  appointment_id uuid primary key references public.appointments (id) on delete cascade,
  provider text not null default 'daily' check (provider = 'daily'),
  room_name text not null unique check (char_length(room_name) between 1 and 128),
  room_url text not null check (room_url ~ '^https://'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.video_sessions is 'Daily room for an online appointment. Written only by the backend (service role).';
create trigger video_sessions_updated_at before update on public.video_sessions
  for each row execute function private.set_updated_at();

alter table public.video_sessions enable row level security;
revoke all on public.video_sessions from anon;

-- No insert, update or delete policies: clients cannot create or change rooms.
create policy "video_sessions: appointment parties read" on public.video_sessions
  for select to authenticated
  using (exists (
    select 1 from public.appointments a
    where a.id = appointment_id
      and (a.patient_id = (select auth.uid()) or a.doctor_id = (select auth.uid()))
  ));
