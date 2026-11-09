-- Trusted site-admin delegation; serialized changes and last-admin protection.
alter table public.site_admin_audit drop constraint site_admin_audit_operation_check;
alter table public.site_admin_audit add constraint site_admin_audit_operation_check
check(operation in ('school.create','school.update','school.delete','school.status',
 'membership.upsert','user.status','user.role.grant','user.role.revoke'));

create function public.itqan_admin_manage_site_role(p_user uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_existing boolean;
begin
 if v_actor is null or not itqan_private.has_system_permission('system.manage_roles') then
   raise exception 'Not authorized' using errcode='42501';
 end if;
 if p_user is null or p_enabled is null or p_user=v_actor then
   raise exception 'Invalid role change' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtext('itqan:site_admin_management'));
 if not exists(
   select 1 from public.users u join auth.users a on a.id=u.id
   where u.id=p_user and u.status='active' and a.email_confirmed_at is not null
 ) then raise exception 'Target user must be active and email confirmed' using errcode='22023';end if;
 select exists(select 1 from public.user_roles where user_id=p_user and role_code='site_admin')
 into v_existing;
 if p_enabled then
   if v_existing then return true; end if;
   insert into public.user_roles(user_id,role_code) values(p_user,'site_admin');
 else
   if not v_existing then return true;end if;
   if (select count(*) from public.user_roles where role_code='site_admin')<=1 then
     raise exception 'Cannot revoke last site administrator' using errcode='42501';
   end if;
   delete from public.user_roles where user_id=p_user and role_code='site_admin';
 end if;
 insert into public.site_admin_audit(actor_user_id,operation,target_type,target_id,details)
 values(v_actor,case when p_enabled then 'user.role.grant' else 'user.role.revoke' end,
  'user',p_user,jsonb_build_object('role','site_admin','enabled',p_enabled));
 return true;
end $$;

revoke all on function public.itqan_admin_manage_site_role(uuid,boolean) from public,anon;
grant execute on function public.itqan_admin_manage_site_role(uuid,boolean) to authenticated;
