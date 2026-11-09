-- ITQAN #12: run in disposable local Supabase only, no lasting fixtures.
begin;
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)
values
 ('61111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','link-owner@itqan.invalid',now(),now(),now()),
 ('62222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','link-principal@itqan.invalid',now(),now(),now()),
 ('63333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','link-employee@itqan.invalid',now(),now(),now());
insert into public.schools(id,name,status)
values('64444444-4444-4444-8444-444444444444','Link test school','active');
insert into public.academic_years(id,label,starts_on,ends_on)
values('65555555-5555-4555-8555-555555555555','Link test year',current_date-10,current_date+100);
insert into public.school_memberships(school_id,user_id,access_role,job_role,status)
values('64444444-4444-4444-8444-444444444444','62222222-2222-4222-8222-222222222222','school_principal','principal','active');
set local role authenticated;
do $$
declare school_employee uuid; request_id uuid; denied boolean:=false;
begin
 perform set_config('request.jwt.claim.sub','62222222-2222-4222-8222-222222222222',true);
 school_employee:=public.itqan_school_create_personnel(
  '64444444-4444-4444-8444-444444444444',
  '65555555-5555-4555-8555-555555555555','Test professional',null,null);
 perform set_config('request.jwt.claim.sub','63333333-3333-4333-8333-333333333333',true);
 request_id:=public.itqan_school_request_link(school_employee);
 begin
  perform public.itqan_school_decide_link(request_id,true,'teacher','unauthorized');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Employee approved own link request'; end if;
 perform set_config('request.jwt.claim.sub','62222222-2222-4222-8222-222222222222',true);
 perform public.itqan_school_decide_link(request_id,true,'teacher','Verified identity');
 if not exists(select 1 from public.school_link_requests where id=request_id and status='approved') then
  raise exception 'Decision did not persist';end if;
 perform set_config('request.jwt.claim.sub','63333333-3333-4333-8333-333333333333',true);
 if not exists(select 1 from public.school_memberships
   where user_id='63333333-3333-4333-8333-333333333333'
   and school_id='64444444-4444-4444-8444-444444444444' and status='active') then
  raise exception 'Approved school membership absent';end if;
 perform public.itqan_school_unlink(
   '64444444-4444-4444-8444-444444444444',
   '63333333-3333-4333-8333-333333333333','Transfer to other school');
 if exists(select 1 from public.school_memberships
   where user_id='63333333-3333-4333-8333-333333333333' and status='active') then
  raise exception 'Active membership survived unlink';end if;
 if not exists(select 1 from public.school_link_events
  where subject_user_id='63333333-3333-4333-8333-333333333333'
  and event_type='membership.unlinked') then raise exception 'Unlink audit absent';end if;
end $$;
rollback;
