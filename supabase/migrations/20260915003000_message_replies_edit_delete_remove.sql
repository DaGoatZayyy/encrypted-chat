alter table public.messages
  add column if not exists reply_to_message_id uuid references public.messages(id) on delete set null,
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz;

alter table public.chat_members
  add column if not exists removed_at timestamptz;

create index if not exists messages_reply_to_idx on public.messages(reply_to_message_id);
create index if not exists chat_members_active_idx on public.chat_members(auth0_sub, removed_at);

drop policy if exists "chat members can update own messages" on public.messages;
create policy "chat members can update own messages"
on public.messages for update to authenticated
using (
  sender_id = (auth.jwt()->>'sub')
  and public.is_chat_member(chat_id, auth.jwt()->>'sub')
)
with check (
  sender_id = (auth.jwt()->>'sub')
  and public.is_chat_member(chat_id, auth.jwt()->>'sub')
);

drop policy if exists "chat members can delete messages" on public.messages;

comment on column public.messages.reply_to_message_id is 'References another message in the same chat for client-side quoted replies.';
comment on column public.messages.edited_at is 'Set when the sender edits the encrypted message.';
comment on column public.messages.deleted_at is 'Set when the sender deletes the message for everyone; ciphertext is cleared client-side.';
comment on column public.chat_members.removed_at is 'When set, the chat is removed from this member’s active chat list without deleting the shared chat.';
