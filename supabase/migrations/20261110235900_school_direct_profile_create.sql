-- ITQAN #12: reuse the existing principal-only personnel creator and attach a permanent school profile.
alter table public.site_admin_audit
 drop constraint site_admin_audit_operation_check,
 add constraint site_admin_audit_operation_check check (operation in (
  'school.create','school.update','school.delete','school.status',
  'membership.upsert','user.status','user.role.grant','user.role.revoke',
  'user.password.temporary_attempt','user.password.recovery_email',
  'personnel.request.created','personnel.request.updated',
  'personnel.request.status_changed','personnel.request.approved',
  'personnel.identity.reveal','personnel.operation.consent',
  'personnel.operation.completed','personnel.profile.created'
 ));

create or replace function public.itqan_school_create_profile(
 p_school uuid,p_year uuid,p_name text,p_national_id text,p_number text,
 p_job uuid default null,p_specialization text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_placement uuid;v_employee uuid;v_profile uuid;
 v_num text:=btrim(coalesce(p_number,''));
begin
 if v_actor is null or not itqan_private.has_school_permission(p_school,'school.manage_members') then
  raise exception 'Forbidden' using errcode='42501';end if;
 if p_national_id is null or btrim(p_national_id) !~ '^[0-9]{10}$'
  or length(v_num) not between 1 and 80
  or length(coalesce(p_specialization,''))>120 then
  raise exception 'Invalid personnel profile parameters' using errcode='22023';end if;
 -- The pre-existing RPC handles identity reuse, school/year checks and placement creation.
 v_placement:=public.itqan_school_create_personnel(
   p_school,p_year,p_name,btrim(p_national_id),p_job);
 select employee_id into v_employee from public.school_employees where id=v_placement;
 insert into public.school_personnel_profiles(
  school_id,employee_id,employee_number,full_name_snapshot,job_title_id,specialization,
  created_by,approved_by)
 values(p_school,v_employee,v_num,btrim(p_name),p_job,
   nullif(btrim(coalesce(p_specialization,'')),''),v_actor,v_actor)
 returning id into v_profile;
 update public.school_employees set personnel_profile_id=v_profile where id=v_placement;
 insert into public.site_admin_audit(actor_user_id,operation,target_type,target_id,details)
 values(v_actor,'personnel.profile.created','personnel_profile',v_profile,
  jsonb_build_object('school_id',p_school,'placement_id',v_placement));
 return v_profile;
end;$$;
revoke all on function public.itqan_school_create_profile(uuid,uuid,text,text,text,uuid,text)
 from public,anon;
grant execute on function public.itqan_school_create_profile(uuid,uuid,text,text,text,uuid,text)
 to authenticated;
