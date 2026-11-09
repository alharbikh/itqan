
create function itqan_private.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.users(id,full_name,status)
  values (new.id,coalesce(nullif(left(trim(new.raw_user_meta_data->>'full_name'),200),''),''),'active')
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function itqan_private.handle_new_auth_user() from public,anon,authenticated;
create trigger itqan_auth_user_created
after insert on auth.users for each row
execute function itqan_private.handle_new_auth_user();
