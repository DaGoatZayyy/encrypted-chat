alter table public.profiles
  add column if not exists last_seen_at timestamptz;

create index if not exists profiles_last_seen_idx
  on public.profiles(last_seen_at);

comment on column public.profiles.last_seen_at is 'Last time the authenticated user reported activity from the app. Used for presence fallback and last-seen display.';
