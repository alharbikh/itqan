-- Keep account status values aligned with the existing profiles_status_check.
-- Users are 'active' or 'disabled'; school memberships independently use 'inactive'.
create or replace function public.itqan_admin_set_user_status(p_user uuid,p_status text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();v_previous text;
begin
 if v_actor is null or not itqan_private.has_system_permission('system.manage_users') then
  raise exception 'Not authorized' using errcode='42501';end if;
 if p_status not in ('active','disabled') then
  raise exception 'Invalid user status' using errcode='22023';end if;
 if p_user=v_actor or exists(select 1 from public.user_roles where user_id=p_user and role_code='site_admin') then
  raise exception 'Cannot change site administrator status' using errcode='42501';end if;
 select status into v_previous from public.users where id=p_user for update;
 if not found then raise exception 'User does not exist' using errcode='22023';end if;
 update public.users set status=p_status, updated_at=now() where id=p_user;
 insert into public.site_admin_audit(actor_user_id,operation,target_type,target_id,details)
 values(v_actor,'user.status','user',p_user,jsonb_build_object('before',v_previous,'after',p_status));
 return true;
end $$;
revoke all on function public.itqan_admin_set_user_status(uuid,text) from public,anon;
grant execute on function public.itqan_admin_set_user_status(uuid,text) to authenticated;
