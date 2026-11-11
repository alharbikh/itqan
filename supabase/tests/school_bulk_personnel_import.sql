-- #47 batch import: disposable CI database only, rollback fixtures at end.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)
VALUES ('c7777777-7777-4777-8777-777777777777',
'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
'bulk-principal@itqan.invalid',now(),now(),now());
INSERT INTO public.schools(id,name,status) VALUES
('c8888888-8888-4888-8888-888888888888','Bulk import school','active'),
('c9999999-9999-4999-8999-999999999999','Other school','active');
INSERT INTO public.academic_years(id,label,starts_on,ends_on,is_current)
VALUES('c6666666-6666-4666-8666-666666666666','1448','2026-08-01','2027-07-31',false);
INSERT INTO public.school_memberships(school_id,user_id,access_role,job_role,status)
VALUES('c8888888-8888-4888-8888-888888888888',
'c7777777-7777-4777-8777-777777777777','school_principal','principal','active');
SET LOCAL ROLE authenticated;
DO $test$
DECLARE v_result jsonb; v_failed boolean:=false;
 v_items jsonb:='[{"full_name":"أحمد اختبار","employee_number":"00001","national_id":"1234567890"},{"full_name":"محمد اختبار","employee_number":"00002","national_id":"1234567891"}]'::jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','c7777777-7777-4777-8777-777777777777',true);
 v_result:=public.itqan_school_import_profiles(
 'c8888888-8888-4888-8888-888888888888','c6666666-6666-4666-8666-666666666666',v_items);
 IF (v_result->>'created')::int<>2 OR (v_result->>'skipped')::int<>0
 THEN RAISE EXCEPTION 'Initial batch not created'; END IF;
 v_result:=public.itqan_school_import_profiles(
 'c8888888-8888-4888-8888-888888888888','c6666666-6666-4666-8666-666666666666',v_items);
 IF (v_result->>'created')::int<>0 OR (v_result->>'skipped')::int<>2
 THEN RAISE EXCEPTION 'Idempotent rerun failed'; END IF;
 BEGIN
  PERFORM public.itqan_school_import_profiles(
  'c9999999-9999-4999-8999-999999999999','c6666666-6666-4666-8666-666666666666',v_items);
 EXCEPTION WHEN insufficient_privilege THEN v_failed:=true;
 END;
 IF NOT v_failed THEN RAISE EXCEPTION 'Foreign school import permitted'; END IF;
 v_failed:=false;
 BEGIN
  PERFORM public.itqan_school_import_profiles(
  'c8888888-8888-4888-8888-888888888888','c6666666-6666-4666-8666-666666666666',
  '[{"full_name":"Test name","employee_number":"00001","national_id":"5555555555"}]'::jsonb);
 EXCEPTION WHEN unique_violation THEN v_failed:=true;
 END;
 IF NOT v_failed THEN RAISE EXCEPTION 'Identity mismatch not blocked'; END IF;
END $test$;
RESET ROLE;
ROLLBACK;
