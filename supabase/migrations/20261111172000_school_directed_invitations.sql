-- #47: school-initiated invitations only. No employee-originated application is required.
-- Invitations do not create accounts, credentials, or memberships on their own.
create table if not exists public.school_invitations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  personnel_profile_id uuid not null,
  invite_email text not null,
  account_mode text not null check(account_mode in ('school','personal')),
  status text not null default 'pending'
    check(status in ('pending','accepted','declined','cancelled')),
  created_by uuid not null references public.users(id),
  accepted_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default(now()+interval '7 days'),
  decided_at timestamptz,
  constraint school_invitation_profile_school
    foreign key(personnel_profile_id,school_id)
      references public.school_personnel_profiles(id,school_id) on delete restrict,
  constraint school_invitation_email_shape
    check(length(invite_email) between 5 and 254 and invite_email=lower(invite_email))
);
create unique index if not exists school_invitation_one_pending_profile
  on public.school_invitations(school_id,personnel_profile_id) where status='pending';
create index if not exists school_invitations_school_created
  on public.school_invitations(school_id,created_at desc);
create index if not exists school_invitations_email_status
  on public.school_invitations(invite_email,status,expires_at);
alter table public.school_invitations enable row level security;
revoke all on public.school_invitations from public,anon,authenticated;

create or replace function public.itqan_school_invitation_create(
  p_school uuid,p_profile uuid,p_email text,p_mode text default 'school'
) returns uuid
language plpgsql security definer set search_path=''
as $fn$
declare
 v_actor uuid:=auth.uid();
 v_email text:=lower(btrim(coalesce(p_email,'')));
 v_id uuid;
begin
 if v_actor is null or not itqan_private.has_school_permission(p_school,'school.manage_members')
 then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_mode not in ('school','personal') or length(v_email) not between 5 and 254
   or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
   raise exception 'Invalid invitation fields' using errcode='22023';
 end if;
 if not exists (
   select 1 from public.school_personnel_profiles p
   where p.id=p_profile and p.school_id=p_school and p.status='active'
 ) then raise exception 'Active personnel profile required' using errcode='22023'; end if;
 if exists (
   select 1 from public.school_memberships m
   where m.school_id=p_school and m.personnel_profile_id=p_profile and m.status='active'
 ) then raise exception 'Profile already linked to active account' using errcode='23505';end if;
 -- Expired but unclaimed invitations can be retired without creating competing active rows.
 update public.school_invitations set status='cancelled',decided_at=now()
 where school_id=p_school and personnel_profile_id=p_profile
   and status='pending' and expires_at<=now();
 insert into public.school_invitations(school_id,personnel_profile_id,invite_email,
   account_mode,created_by) values(p_school,p_profile,v_email,p_mode,v_actor)
 returning id into v_id;
 return v_id;
end
$fn$;
revoke all on function public.itqan_school_invitation_create(uuid,uuid,text,text) from public,anon;
grant execute on function public.itqan_school_invitation_create(uuid,uuid,text,text) to authenticated;

create or replace function public.itqan_school_invitation_list(p_school uuid)
returns jsonb
language plpgsql security definer set search_path=''
as $fn$
declare v_actor uuid:=auth.uid();v_result jsonb;
begin
 if v_actor is null or not itqan_private.has_school_permission(p_school,'school.manage_members')
 then raise exception 'Forbidden' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',i.id,'profile_id',i.personnel_profile_id,'full_name',p.full_name_snapshot,
  'email',i.invite_email,'mode',i.account_mode,'status',i.status,
  'expires_at',i.expires_at,'created_at',i.created_at) order by i.created_at desc),'[]'::jsonb)
 into v_result
 from public.school_invitations i join public.school_personnel_profiles p
   on p.id=i.personnel_profile_id and p.school_id=i.school_id
 where i.school_id=p_school;
 return v_result;
end
$fn$;
revoke all on function public.itqan_school_invitation_list(uuid) from public,anon;
grant execute on function public.itqan_school_invitation_list(uuid) to authenticated;

create or replace function public.itqan_school_invitation_mine()
returns jsonb
language plpgsql security definer set search_path=''
as $fn$
declare v_actor uuid:=auth.uid();v_email text;v_result jsonb;
begin
 if v_actor is null or not exists(select 1 from public.users u where u.id=v_actor and u.status='active')
 then raise exception 'Unauthorized' using errcode='42501';end if;
 select lower(a.email) into v_email from auth.users a
 where a.id=v_actor and a.email_confirmed_at is not null;
 if v_email is null then return '[]'::jsonb;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'school_name',s.name,
  'profile_name',p.full_name_snapshot,'mode',i.account_mode,
  'expires_at',i.expires_at) order by i.created_at desc),'[]'::jsonb)
 into v_result
 from public.school_invitations i join public.schools s on s.id=i.school_id
 join public.school_personnel_profiles p on p.id=i.personnel_profile_id
 where i.invite_email=v_email and i.status='pending' and i.expires_at>now()
   and s.status='active';
 return v_result;
