-- ITQAN #12: core employee-initiated personnel requests and principal decisions.
-- All writes use authenticated, scoped SECURITY DEFINER RPCs; no table write grants.

create or replace function public.itqan_personnel_submit_request(
 p_school uuid, p_name text, p_national_id text, p_job_title uuid default null,
 p_specialization text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_request uuid; v_nid text:=btrim(coalesce(p_national_id,''));
begin
 if v_actor is null or not exists (select 1 from public.users where id=v_actor and status='active') then
  raise exception 'Account unavailable' using errcode='42501'; end if;
 if not exists(select 1 from public.schools where id=p_school and status='active') then
  raise exception 'School unavailable' using errcode='22023'; end if;
 if length(btrim(coalesce(p_name,''))) not between 2 and 200
    or v_nid !~ '^[0-9]{10}$'
    or length(coalesce(p_specialization,''))>120 then
  raise exception 'Invalid personnel request' using errcode='22023'; end if;
 if p_job_title is not null and not exists
  (select 1 from public.job_titles where id=p_job_title and active) then
  raise exception 'Invalid job title' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_actor::text||':'||p_school::text,0));
 select id into v_request from public.school_personnel_requests
  where school_id=p_school and user_id=v_actor and status in ('draft','pending','under_review','changes_requested')
  for update;
 if v_request is not null then
  if (select status from public.school_personnel_requests where id=v_request) not in
    ('draft','pending','changes_requested') then
   raise exception 'Request is under review' using errcode='22023'; end if;
  update public.school_personnel_requests set
   submitted_data=jsonb_build_object('full_name',btrim(p_name),'national_id',v_nid,
      'job_title_id',p_job_title,'specialization',nullif(btrim(coalesce(p_specialization,'')),'')),
   status='pending',review_started_at=null,reviewed_by=null,updated_at=now()
   where id=v_request;
 else
  insert into public.school_personnel_requests(school_id,user_id,submitted_data,status)
   values(p_school,v_actor,jsonb_build_object('full_name',btrim(p_name),'national_id',v_nid,
     'job_title_id',p_job_title,'specialization',nullif(btrim(coalesce(p_specialization,'')),'')),'pending')
   returning id into v_request;
 end if;
 return v_request;
end;$$;

create or replace function public.itqan_personnel_my_requests()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_result jsonb;
begin
 if v_actor is null then raise exception 'Forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'school_id',q.school_id,
  'school_name',s.name,'status',q.status,'created_at',q.created_at,
  'updated_at',q.updated_at,'decision_note',q.decision_note,
  'full_name',q.submitted_data->>'full_name') order by q.created_at desc),'[]'::jsonb)
 into v_result from public.school_personnel_requests q
 join public.schools s on s.id=q.school_id where q.user_id=v_actor;
 return v_result;
end;$$;

create or replace function public.itqan_school_personnel_overview(p_school uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_profiles jsonb; v_requests jsonb;
begin
 if v_actor is null or not itqan_private.has_school_permission(p_school,'school.manage_members') then
  raise exception 'Forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'employee_number',p.employee_number,
  'full_name',p.full_name_snapshot,'status',p.status,'job_title_id',p.job_title_id,
  'specialization',p.specialization,'started_on',p.started_on,'ended_on',p.ended_on)
  order by p.created_at desc),'[]'::jsonb) into v_profiles
  from public.school_personnel_profiles p where p.school_id=p_school;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'user_id',r.user_id,
  'full_name',r.submitted_data->>'full_name',
  'national_mask',case when length(r.submitted_data->>'national_id')>=4 then
    '******'||right(r.submitted_data->>'national_id',4) else '****' end,
  'job_title_id',r.submitted_data->>'job_title_id',
  'specialization',r.submitted_data->>'specialization',
  'status',r.status,'created_at',r.created_at,'review_started_at',r.review_started_at,
  'decision_note',r.decision_note) order by r.created_at desc),'[]'::jsonb)
 into v_requests from public.school_personnel_requests r where r.school_id=p_school;
 return jsonb_build_object('profiles',v_profiles,'requests',v_requests);
