-- Site administration: atomic audited operations; never expose arbitrary SQL or service credentials.
create table public.site_admin_audit (
 id bigint generated always as identity primary key,
 actor_user_id uuid not null references public.users(id),
 operation text not null check(operation in ('school.delete','school.status','membership.upsert','user.status')),
 target_type text not null check(target_type in ('school','membership','user')),
 target_id uuid not null,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
alter table public.site_admin_audit enable row level security;
revoke all on public.site_admin_audit from public,anon,authenticated;
grant select on public.site_admin_audit to authenticated;
create policy site_admin_audit_read on public.site_admin_audit for select to authenticated
using ((select itqan_private.has_system_permission('system.manage_users')));

create policy memberships_admin_read on public.school_memberships for select to authenticated
using ((select itqan_private.has_system_permission('system.manage_users')));

-- Deliberately restricted to existing accounts: sign-up and verification stay in Supabase Auth.
create function public.itqan_admin_manage_membership(
 p_school uuid,p_user uuid,p_access_role text,p_job_role text,p_status text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_id uuid; v_before jsonb;
begin
 if v_actor is null or not itqan_private.has_system_permission('system.manage_roles') then
  raise exception 'Not authorized' using errcode='42501';
 end if;
 if p_user=v_actor then raise exception 'Self assignment forbidden' using errcode='42501'; end if;
 if p_access_role not in ('school_principal','employee')
 or p_job_role not in ('principal','teacher','vice_principal','counselor','staff')
 or p_status not in ('active','inactive') then
  raise exception 'Invalid membership parameters' using errcode='22023';
 end if;
 if p_access_role='school_principal' and p_job_role<>'principal' then
  raise exception 'Principal job role required' using errcode='22023';
 end if;
 perform 1 from public.schools where id=p_school and status='active' for update;
 if not found then raise exception 'School not active' using errcode='22023'; end if;
 perform 1 from public.users where id=p_user and status='active' for update;
 if not found then raise exception 'User not active' using errcode='22023'; end if;
 select to_jsonb(m) into v_before from public.school_memberships m
  where school_id=p_school and user_id=p_user;
 insert into public.school_memberships(school_id,user_id,access_role,job_role,status)
 values(p_school,p_user,p_access_role,p_job_role,p_status)
 on conflict(school_id,user_id) do update
 set access_role=excluded.access_role, job_role=excluded.job_role,status=excluded.status
 returning id into v_id;
 insert into public.site_admin_audit(actor_user_id,operation,target_type,target_id,details)
 values(v_actor,'membership.upsert','membership',v_id,
 jsonb_build_object('school_id',p_school,'user_id',p_user,
 'previous',coalesce(v_before,'null'::jsonb),'role',p_access_role,
 'job_role',p_job_role,'status',p_status));
 return v_id;
end $$;

create function public.itqan_admin_set_user_status(p_user uuid,p_status text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();v_previous text;
begin
 if v_actor is null or not itqan_private.has_system_permission('system.manage_users') then
  raise exception 'Not authorized' using errcode='42501';end if;
 if p_status not in ('active','inactive') then raise exception 'Invalid user status' using errcode='22023';end if;
 if p_user=v_actor or exists(select 1 from public.user_roles where user_id=p_user and role_code='site_admin') then
  raise exception 'Cannot change site administrator status' using errcode='42501';end if;
 select status into v_previous from public.users where id=p_user for update;
 if not found then raise exception 'User does not exist' using errcode='22023';end if;
 update public.users set status=p_status, updated_at=now() where id=p_user;
 insert into public.site_admin_audit(actor_user_id,operation,target_type,target_id,details)
 values(v_actor,'user.status','user',p_user,jsonb_build_object('before',v_previous,'after',p_status));
 return true;
end $$;

create function public.itqan_admin_set_school_status(p_school uuid,p_status text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();v_previous text;
begin
 if v_actor is null or not itqan_private.has_system_permission('system.manage_schools') then
  raise exception 'Not authorized' using errcode='42501';end if;
 if p_status not in ('active','inactive') then raise exception 'Invalid school status' using errcode='22023';end if;
 select status into v_previous from public.schools where id=p_school for update;
 if not found then raise exception 'School not found' using errcode='22023';end if;
 update public.schools set status=p_status where id=p_school;
 insert into public.site_admin_audit(actor_user_id,operation,target_type,target_id,details)
 values(v_actor,'school.status','school',p_school,jsonb_build_object('before',v_previous,'after',p_status));
 return true;
end $$;

-- Delete ONLY schools with absolutely no dependent records; ON DELETE CASCADE must never
-- erase user work as a side effect of a site-admin UI action.
create function public.itqan_admin_delete_empty_school(p_school uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_name text;
begin
 if v_actor is null or not itqan_private.has_system_permission('system.manage_schools') then
  raise exception 'Not authorized' using errcode='42501';end if;
 select name into v_name from public.schools where id=p_school for update;
 if not found then raise exception 'School not found' using errcode='22023';end if;
 if exists(select 1 from public.school_memberships where school_id=p_school)
 or exists(select 1 from public.school_employees where school_id=p_school)
 or exists(select 1 from public.school_service_access where school_id=p_school)
 or exists(select 1 from public.evaluation_periods where school_id=p_school)
 or exists(select 1 from public.evidence_assignments where school_id=p_school)
 or exists(select 1 from public.evidence_records where school_id=p_school)
 or exists(select 1 from public.evidence_templates where school_id=p_school)
 or exists(select 1 from public.performance_reviews where school_id=p_school)
 or exists(select 1 from public.portfolio_records where school_id=p_school)
 or exists(select 1 from public.self_evaluations where school_id=p_school) then
  raise exception 'School contains related records; deactivate instead' using errcode='23503';
 end if;
 delete from public.schools where id=p_school;
 insert into public.site_admin_audit(actor_user_id,operation,target_type,target_id,details)
 values(v_actor,'school.delete','school',p_school,jsonb_build_object('name',v_name));
 return true;
end $$;

revoke all on function public.itqan_admin_manage_membership(uuid,uuid,text,text,text) from public,anon;
revoke all on function public.itqan_admin_set_user_status(uuid,text) from public,anon;
revoke all on function public.itqan_admin_set_school_status(uuid,text) from public,anon;
revoke all on function public.itqan_admin_delete_empty_school(uuid) from public,anon;
grant execute on function public.itqan_admin_manage_membership(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.itqan_admin_set_user_status(uuid,text) to authenticated;
grant execute on function public.itqan_admin_set_school_status(uuid,text) to authenticated;
grant execute on function public.itqan_admin_delete_empty_school(uuid) to authenticated;
