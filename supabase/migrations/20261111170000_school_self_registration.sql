-- #47: self-provision one active school and principal membership atomically.
-- Existing schools and records remain untouched. No role inheritance or service-role browser access.
create or replace function public.itqan_self_register_school(
  p_name text, p_ministry_number text, p_stage text default null,
  p_gender text default null, p_department text default null
) returns uuid
language plpgsql security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_school uuid;
  v_number text := nullif(btrim(coalesce(p_ministry_number,'')), '');
  v_name text := btrim(coalesce(p_name,''));
begin
  if v_actor is null or not exists (
    select 1 from public.users u where u.id=v_actor and u.status='active'
  ) then
    raise exception 'Unauthorized' using errcode='42501';
  end if;
  if length(v_name) not between 2 and 160
     or v_number is null or v_number !~ '^[0-9]{1,20}$'
     or length(coalesce(p_stage,''))>160 or length(coalesce(p_department,''))>160
     or (p_gender is not null and p_gender not in ('male','female','mixed'))
  then
    raise exception 'Invalid school details' using errcode='22023';
  end if;
  -- The user's active membership is the authorization boundary; central site roles are not inherited.
  if exists (
    select 1 from public.school_memberships m
    where m.user_id=v_actor and m.status='active'
  ) then
    raise exception 'An active school membership already exists' using errcode='23505';
  end if;
  insert into public.schools(name,ministry_number,education_stage,gender,education_department,status)
  values(v_name,v_number,nullif(btrim(coalesce(p_stage,'')),''),
    p_gender,nullif(btrim(coalesce(p_department,'')),''),'active')
  returning id into v_school;
  insert into public.school_memberships(school_id,user_id,access_role,job_role,status)
  values(v_school,v_actor,'school_principal','principal','active');
  insert into public.site_admin_audit(actor_user_id,operation,target_type,target_id,details)
  values(v_actor,'school.create','school',v_school,
    jsonb_build_object('source','school_self_registration','ministry_number',v_number));
  return v_school;
end
$fn$;
revoke all on function public.itqan_self_register_school(text,text,text,text,text) from public, anon;
grant execute on function public.itqan_self_register_school(text,text,text,text,text) to authenticated;
