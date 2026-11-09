-- #12 School employee linking: scoped requests and auditable decisions.
create table public.school_link_requests (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete restrict,
 school_employee_id uuid not null references public.school_employees(id) on delete restrict,
 user_id uuid not null references public.users(id) on delete restrict,
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 requested_at timestamptz not null default now(),
 decided_at timestamptz,
 decided_by uuid references public.users(id) on delete set null,
 decision_note text,
 constraint school_link_decision_consistency check(
  (status='pending' and decided_at is null and decided_by is null)
  or (status<>'pending' and decided_at is not null and decided_by is not null)
 )
);
create unique index school_link_one_pending_user on public.school_link_requests(user_id) where status='pending';
create unique index school_link_one_pending_record on public.school_link_requests(school_employee_id) where status='pending';
create index school_link_school_status on public.school_link_requests(school_id,status,requested_at desc);

create table public.school_link_events (
 id bigint generated always as identity primary key,
 school_id uuid not null references public.schools(id) on delete restrict,
 subject_user_id uuid not null references public.users(id) on delete restrict,
 actor_user_id uuid not null references public.users(id) on delete restrict,
 request_id uuid references public.school_link_requests(id) on delete set null,
 event_type text not null check(event_type in ('personnel.created','link.requested','link.approved','link.rejected','link.cancelled','membership.unlinked')),
 detail jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index school_link_events_school on public.school_link_events(school_id,created_at desc);
create index school_link_events_subject on public.school_link_events(subject_user_id,created_at desc);
alter table public.school_link_requests enable row level security;
alter table public.school_link_events enable row level security;
revoke all on public.school_link_requests, public.school_link_events from public, anon, authenticated;
grant select on public.school_link_requests, public.school_link_events to authenticated;
create policy school_link_requests_read on public.school_link_requests for select to authenticated
 using(user_id=(select auth.uid()) or (select itqan_private.has_school_permission(school_id,'school.manage_members')));
create policy school_link_events_read on public.school_link_events for select to authenticated
 using(subject_user_id=(select auth.uid()) or (select itqan_private.has_school_permission(school_id,'school.manage_members')));

-- The school's principal creates personnel independently of a login.
create function public.itqan_school_create_personnel(
 p_school uuid,p_year uuid,p_name text,p_national_id text default null,p_job uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_employee uuid;v_school_employee uuid;v_national text:=nullif(btrim(p_national_id),'');
begin
 if v_actor is null or not itqan_private.has_school_permission(p_school,'school.manage_members') then
  raise exception 'Forbidden' using errcode='42501'; end if;
 if length(btrim(coalesce(p_name,''))) not between 2 and 200 then raise exception 'Invalid employee name' using errcode='22023';end if;
 if v_national is not null and v_national !~ '^[0-9]{10}$' then raise exception 'Invalid personnel identifier' using errcode='22023';end if;
 if not exists(select 1 from public.schools where id=p_school and status='active')
  or not exists(select 1 from public.academic_years where id=p_year) then
   raise exception 'Invalid school or year' using errcode='22023';end if;
 if p_job is not null and not exists(select 1 from public.job_titles where id=p_job and active) then
   raise exception 'Invalid job title' using errcode='22023';end if;
 -- Never reveal another school's personal data; reuse an existing identity only with verified identifier.
 if v_national is not null then
  select id into v_employee from public.employees where national_id=v_national for update;
 end if;
 if v_employee is null then
  insert into public.employees(full_name,national_id) values(btrim(p_name),v_national) returning id into v_employee;
 end if;
 if exists(select 1 from public.school_employees where employee_id=v_employee and school_id=p_school and status='active') then
  raise exception 'Active personnel placement exists' using errcode='23505';end if;
 insert into public.school_employees(employee_id,school_id,academic_year_id,status)
 values(v_employee,p_school,p_year,'active') returning id into v_school_employee;
 if p_job is not null then
  insert into public.employee_school_jobs(school_employee_id,job_title_id,is_primary)
  values(v_school_employee,p_job,true);
 end if;
 return v_school_employee;
end;$$;

-- Only the account owner can request linking; the principal must verify identity before approving.
create function public.itqan_school_request_link(p_school_employee uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_id uuid;v_school uuid;v_employee uuid;v_linked uuid;
begin
 if v_actor is null or not exists(select 1 from public.users where id=v_actor and status='active') then
  raise exception 'Forbidden' using errcode='42501';end if;
 if exists(select 1 from public.school_memberships where user_id=v_actor and status='active') then
  raise exception 'Current active school must be unlinked first' using errcode='23505';end if;
 select se.school_id,se.employee_id,e.user_id into v_school,v_employee,v_linked
 from public.school_employees se join public.employees e on e.id=se.employee_id
 join public.schools s on s.id=se.school_id
 where se.id=p_school_employee and se.status='active' and s.status='active';
 if v_school is null or (v_linked is not null and v_linked<>v_actor) then
  raise exception 'Personnel record unavailable' using errcode='22023';end if;
 insert into public.school_link_requests(school_id,school_employee_id,user_id)
 values(v_school,p_school_employee,v_actor) returning id into v_id;
 insert into public.school_link_events(school_id,subject_user_id,actor_user_id,request_id,event_type)
 values(v_school,v_actor,v_actor,v_id,'link.requested');
 return v_id;
end;$$;

create function public.itqan_school_decide_link(
 p_request uuid,p_approve boolean,p_job_role text default 'staff',p_note text default null
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_req public.school_link_requests%rowtype;v_employee uuid;v_linked uuid;
begin
 select * into v_req from public.school_link_requests where id=p_request for update;
 if not found or v_actor is null or not itqan_private.has_school_permission(v_req.school_id,'school.manage_members') then
  raise exception 'Forbidden' using errcode='42501';end if;
 if v_req.status<>'pending' then raise exception 'Request already decided' using errcode='22023';end if;
 if p_job_role not in ('teacher','vice_principal','counselor','staff') then raise exception 'Invalid job role' using errcode='22023';end if;
 if p_approve is null then raise exception 'Decision required' using errcode='22023';end if;
 if p_approve then
  if v_actor=v_req.user_id then raise exception 'Self approval forbidden' using errcode='42501';end if;
  perform 1 from public.users u join auth.users au on au.id=u.id where u.id=v_req.user_id
   and u.status='active' and au.email_confirmed_at is not null for update;
  if not found then raise exception 'Account must be active and email confirmed' using errcode='22023';end if;
  if exists(select 1 from public.school_memberships where user_id=v_req.user_id and status='active') then
   raise exception 'User already linked to an active school' using errcode='23505';end if;
  select se.employee_id,e.user_id into v_employee,v_linked
    from public.school_employees se join public.employees e on e.id=se.employee_id
    where se.id=v_req.school_employee_id and se.school_id=v_req.school_id and se.status='active'
    for update of e,se;
  if v_employee is null or (v_linked is not null and v_linked<>v_req.user_id) then
    raise exception 'Personnel record unavailable' using errcode='22023';end if;
  update public.employees set user_id=v_req.user_id where id=v_employee;
  insert into public.school_memberships(school_id,user_id,access_role,job_role,status,employee_id)
  values(v_req.school_id,v_req.user_id,'employee',p_job_role,'active',v_employee)
  on conflict(school_id,user_id) do update set status='active',access_role='employee',
   job_role=excluded.job_role,employee_id=excluded.employee_id;
 end if;
 update public.school_link_requests set status=case when p_approve then 'approved' else 'rejected' end,
  decided_at=now(),decided_by=v_actor,decision_note=left(coalesce(p_note,''),1000) where id=p_request;
 insert into public.school_link_events(school_id,subject_user_id,actor_user_id,request_id,event_type,detail)
 values(v_req.school_id,v_req.user_id,v_actor,p_request,
 case when p_approve then 'link.approved' else 'link.rejected' end,jsonb_build_object('note',left(coalesce(p_note,''),1000)));
 return true;
end;$$;

create function public.itqan_school_unlink(p_school uuid,p_user uuid,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_employee uuid;
begin
 if v_actor is null or (v_actor<>p_user and
   not itqan_private.has_school_permission(p_school,'school.manage_members')) then
  raise exception 'Forbidden' using errcode='42501';end if;
 if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then
   raise exception 'Reason required' using errcode='22023';end if;
 select employee_id into v_employee from public.school_memberships
 where school_id=p_school and user_id=p_user and status='active' for update;
 if not found then raise exception 'No active membership' using errcode='22023';end if;
 update public.school_memberships set status='inactive'
 where school_id=p_school and user_id=p_user and status='active';
 if v_employee is not null then
  update public.school_employees set status='completed',ends_on=current_date
  where school_id=p_school and employee_id=v_employee and status='active';
 end if;
 insert into public.school_link_events(school_id,subject_user_id,actor_user_id,event_type,detail)
 values(p_school,p_user,v_actor,'membership.unlinked',jsonb_build_object('reason',btrim(p_reason)));
 return true;
end;$$;

revoke all on function public.itqan_school_create_personnel(uuid,uuid,text,text,uuid) from public,anon;
revoke all on function public.itqan_school_request_link(uuid) from public,anon;
revoke all on function public.itqan_school_decide_link(uuid,boolean,text,text) from public,anon;
revoke all on function public.itqan_school_unlink(uuid,uuid,text) from public,anon;
grant execute on function public.itqan_school_create_personnel(uuid,uuid,text,text,uuid) to authenticated;
grant execute on function public.itqan_school_request_link(uuid) to authenticated;
grant execute on function public.itqan_school_decide_link(uuid,boolean,text,text) to authenticated;
grant execute on function public.itqan_school_unlink(uuid,uuid,text) to authenticated;
