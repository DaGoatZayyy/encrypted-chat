create or replace function public.create_chat_with_members(
  target_auth0_sub text,
  target_display_name text,
  target_user_code text,
  target_encrypted_key text,
  target_key_sender_public jsonb,
  own_display_name text,
  own_user_code text,
  own_encrypted_key text,
  own_key_sender_public jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_sub text := (select auth.jwt() ->> 'sub');
  caller_role text := (select auth.jwt() ->> 'role');
  new_chat_id uuid;
begin
  if caller_role <> 'authenticated' or caller_sub is null then
    raise exception 'Not authenticated';
  end if;

  if target_auth0_sub is null or target_auth0_sub = caller_sub then
    raise exception 'Invalid chat target';
  end if;

  if not exists (
    select 1
    from public.profiles
    where auth0_sub = target_auth0_sub
      and user_code = target_user_code
  ) then
    raise exception 'Target profile not found';
  end if;

  insert into public.chats (created_by, password_protected, save_history)
  values (caller_sub, false, true)
  returning id into new_chat_id;

  insert into public.chat_members (
    chat_id, auth0_sub, display_name, user_code, hidden,
    encrypted_key, key_sender_public
  ) values
    (
      new_chat_id, caller_sub, own_display_name, own_user_code, false,
      own_encrypted_key, own_key_sender_public
    ),
    (
      new_chat_id, target_auth0_sub, target_display_name, target_user_code, false,
      target_encrypted_key, target_key_sender_public
    );

  return new_chat_id;
end;
$$;

revoke execute on function public.create_chat_with_members(text,text,text,text,jsonb,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_chat_with_members(text,text,text,text,jsonb,text,text,text,jsonb) to authenticated;