end;$$;

create or replace function public.itqan_school_personnel_reveal_identity(p_request uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_school uuid; v_nid text;
begin
 select school_id,submitted_data->>'national_id' into v_school,v_nid
 from public.school_personnel_requests where id=p_request;
 if v_actor is null or v_school is null or
   not itqan_private.has_school_permission(v_school,'school.manage_members') then
  raise exception 'Forbidden' using errcode='42501'; end if;
 insert into public.site_admin_audit(actor_user_id,operation,target_type,target_id,details)
 values(v_actor,'personnel.identity.reveal','personnel_request',p_request,
  jsonb_build_object('school_id',v_school));
 return v_nid;
end;$$;

create or replace function public.itqan_school_personnel_decide(
 p_request uuid,p_action text,p_employee_number text default null,
 p_year uuid default null,p_job uuid default null,p_note text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_req public.school_personnel_requests%rowtype;
 v_nid text;v_name text;v_employee uuid;v_linked uuid;v_profile uuid;
 v_placement uuid;v_number text:=btrim(coalesce(p_employee_number,''));
 v_job uuid; v_active uuid;
begin
 select * into v_req from public.school_personnel_requests where id=p_request for update;
 if v_actor is null or v_req.id is null or
  not itqan_private.has_school_permission(v_req.school_id,'school.manage_members') then
  raise exception 'Forbidden' using errcode='42501'; end if;
 if v_actor=v_req.user_id then raise exception 'Self approval forbidden' using errcode='42501'; end if;
 if p_action not in ('start','changes','reject','approve') then
  raise exception 'Invalid action' using errcode='22023';end if;
 if p_action='start' then
  if v_req.status<>'pending' then raise exception 'Request not pending' using errcode='22023';end if;
  update public.school_personnel_requests
   set status='under_review',review_started_at=now(),reviewed_by=v_actor,updated_at=now()
   where id=p_request;
  return jsonb_build_object('status','under_review');
 end if;
 if v_req.status not in ('pending','under_review') then
  raise exception 'Request not awaiting decision' using errcode='22023'; end if;
 if p_action in ('changes','reject') then
  if length(btrim(coalesce(p_note,'')))<3 then
   raise exception 'Decision reason required' using errcode='22023';end if;
  update public.school_personnel_requests
   set status=case when p_action='changes' then 'changes_requested' else 'rejected' end,
    reviewed_by=v_actor,review_started_at=coalesce(review_started_at,now()),
    decision_note=left(btrim(p_note),1000),
    decision_at=case when p_action='reject' then now() else null end,updated_at=now()
   where id=p_request;
  return jsonb_build_object('status',case when p_action='changes' then 'changes_requested' else 'rejected' end);
 end if;
 -- The database transaction commits only when profile, placement, membership and approval all succeed.
 if v_req.status<>'under_review' or v_number='' or length(v_number)>80 then
  raise exception 'Start review and assign school employee number' using errcode='22023';end if;
 if p_year is null or not exists(select 1 from public.academic_years where id=p_year) then
  raise exception 'Academic year required' using errcode='22023';end if;
 perform 1 from public.users u join auth.users a on a.id=u.id
   where u.id=v_req.user_id and u.status='active' and a.email_confirmed_at is not null for update of u;
 if not found then raise exception 'Account not active or verified' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_req.user_id::text,0));
 select school_id into v_active from public.school_memberships
   where user_id=v_req.user_id and status='active' for update;
 if v_active is not null then raise exception 'One active school per account' using errcode='23505';end if;
 v_nid:=v_req.submitted_data->>'national_id';v_name:=btrim(v_req.submitted_data->>'full_name');
 if v_nid !~ '^[0-9]{10}$' or length(v_name) not between 2 and 200 then
   raise exception 'Invalid identity' using errcode='22023';end if;
 select id,user_id into v_employee,v_linked from public.employees
   where national_id=v_nid for update;
 if v_employee is not null and v_linked is not null and v_linked<>v_req.user_id then
   raise exception 'Identity already associated with another account' using errcode='23505';end if;
 if v_employee is null then
   insert into public.employees(user_id,full_name,national_id)
    values(v_req.user_id,v_name,v_nid) returning id into v_employee;
 elsif v_linked is null then
   update public.employees set user_id=v_req.user_id where id=v_employee;
 end if;
 select id into v_profile from public.school_personnel_profiles
  where school_id=v_req.school_id and employee_id=v_employee for update;
 v_job:=coalesce(p_job,nullif(v_req.submitted_data->>'job_title_id','')::uuid);
 if v_job is not null and not exists(select 1 from public.job_titles where id=v_job and active) then
  raise exception 'Invalid job' using errcode='22023';end if;
 if v_profile is null then
   insert into public.school_personnel_profiles(school_id,employee_id,employee_number,
     full_name_snapshot,job_title_id,specialization,created_by,approved_by)
   values(v_req.school_id,v_employee,v_number,v_name,v_job,
    v_req.submitted_data->>'specialization',v_actor,v_actor)
   returning id into v_profile;
 else
   if not exists(select 1 from public.school_personnel_profiles
     where id=v_profile and employee_number=v_number and status='active') then
    raise exception 'Existing personnel profile must retain its number and active status'
      using errcode='22023';end if;
 end if;
 select id into v_placement from public.school_employees
  where personnel_profile_id=v_profile and academic_year_id=p_year and status='active' for update;
 if v_placement is null then
   insert into public.school_employees(school_id,employee_id,academic_year_id,status,personnel_profile_id)
    values(v_req.school_id,v_employee,p_year,'active',v_profile) returning id into v_placement;
 end if;
 if v_job is not null and not exists(select 1 from public.employee_school_jobs
   where school_employee_id=v_placement and job_title_id=v_job) then
   insert into public.employee_school_jobs(school_employee_id,job_title_id,is_primary)
    values(v_placement,v_job,true);
 end if;
 insert into public.school_memberships(school_id,user_id,access_role,job_role,status,employee_id,academic_year_id,personnel_profile_id)
 values(v_req.school_id,v_req.user_id,'employee',
   case when v_job is null then 'staff' else
     case when (select code from public.job_titles where id=v_job) in ('teacher','principal','vice_principal','counselor')
      then (select code from public.job_titles where id=v_job) else 'staff' end end,
   'active',v_employee,p_year,v_profile)
 on conflict (school_id,user_id) do update
 set status='active',employee_id=excluded.employee_id,
     academic_year_id=excluded.academic_year_id,personnel_profile_id=excluded.personnel_profile_id;
 update public.school_personnel_requests
  set status='approved',matched_profile_id=v_profile,approved_profile_id=v_profile,
   reviewed_by=v_actor,decision_at=now(),updated_at=now(),decision_note=left(coalesce(p_note,''),1000)
  where id=p_request;
 insert into public.site_admin_audit(actor_user_id,operation,target_type,target_id,details)
 values(v_actor,'personnel.request.approved','personnel_profile',v_profile,
  jsonb_build_object('school_id',v_req.school_id,'request_id',p_request,'user_id',v_req.user_id));
 return jsonb_build_object('status','approved','profile_id',v_profile);
end;$$;

revoke all on function public.itqan_personnel_submit_request(uuid,text,text,uuid,text) from public,anon;
revoke all on function public.itqan_personnel_my_requests() from public,anon;
revoke all on function public.itqan_school_personnel_overview(uuid) from public,anon;
revoke all on function public.itqan_school_personnel_reveal_identity(uuid) from public,anon;
revoke all on function public.itqan_school_personnel_decide(uuid,text,text,uuid,uuid,text) from public,anon;
grant execute on function public.itqan_personnel_submit_request(uuid,text,text,uuid,text) to authenticated;
grant execute on function public.itqan_personnel_my_requests() to authenticated;
grant execute on function public.itqan_school_personnel_overview(uuid) to authenticated;
grant execute on function public.itqan_school_personnel_reveal_identity(uuid) to authenticated;
grant execute on function public.itqan_school_personnel_decide(uuid,text,text,uuid,uuid,text) to authenticated;