end
$fn$;
revoke all on function public.itqan_school_invitation_mine() from public,anon;
grant execute on function public.itqan_school_invitation_mine() to authenticated;

create or replace function public.itqan_school_invitation_decide(
  p_invitation uuid,p_accept boolean
) returns jsonb
language plpgsql security definer set search_path=''
as $fn$
declare
 v_actor uuid:=auth.uid();v_inv public.school_invitations%rowtype;
 v_auth auth.users%rowtype;v_profile public.school_personnel_profiles%rowtype;
 v_placement public.school_employees%rowtype;v_employee public.employees%rowtype;
 v_job text:='staff';
begin
 if v_actor is null then raise exception 'Unauthorized' using errcode='42501';end if;
 select * into v_inv from public.school_invitations where id=p_invitation for update;
 select * into v_auth from auth.users where id=v_actor;
 if v_inv.id is null or v_auth.id is null or v_auth.email_confirmed_at is null
    or lower(v_auth.email)<>v_inv.invite_email
    or not exists(select 1 from public.users u where u.id=v_actor and u.status='active')
 then raise exception 'Forbidden' using errcode='42501';end if;
 if v_inv.status<>'pending' or v_inv.expires_at<=now()
 then raise exception 'Invitation is unavailable' using errcode='22023';end if;
 if p_accept is not true then
   update public.school_invitations set status='declined',decided_at=now(),accepted_by=v_actor
   where id=p_invitation;
   return jsonb_build_object('status','declined');
 end if;
 if v_inv.account_mode='school' and v_auth.created_at<v_inv.created_at then
   raise exception 'Use a new independent school account email' using errcode='22023';
 end if;
 if exists(select 1 from public.school_memberships m
     where m.user_id=v_actor and m.status='active')
 then raise exception 'Active school account already exists' using errcode='23505';end if;
 if exists(select 1 from public.school_memberships m
     where m.school_id=v_inv.school_id and m.personnel_profile_id=v_inv.personnel_profile_id
       and m.status='active')
 then raise exception 'Profile already linked to another active account' using errcode='23505';end if;
 select * into v_profile from public.school_personnel_profiles
 where id=v_inv.personnel_profile_id and school_id=v_inv.school_id and status='active';
 if v_profile.id is null or not exists (
   select 1 from public.schools where id=v_inv.school_id and status='active'
 ) then raise exception 'School or profile inactive' using errcode='22023';end if;
 select * into v_employee from public.employees where id=v_profile.employee_id for update;
 if v_inv.account_mode='personal' then
   if v_employee.user_id is not null and v_employee.user_id<>v_actor then
     raise exception 'Identity belongs to a different personal account' using errcode='23505';end if;
   if v_employee.user_id is null then
     update public.employees set user_id=v_actor where id=v_employee.id;
   end if;
 end if;
 select * into v_placement from public.school_employees
 where personnel_profile_id=v_profile.id and school_id=v_inv.school_id and status='active'
 order by created_at desc limit 1;
 if v_placement.id is null then
   raise exception 'An active school placement is required' using errcode='22023';end if;
 if v_profile.job_title_id is not null then
   select case when code in ('teacher','vice_principal','counselor')
     then code else 'staff' end into v_job
   from public.job_titles where id=v_profile.job_title_id;
   v_job:=coalesce(v_job,'staff');
 end if;
 insert into public.school_memberships(school_id,user_id,access_role,job_role,status,
   employee_id,personnel_profile_id,academic_year_id)
 values(v_inv.school_id,v_actor,'employee',v_job,'active',
   v_profile.employee_id,v_profile.id,v_placement.academic_year_id);
 update public.school_invitations set status='accepted',accepted_by=v_actor,
   decided_at=now() where id=v_inv.id;
 return jsonb_build_object('status','accepted','school_id',v_inv.school_id);
end
$fn$;
revoke all on function public.itqan_school_invitation_decide(uuid,boolean) from public,anon;
grant execute on function public.itqan_school_invitation_decide(uuid,boolean) to authenticated;

create or replace function public.itqan_school_invitation_cancel(
  p_school uuid,p_invitation uuid
) returns boolean
language plpgsql security definer set search_path=''
as $fn$
declare v_actor uuid:=auth.uid();
begin
 if v_actor is null or not itqan_private.has_school_permission(p_school,'school.manage_members')
 then raise exception 'Forbidden' using errcode='42501';end if;
 update public.school_invitations set status='cancelled',decided_at=now()
 where id=p_invitation and school_id=p_school and status='pending';
 return found;
end
$fn$;
revoke all on function public.itqan_school_invitation_cancel(uuid,uuid) from public,anon;
grant execute on function public.itqan_school_invitation_cancel(uuid,uuid) to authenticated;
