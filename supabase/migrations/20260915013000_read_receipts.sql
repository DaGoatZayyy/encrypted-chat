create table if not exists public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id text not null references public.profiles(auth0_sub) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists message_receipts_user_idx
  on public.message_receipts(user_id, read_at desc);

create index if not exists message_receipts_message_idx
  on public.message_receipts(message_id);

alter table public.message_receipts enable row level security;

drop policy if exists "members can read message receipts" on public.message_receipts;
create policy "members can read message receipts"
on public.message_receipts for select to authenticated
using (
  public.is_chat_member(
    (select chat_id from public.messages where id = message_id),
    auth.jwt()->>'sub'
  )
);

drop policy if exists "members can mark messages read" on public.message_receipts;
create policy "members can mark messages read"
on public.message_receipts for insert to authenticated
with check (
  user_id = (auth.jwt()->>'sub')
  and public.is_chat_member(
    (select chat_id from public.messages where id = message_id),
    auth.jwt()->>'sub'
  )
);

create or replace function public.touch_message_read_receipt(target_message_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.message_receipts(message_id, user_id, read_at)
  select target_message_id, auth.jwt()->>'sub', now()
  where auth.jwt()->>'sub' is not null
    and exists (
      select 1
      from public.messages m
      where m.id = target_message_id
        and public.is_chat_member(m.chat_id, auth.jwt()->>'sub')
    )
  on conflict (message_id, user_id)
  do update set read_at = excluded.read_at;
$$;

revoke all on function public.touch_message_read_receipt(uuid) from public;
grant execute on function public.touch_message_read_receipt(uuid) to authenticated;

comment on table public.message_receipts is 'Per-user read receipts. Message content remains encrypted client-side.';
comment on column public.message_receipts.read_at is 'When this user last read the message.';
