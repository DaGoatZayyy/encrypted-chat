revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create or replace function public.is_chat_member(target_chat_id uuid, target_sub text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.chat_members
    where chat_id = target_chat_id
      and auth0_sub = target_sub
  );
$$;

revoke execute on function public.is_chat_member(uuid, text) from public, anon, authenticated;

drop policy if exists "members can read chats" on public.chats;
create policy "members can read chats"
on public.chats for select to authenticated
using (public.is_chat_member(id, auth.jwt()->>'sub'));

drop policy if exists "chat members can read membership" on public.chat_members;
create policy "chat members can read membership"
on public.chat_members for select to authenticated
using (public.is_chat_member(chat_id, auth.jwt()->>'sub'));

drop policy if exists "chat members can read messages" on public.messages;
create policy "chat members can read messages"
on public.messages for select to authenticated
using (public.is_chat_member(chat_id, auth.jwt()->>'sub'));

drop policy if exists "chat members can send messages" on public.messages;
create policy "chat members can send messages"
on public.messages for insert to authenticated
with check (
  (auth.jwt()->>'sub') = sender_id
  and public.is_chat_member(chat_id, auth.jwt()->>'sub')
);

create policy "chat members can delete messages"
on public.messages for delete to authenticated
using (public.is_chat_member(chat_id, auth.jwt()->>'sub'));
