alter table public.chats add column if not exists icon text;

create table if not exists public.group_invites (
  id uuid primary key default gen_random_uuid(), chat_id uuid not null references public.chats(id) on delete cascade,
  code text not null unique, created_by text not null references public.profiles(auth0_sub) on delete cascade,
  max_uses integer not null default 10 check (max_uses > 0), uses integer not null default 0 check (uses >= 0),
  expires_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists group_invites_chat_idx on public.group_invites(chat_id);

create table if not exists public.group_join_requests (
  id uuid primary key default gen_random_uuid(), chat_id uuid not null references public.chats(id) on delete cascade,
  invite_id uuid not null references public.group_invites(id) on delete cascade,
  requester_sub text not null references public.profiles(auth0_sub) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(), resolved_at timestamptz,
  unique(chat_id, requester_sub, status)
);
create index if not exists group_join_requests_chat_idx on public.group_join_requests(chat_id,status);

create table if not exists public.pinned_messages (
  chat_id uuid not null references public.chats(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by text not null references public.profiles(auth0_sub) on delete cascade,
  created_at timestamptz not null default now(), primary key(chat_id,message_id)
);

create table if not exists public.group_announcements (
  id uuid primary key default gen_random_uuid(), chat_id uuid not null references public.chats(id) on delete cascade,
  ciphertext text not null, created_by text not null references public.profiles(auth0_sub) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists group_announcements_chat_idx on public.group_announcements(chat_id,created_at desc);

alter table public.group_invites enable row level security;
alter table public.group_join_requests enable row level security;
alter table public.pinned_messages enable row level security;
alter table public.group_announcements enable row level security;

create policy "members can read group invites" on public.group_invites for select to authenticated using (public.is_chat_member(chat_id,auth.jwt()->>'sub'));
create policy "admins can create group invites" on public.group_invites for insert to authenticated with check (public.is_chat_admin(chat_id,auth.jwt()->>'sub') and created_by=auth.jwt()->>'sub');
create policy "admins can update group invites" on public.group_invites for update to authenticated using (public.is_chat_admin(chat_id,auth.jwt()->>'sub')) with check (public.is_chat_admin(chat_id,auth.jwt()->>'sub'));
create policy "admins can delete group invites" on public.group_invites for delete to authenticated using (public.is_chat_admin(chat_id,auth.jwt()->>'sub'));

create policy "members can create join requests" on public.group_join_requests for insert to authenticated with check (requester_sub=auth.jwt()->>'sub');
create policy "requesters and admins can read join requests" on public.group_join_requests for select to authenticated using (requester_sub=auth.jwt()->>'sub' or public.is_chat_admin(chat_id,auth.jwt()->>'sub'));
create policy "admins can resolve join requests" on public.group_join_requests for update to authenticated using (public.is_chat_admin(chat_id,auth.jwt()->>'sub')) with check (public.is_chat_admin(chat_id,auth.jwt()->>'sub'));

create policy "members can read pins" on public.pinned_messages for select to authenticated using (public.is_chat_member(chat_id,auth.jwt()->>'sub'));
create policy "admins can pin messages" on public.pinned_messages for insert to authenticated with check (public.is_chat_admin(chat_id,auth.jwt()->>'sub') and pinned_by=auth.jwt()->>'sub');
create policy "admins can unpin messages" on public.pinned_messages for delete to authenticated using (public.is_chat_admin(chat_id,auth.jwt()->>'sub'));

create policy "members can read announcements" on public.group_announcements for select to authenticated using (public.is_chat_member(chat_id,auth.jwt()->>'sub'));
create policy "admins can create announcements" on public.group_announcements for insert to authenticated with check (public.is_chat_admin(chat_id,auth.jwt()->>'sub') and created_by=auth.jwt()->>'sub');
create policy "admins can delete announcements" on public.group_announcements for delete to authenticated using (public.is_chat_admin(chat_id,auth.jwt()->>'sub'));

create or replace function public.create_group_invite(target_chat_id uuid,target_code text,target_max_uses integer,target_expires_at timestamptz) returns public.group_invites language plpgsql security definer set search_path=public as $$ declare result public.group_invites; begin if not public.is_chat_admin(target_chat_id,auth.jwt()->>'sub') then raise exception 'Not a group admin'; end if; insert into public.group_invites(chat_id,code,created_by,max_uses,expires_at) values(target_chat_id,upper(target_code),auth.jwt()->>'sub',greatest(1,target_max_uses),target_expires_at) returning * into result; return result; end; $$;
grant execute on function public.create_group_invite(uuid,text,integer,timestamptz) to authenticated;

create or replace function public.request_group_join(target_code text) returns uuid language plpgsql security definer set search_path=public as $$ declare inv public.group_invites; req uuid; begin select * into inv from public.group_invites where code=upper(target_code) and uses<max_uses and (expires_at is null or expires_at>now()) limit 1; if inv.id is null then raise exception 'Invite code is invalid or expired'; end if; if public.is_chat_member(inv.chat_id,auth.jwt()->>'sub') then raise exception 'Already a member'; end if; insert into public.group_join_requests(chat_id,invite_id,requester_sub) values(inv.chat_id,inv.id,auth.jwt()->>'sub') on conflict do nothing returning id into req; if req is null then raise exception 'A join request is already pending'; end if; return req; end; $$;
grant execute on function public.request_group_join(text) to authenticated;

create or replace function public.add_group_member(target_chat_id uuid,target_sub text,target_display_name text,target_user_code text,target_encrypted_key text,target_key_sender_public jsonb) returns void language plpgsql security definer set search_path=public as $$ begin if not public.is_chat_admin(target_chat_id,auth.jwt()->>'sub') then raise exception 'Not a group admin'; end if; insert into public.chat_members(chat_id,auth0_sub,display_name,user_code,hidden,encrypted_key,key_sender_public,role) values(target_chat_id,target_sub,target_display_name,target_user_code,false,target_encrypted_key,target_key_sender_public,'member') on conflict(chat_id,auth0_sub) do update set removed_at=null,display_name=excluded.display_name,user_code=excluded.user_code,encrypted_key=excluded.encrypted_key,key_sender_public=excluded.key_sender_public; end; $$;
grant execute on function public.add_group_member(uuid,text,text,text,text,jsonb) to authenticated;

create or replace function public.remove_group_member(target_chat_id uuid,target_sub text) returns void language plpgsql security definer set search_path=public as $$ begin if not public.is_chat_admin(target_chat_id,auth.jwt()->>'sub') then raise exception 'Not a group admin'; end if; if public.is_chat_owner(target_chat_id,target_sub) then raise exception 'Owner cannot be removed'; end if; update public.chat_members set removed_at=now() where chat_id=target_chat_id and auth0_sub=target_sub; end; $$;
grant execute on function public.remove_group_member(uuid,text) to authenticated;

create or replace function public.resolve_group_join_request(target_request_id uuid,approve boolean,target_encrypted_key text,target_key_sender_public jsonb) returns void language plpgsql security definer set search_path=public as $$ declare req public.group_join_requests; prof public.profiles; begin select * into req from public.group_join_requests where id=target_request_id for update; if req.id is null then raise exception 'Join request not found'; end if; if not public.is_chat_admin(req.chat_id,auth.jwt()->>'sub') then raise exception 'Not a group admin'; end if; if req.status<>'pending' then raise exception 'Request already resolved'; end if; if approve then select * into prof from public.profiles where auth0_sub=req.requester_sub; if prof.auth0_sub is null then raise exception 'Requester profile not found'; end if; insert into public.chat_members(chat_id,auth0_sub,display_name,user_code,hidden,encrypted_key,key_sender_public,role) values(req.chat_id,req.requester_sub,prof.display_name,prof.user_code,false,target_encrypted_key,target_key_sender_public,'member') on conflict(chat_id,auth0_sub) do update set removed_at=null,encrypted_key=excluded.encrypted_key,key_sender_public=excluded.key_sender_public; update public.group_invites set uses=uses+1 where id=req.invite_id; update public.group_join_requests set status='approved',resolved_at=now() where id=req.id; else update public.group_join_requests set status='rejected',resolved_at=now() where id=req.id; end if; end; $$;
grant execute on function public.resolve_group_join_request(uuid,boolean,text,jsonb) to authenticated;

create or replace function public.pin_group_message(target_chat_id uuid,target_message_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin if not public.is_chat_admin(target_chat_id,auth.jwt()->>'sub') then raise exception 'Not a group admin'; end if; if not exists(select 1 from public.messages where id=target_message_id and chat_id=target_chat_id) then raise exception 'Message not found'; end if; insert into public.pinned_messages(chat_id,message_id,pinned_by) values(target_chat_id,target_message_id,auth.jwt()->>'sub') on conflict do nothing; end; $$;
grant execute on function public.pin_group_message(uuid,uuid) to authenticated;

create or replace function public.unpin_group_message(target_chat_id uuid,target_message_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin if not public.is_chat_admin(target_chat_id,auth.jwt()->>'sub') then raise exception 'Not a group admin'; end if; delete from public.pinned_messages where chat_id=target_chat_id and message_id=target_message_id; end; $$;
grant execute on function public.unpin_group_message(uuid,uuid) to authenticated;

create or replace function public.set_group_icon(target_chat_id uuid,target_icon text) returns void language plpgsql security definer set search_path=public as $$ begin if not public.is_chat_admin(target_chat_id,auth.jwt()->>'sub') then raise exception 'Not a group admin'; end if; update public.chats set icon=left(coalesce(target_icon,''),8) where id=target_chat_id; end; $$;
grant execute on function public.set_group_icon(uuid,text) to authenticated;

create or replace function public.set_group_name(target_chat_id uuid,target_name text) returns void language plpgsql security definer set search_path=public as $$ begin if not public.is_chat_admin(target_chat_id,auth.jwt()->>'sub') then raise exception 'Not a group admin'; end if; if length(trim(target_name))<1 then raise exception 'Group name cannot be empty'; end if; update public.chats set name=left(trim(target_name),80) where id=target_chat_id; end; $$;
grant execute on function public.set_group_name(uuid,text) to authenticated;
