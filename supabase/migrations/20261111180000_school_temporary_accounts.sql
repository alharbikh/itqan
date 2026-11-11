-- #47 exceptional principal-issued independent school login with a temporary credential.
-- Restricted to Supabase Edge's trusted service role; never callable by browsers.
create table if not exists public.school_temporary_account_events (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete restrict,
 personnel_profile_id uuid not null references public.school_personnel_profiles(id) on delete restrict,
 actor_user_id uuid not null references public.users(id),
 target_user_id uuid not null references public.users(id),
 reason text not null check(length(reason) between 10 and 500),
 created_at timestamptz not null default now()
);
alter table public.school_temporary_account_events enable row level security;
revoke all on public.school_temporary_account_events from public,anon,authenticated;

create or replace function public.itqan_school_provision_temporary_account(
 p_school uuid,p_profile uuid,p_actor uuid,p_user uuid,p_email text,p_reason text
) returns boolean
language plpgsql security definer set search_path=''
as $fn$
declare
 v_profile public.school_personnel_profiles%rowtype;
 v_auth auth.users%rowtype;
 v_placement public.school_employees%rowtype;
 v_job text:='staff';
begin
 if p_actor is null or p_user is null or p_actor=p_user or
   length(btrim(coalesce(p_reason,''))) not between 10 and 500
 then raise exception 'Invalid request' using errcode='22023';end if;
 if not exists(
  select 1 from public.users u join public.school_memberships m on m.user_id=u.id
  join public.schools s on s.id=m.school_id
  where u.id=p_actor and u.status='active' and m.school_id=p_school
    and m.access_role='school_principal' and m.status='active' and s.status='active'
 ) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into v_profile from public.school_personnel_profiles
 where id=p_profile and school_id=p_school and status='active' for update;
 if v_profile.id is null then raise exception 'Active profile required' using errcode='22023';end if;
 if exists(select 1 from public.school_memberships
   where status='active' and (user_id=p_user or
     (school_id=p_school and personnel_profile_id=p_profile)))
 then raise exception 'Existing membership' using errcode='23505';end if;
 select * into v_auth from auth.users where id=p_user;
 if v_auth.id is null or lower(coalesce(v_auth.email,''))<>lower(btrim(p_email)) or
  v_auth.email_confirmed_at is null or v_auth.created_at < now()-interval '5 minutes' or
  coalesce(v_auth.raw_app_meta_data->>'itqan_force_password_change','')<>'true' or
  coalesce(v_auth.raw_app_meta_data->>'itqan_school_account','')<>'true'
 then raise exception 'Temporary Auth identity invalid' using errcode='42501';end if;
 if not exists(select 1 from public.users where id=p_user and status='active')
 then raise exception 'Account not active' using errcode='42501';end if;
 if exists(select 1 from public.user_roles where user_id=p_user and role_code='site_admin')
 then raise exception 'Central admin account cannot be assigned' using errcode='42501';end if;
 select * into v_placement from public.school_employees
 where personnel_profile_id=p_profile and school_id=p_school and status='active'
 order by created_at desc limit 1;
 if v_placement.id is null then raise exception 'Active placement required' using errcode='22023';end if;
 if v_profile.job_title_id is not null then
  select case when code in ('teacher','vice_principal','counselor')
   then code else 'staff' end into v_job
  from public.job_titles where id=v_profile.job_title_id;
  v_job:=coalesce(v_job,'staff');
 end if;
 insert into public.school_memberships(school_id,user_id,access_role,job_role,status,
 employee_id,personnel_profile_id,academic_year_id)
 values(p_school,p_user,'employee',v_job,'active',
 v_profile.employee_id,p_profile,v_placement.academic_year_id);
 insert into public.school_temporary_account_events
 (school_id,personnel_profile_id,actor_user_id,target_user_id,reason)
 values(p_school,p_profile,p_actor,p_user,btrim(p_reason));
 return true;
end
$fn$;
revoke all on function public.itqan_school_provision_temporary_account(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.itqan_school_provision_temporary_account(uuid,uuid,uuid,uuid,text,text) to service_role;
