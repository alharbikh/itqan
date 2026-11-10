-- ITQAN #12 — isolated PostgreSQL integration test, never production.
begin;
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)
values
 ('71111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','personnel-owner@itqan.invalid',now(),now(),now()),
 ('72222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','personnel-principal-a@itqan.invalid',now(),now(),now()),
 ('73333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','personnel-principal-b@itqan.invalid',now(),now(),now());
insert into public.schools(id,name,status) values
 ('74444444-4444-4444-8444-444444444444','Personnel school A','active'),
 ('75555555-5555-4555-8555-555555555555','Personnel school B','active');
insert into public.academic_years(id,label,starts_on,ends_on)
 values('76666666-6666-4666-8666-666666666666','Personnel test year',current_date-10,current_date+100);
insert into public.school_memberships(school_id,user_id,access_role,job_role,status)
values
 ('74444444-4444-4444-8444-444444444444','72222222-2222-4222-8222-222222222222','school_principal','principal','active'),
 ('75555555-5555-4555-8555-555555555555','73333333-3333-4333-8333-333333333333','school_principal','principal','active');
set local role authenticated;
do $$
declare v_request uuid; v_profile uuid; v_transfer uuid; v_target uuid; v_json jsonb;
 v_denied boolean:=false; v_source_school uuid:='74444444-4444-4444-8444-444444444444';
 v_target_school uuid:='75555555-5555-4555-8555-555555555555';
 v_owner uuid:='71111111-1111-4111-8111-111111111111';
 v_principal_a uuid:='72222222-2222-4222-8222-222222222222';
 v_principal_b uuid:='73333333-3333-4333-8333-333333333333';
begin
 perform set_config('request.jwt.claim.sub',v_owner::text,true);
 begin
  perform 1 from public.school_personnel_profiles;
 exception when insufficient_privilege then v_denied:=true;
 end;
 if not v_denied then raise exception 'Private profiles directly readable'; end if;
 v_denied:=false;
 v_request:=public.itqan_personnel_submit_request(v_source_school,'Approved Employee','1234567890',null,'Education');
 if v_request is null then raise exception 'Request missing';end if;
 perform set_config('request.jwt.claim.sub',v_principal_a::text,true);
 perform public.itqan_school_personnel_decide(v_request,'start',null,null,null,null);
 perform set_config('request.jwt.claim.sub',v_owner::text,true);
 begin
   perform public.itqan_personnel_submit_request(v_source_school,'Tampered Name','1234567890',null,null);
 exception when invalid_parameter_value then v_denied:=true;
 end;
 if not v_denied then raise exception 'An in-review request was editable';end if;
 v_denied:=false;
 begin
   perform public.itqan_school_personnel_decide(v_request,'approve','A-001',
    '76666666-6666-4666-8666-666666666666',null,null);
 exception when insufficient_privilege then v_denied:=true;
 end;
 if not v_denied then raise exception 'Owner could self-approve';end if;
 perform set_config('request.jwt.claim.sub',v_principal_a::text,true);
 v_json:=public.itqan_school_personnel_decide(v_request,'approve','A-001',
    '76666666-6666-4666-8666-666666666666',null,'Identity checked');
 v_profile:=(v_json->>'profile_id')::uuid;
 if v_profile is null then raise exception 'Approved profile not produced';end if;
 perform set_config('request.jwt.claim.sub',v_owner::text,true);
 v_json:=public.itqan_personnel_my_profiles();
 if jsonb_array_length(v_json)<>1 or v_json->0->>'employee_number'<>'A-001' then
   raise exception 'Owner cannot view own profile';end if;
 -- A second school may receive a request, but may not approve a simultaneous active membership.
 v_denied:=false;
 v_request:=public.itqan_personnel_submit_request(v_target_school,'Approved Employee','1234567890',null,null);
 perform set_config('request.jwt.claim.sub',v_principal_b::text,true);
 perform public.itqan_school_personnel_decide(v_request,'start',null,null,null,null);
 begin
  perform public.itqan_school_personnel_decide(v_request,'approve','B-100',
   '76666666-6666-4666-8666-666666666666',null,null);
 exception when unique_violation then v_denied:=true;
 end;
 if not v_denied then raise exception 'A second active membership was allowed';end if;
 perform set_config('request.jwt.claim.sub',v_owner::text,true);
 perform public.itqan_school_unlink(v_source_school,v_owner,'Leaving old school');
 perform set_config('request.jwt.claim.sub',v_principal_b::text,true);
 v_transfer:=public.itqan_profile_operation_start(v_profile,v_target_school,'transfer','B-100',
    '["full_name_snapshot","specialization"]'::jsonb);
 v_denied:=false;
 begin
  perform public.itqan_profile_operation_execute(v_transfer);
 exception when insufficient_privilege then v_denied:=true;
 end;
 if not v_denied then raise exception 'Transfer executed without consents';end if;
 perform set_config('request.jwt.claim.sub',v_owner::text,true);
 perform public.itqan_profile_operation_decide(v_transfer,'subject','approved');
 perform set_config('request.jwt.claim.sub',v_principal_a::text,true);
 perform public.itqan_profile_operation_decide(v_transfer,'source_school_owner','approved');
 perform set_config('request.jwt.claim.sub',v_principal_b::text,true);
 v_target:=public.itqan_profile_operation_execute(v_transfer);
 if v_target is null or v_target=v_profile then raise exception 'Target file not created';end if;
 perform set_config('request.jwt.claim.sub',v_owner::text,true);
 v_json:=public.itqan_personnel_my_profiles();
 if jsonb_array_length(v_json)<>2 then raise exception 'Multiple school profiles missing';end if;
 if not exists (select 1 from jsonb_array_elements(v_json) v
    where v->>'id'=v_profile::text and v->>'status'='historical') then
   raise exception 'Source profile not archived after successful transfer';end if;
 if not exists (select 1 from jsonb_array_elements(v_json) v
    where v->>'id'=v_target::text and v->>'employee_number'='B-100') then
   raise exception 'Destination number not independently assigned';end if;
end $$;
rollback;
