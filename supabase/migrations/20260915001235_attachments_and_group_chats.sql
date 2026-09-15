alter table public.chats add column if not exists name text;
alter table public.messages add column if not exists message_type text not null default 'text' check (message_type in ('text','file'));
alter table public.messages add column if not exists attachment_id uuid;
alter table public.messages alter column ciphertext drop not null;

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id text not null references public.profiles(auth0_sub) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

alter table public.messages drop constraint if exists messages_attachment_id_fkey;
alter table public.messages add constraint messages_attachment_id_fkey foreign key (attachment_id) references public.attachments(id) on delete set null;
alter table public.attachments enable row level security;
create policy "chat members can read attachments" on public.attachments for select to authenticated using (public.is_chat_member(chat_id, (select auth.jwt()->>'sub')));
create policy "chat members can create attachments" on public.attachments for insert to authenticated with check (sender_id=(select auth.jwt()->>'sub') and public.is_chat_member(chat_id,(select auth.jwt()->>'sub')));
create policy "senders can delete attachments" on public.attachments for delete to authenticated using (sender_id=(select auth.jwt()->>'sub'));
create index if not exists attachments_chat_id_created_at_idx on public.attachments(chat_id,created_at);
create index if not exists attachments_expires_at_idx on public.attachments(expires_at) where expires_at is not null;
insert into storage.buckets(id,name,public) values('chat-attachments','chat-attachments',false) on conflict(id) do nothing;
create policy "chat members can read encrypted attachments" on storage.objects for select to authenticated using(bucket_id='chat-attachments' and public.is_chat_member(split_part(name,'/',1)::uuid,(select auth.jwt()->>'sub')));
create policy "chat members can upload encrypted attachments" on storage.objects for insert to authenticated with check(bucket_id='chat-attachments' and public.is_chat_member(split_part(name,'/',1)::uuid,(select auth.jwt()->>'sub')));
create policy "senders can delete encrypted attachments" on storage.objects for delete to authenticated using(bucket_id='chat-attachments' and public.is_chat_member(split_part(name,'/',1)::uuid,(select auth.jwt()->>'sub')));

create or replace function public.create_group_chat(target_name text,members jsonb,own_display_name text,own_user_code text,own_encrypted_key text,own_key_sender_public jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare caller_sub text:=(select auth.jwt()->>'sub'); caller_role text:=(select auth.jwt()->>'role'); new_chat_id uuid; member jsonb; member_sub text;
begin
 if caller_role<>'authenticated' or caller_sub is null then raise exception 'Not authenticated'; end if;
 if coalesce(length(trim(target_name)),0)<1 or length(trim(target_name))>80 then raise exception 'Invalid group name'; end if;
 if jsonb_typeof(members)<>'array' or jsonb_array_length(members)<2 or jsonb_array_length(members)>49 then raise exception 'Group needs 2 to 49 other members'; end if;
 insert into public.chats(created_by,name,password_protected,save_history) values(caller_sub,trim(target_name),false,true) returning id into new_chat_id;
 insert into public.chat_members(chat_id,auth0_sub,display_name,user_code,hidden,encrypted_key,key_sender_public) values(new_chat_id,caller_sub,own_display_name,own_user_code,false,own_encrypted_key,own_key_sender_public);
 for member in select * from jsonb_array_elements(members) loop
  member_sub:=member->>'auth0_sub';
  if member_sub is null or member_sub=caller_sub then raise exception 'Invalid group member'; end if;
  if not exists(select 1 from public.profiles p where p.auth0_sub=member_sub and p.user_code=member->>'user_code') then raise exception 'Group member profile not found'; end if;
  insert into public.chat_members(chat_id,auth0_sub,display_name,user_code,hidden,encrypted_key,key_sender_public) values(new_chat_id,member_sub,member->>'display_name',member->>'user_code',false,member->>'encrypted_key',member->'key_sender_public');
 end loop;
 return new_chat_id;
end;$$;
revoke execute on function public.create_group_chat(text,jsonb,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_group_chat(text,jsonb,text,text,text,jsonb) to authenticated;
