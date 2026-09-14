create extension if not exists pgcrypto;

create table if not exists public.profiles (
  auth0_sub text primary key,
  display_name text not null default 'User',
  user_code text not null unique check (length(user_code) = 12),
  public_key jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  created_by text not null references public.profiles(auth0_sub) on delete cascade,
  password_protected boolean not null default false,
  save_history boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  auth0_sub text not null references public.profiles(auth0_sub) on delete cascade,
  display_name text not null,
  user_code text not null,
  hidden boolean not null default false,
  encrypted_key text not null,
  key_sender_public jsonb not null,
  joined_at timestamptz not null default now(),
  primary key (chat_id, auth0_sub)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id text not null references public.profiles(auth0_sub) on delete cascade,
  ciphertext text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists chat_members_auth0_sub_idx on public.chat_members(auth0_sub);
create index if not exists messages_chat_id_created_at_idx on public.messages(chat_id, created_at);
create index if not exists messages_expires_at_idx on public.messages(expires_at) where expires_at is not null;

alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;

create policy "profiles readable by authenticated users" on public.profiles for select to authenticated using (true);
create policy "users create own profile" on public.profiles for insert to authenticated with check ((auth.jwt()->>'sub') = auth0_sub);
create policy "users update own profile" on public.profiles for update to authenticated using ((auth.jwt()->>'sub') = auth0_sub) with check ((auth.jwt()->>'sub') = auth0_sub);

create policy "members can create chats" on public.chats for insert to authenticated with check ((auth.jwt()->>'sub') = created_by);
create policy "members can read chats" on public.chats for select to authenticated using (exists (select 1 from public.chat_members m where m.chat_id = id and m.auth0_sub = (auth.jwt()->>'sub')));
create policy "creator can update chat settings" on public.chats for update to authenticated using ((auth.jwt()->>'sub') = created_by) with check ((auth.jwt()->>'sub') = created_by);

create policy "chat members can read membership" on public.chat_members for select to authenticated using (exists (select 1 from public.chat_members me where me.chat_id = chat_id and me.auth0_sub = (auth.jwt()->>'sub')));
create policy "chat creator can add members" on public.chat_members for insert to authenticated with check (exists (select 1 from public.chats c where c.id = chat_id and c.created_by = (auth.jwt()->>'sub')));
create policy "users update own membership" on public.chat_members for update to authenticated using ((auth.jwt()->>'sub') = auth0_sub) with check ((auth.jwt()->>'sub') = auth0_sub);

create policy "chat members can read messages" on public.messages for select to authenticated using (exists (select 1 from public.chat_members m where m.chat_id = chat_id and m.auth0_sub = (auth.jwt()->>'sub')));
create policy "chat members can send messages" on public.messages for insert to authenticated with check ((auth.jwt()->>'sub') = sender_id and exists (select 1 from public.chat_members m where m.chat_id = chat_id and m.auth0_sub = (auth.jwt()->>'sub')));

-- Auth0 must add role=authenticated to ID tokens before Supabase Data API access.
-- Keep message bodies as ciphertext only. Do not add plaintext message columns.
