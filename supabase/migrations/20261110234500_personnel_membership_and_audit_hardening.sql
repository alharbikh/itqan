-- Correct a prior inactive principal membership to employee access_role upon employee re-link.
-- Track request versions securely, and remove TRUNCATE privilege that bypasses RLS.
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
 set status='active',access_role='employee',job_role=excluded.job_role,
     employee_id=excluded.employee_id,academic_year_id=excluded.academic_year_id,
     personnel_profile_id=excluded.personnel_profile_id;
 update public.school_personnel_requests
  set status='approved',matched_profile_id=v_profile,approved_profile_id=v_profile,
   reviewed_by=v_actor,decision_at=now(),updated_at=now(),decision_note=left(coalesce(p_note,''),1000)
  where id=p_request;
 insert into public.site_admin_audit(actor_user_id,operation,target_type,target_id,details)
 values(v_actor,'personnel.request.approved','personnel_profile',v_profile,
  jsonb_build_object('school_id',v_req.school_id,'request_id',p_request,'user_id',v_req.user_id));
 return jsonb_build_object('status','approved','profile_id',v_profile);
end;$$;

alter table public.school_personnel_requests
 add column submission_history jsonb not null default '[]'::jsonb
 check (jsonb_typeof(submission_history)='array');

create or replace function itqan_private.personnel_request_audit()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_data jsonb;
begin
 if TG_OP='UPDATE' and NEW.submitted_data is distinct from OLD.submitted_data then
  v_data:=coalesce(OLD.submission_history,'[]'::jsonb) ||
    jsonb_build_array(jsonb_build_object('submitted_data',OLD.submitted_data,
     'changed_at',now(),'changed_by',v_actor));
  if jsonb_array_length(v_data)>20 then
    v_data:=(select coalesce(jsonb_agg(value order by ord),'[]'::jsonb)
             from jsonb_array_elements(v_data) with ordinality as t(value,ord)
             where ord>jsonb_array_length(v_data)-20);
  end if;
  NEW.submission_history:=v_data;
 end if;
 return NEW;
end;$$;

create trigger itqan_personnel_request_revision_before_update
 before update on public.school_personnel_requests
 for each row execute function itqan_private.personnel_request_audit();

create or replace function itqan_private.personnel_request_event_audit()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();
begin
 if v_actor is not null then
  insert into public.site_admin_audit(actor_user_id,operation,target_type,target_id,details)
  values(v_actor,case when TG_OP='INSERT' then 'personnel.request.created'
      when NEW.status is distinct from OLD.status then 'personnel.request.status_changed'
      else 'personnel.request.updated' end,
   'personnel_request',NEW.id,
   jsonb_build_object('school_id',NEW.school_id,'user_id',NEW.user_id,
     'previous_status',case when TG_OP='UPDATE' then OLD.status else null end,
     'status',NEW.status));
 end if;
 return NEW;
end;$$;
create trigger itqan_personnel_request_event_after_change
 after insert or update on public.school_personnel_requests
 for each row execute function itqan_private.personnel_request_event_audit();

revoke truncate on public.school_memberships from authenticated;

revoke all on function itqan_private.personnel_request_audit() from public,anon,authenticated;
revoke all on function itqan_private.personnel_request_event_audit() from public,anon,authenticated;
