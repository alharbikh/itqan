-- #47 temporary school login: privileged service-only RPC and school-scoped, audited provisioning.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data)
VALUES
('a1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','temp-principal@itqan.invalid',now(),now(),now(),'{}'::jsonb),
('a2222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','temp-target@itqan.invalid',now(),now(),now(),'{"itqan_force_password_change":true,"itqan_school_account":true}'::jsonb),
('a3333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','temp-outsider@itqan.invalid',now(),now(),now(),'{}'::jsonb);
INSERT INTO public.schools(id,name,status)
VALUES('a4444444-4444-4444-8444-444444444444','Temporary school','active'),
('a5555555-5555-4555-8555-555555555555','Temporary other school','active');
INSERT INTO public.academic_years(id,label,starts_on,ends_on,is_current)
VALUES('a6666666-6666-4666-8666-666666666666','1448-temp','2026-08-01','2027-07-31',false);
INSERT INTO public.school_memberships(school_id,user_id,access_role,job_role,status)
VALUES('a4444444-4444-4444-8444-444444444444','a1111111-1111-4111-8111-111111111111','school_principal','principal','active');
DO $create_profile$
DECLARE v_profile uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
 v_profile:=public.itqan_school_create_profile('a4444444-4444-4444-8444-444444444444',
  'a6666666-6666-4666-8666-666666666666','Temporary Teacher','3234567890','TEMP-01',null,null);
 PERFORM set_config('itqan_test.temp_profile',v_profile::text,true);
END $create_profile$;
DO $security$
BEGIN
 IF has_function_privilege('authenticated','public.itqan_school_provision_temporary_account(uuid,uuid,uuid,uuid,text,text)','EXECUTE')
 OR has_function_privilege('anon','public.itqan_school_provision_temporary_account(uuid,uuid,uuid,uuid,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Temporary account RPC exposed publicly'; END IF;
END $security$;
DO $isolation$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN
  PERFORM public.itqan_school_provision_temporary_account(
   'a5555555-5555-4555-8555-555555555555',
   current_setting('itqan_test.temp_profile')::uuid,
   'a1111111-1111-4111-8111-111111111111',
   'a2222222-2222-4222-8222-222222222222',
   'temp-target@itqan.invalid','Verified exceptional onboarding');
 EXCEPTION WHEN insufficient_privilege OR invalid_parameter_value THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'Cross-school creation succeeded';END IF;
END $isolation$;
DO $provision$
DECLARE success boolean;qty integer;
BEGIN
 success:=public.itqan_school_provision_temporary_account(
  'a4444444-4444-4444-8444-444444444444',
  current_setting('itqan_test.temp_profile')::uuid,
  'a1111111-1111-4111-8111-111111111111',
  'a2222222-2222-4222-8222-222222222222',
  'temp-target@itqan.invalid','Verified exceptional onboarding');
 IF success IS DISTINCT FROM true THEN RAISE EXCEPTION 'Provisioning did not succeed';END IF;
 SELECT count(*) INTO qty FROM public.school_memberships WHERE
   user_id='a2222222-2222-4222-8222-222222222222' AND school_id='a4444444-4444-4444-8444-444444444444'
   AND status='active';
 IF qty<>1 THEN RAISE EXCEPTION 'Target membership missing';END IF;
 SELECT count(*) INTO qty FROM public.school_temporary_account_events WHERE
  target_user_id='a2222222-2222-4222-8222-222222222222';
 IF qty<>1 THEN RAISE EXCEPTION 'Audit record missing';END IF;
END $provision$;
ROLLBACK;
