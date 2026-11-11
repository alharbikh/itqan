-- RPC disabled-account regression: executed only in disposable local Supabase.
-- All sample accounts and writes are rolled back; never use production data.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)
VALUES
 ('81111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','inactive-rpc@itqan.invalid',now(),now(),now()),
 ('82222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','active-rpc@itqan.invalid',now(),now(),now());
UPDATE public.users SET status='disabled' WHERE id='81111111-1111-4111-8111-111111111111';
DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.users WHERE id='81111111-1111-4111-8111-111111111111' AND status='disabled')
 OR NOT EXISTS (SELECT 1 FROM public.users WHERE id='82222222-2222-4222-8222-222222222222' AND status='active') THEN
 RAISE EXCEPTION 'User setup failed before RPC test';
 END IF;
END $preflight$;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE current_case text; blocked boolean; error_message text; active_profiles jsonb; active_requests jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','81111111-1111-4111-8111-111111111111',true);

 FOR current_case IN SELECT unnest(ARRAY[
  'itqan_personnel_my_profiles','itqan_personnel_my_requests',
  'itqan_employee_ack_midyear','itqan_school_score_criterion','itqan_school_submit_review',
  'itqan_school_exception_criteria','itqan_school_exception_score',
  'itqan_school_exception_submit','itqan_school_request_review_exception'
 ]) LOOP
  blocked:=false;
  BEGIN
   CASE current_case
    WHEN 'itqan_personnel_my_profiles' THEN PERFORM public.itqan_personnel_my_profiles();
    WHEN 'itqan_personnel_my_requests' THEN PERFORM public.itqan_personnel_my_requests();
    WHEN 'itqan_employee_ack_midyear' THEN PERFORM public.itqan_employee_ack_midyear(NULL::uuid,NULL::text);
    WHEN 'itqan_school_score_criterion' THEN
      PERFORM public.itqan_school_score_criterion(NULL::uuid,NULL::uuid,NULL::smallint,NULL::text);
    WHEN 'itqan_school_submit_review' THEN PERFORM public.itqan_school_submit_review(NULL::uuid);
    WHEN 'itqan_school_exception_criteria' THEN
      PERFORM * FROM public.itqan_school_exception_criteria(NULL::uuid);
    WHEN 'itqan_school_exception_score' THEN
      PERFORM public.itqan_school_exception_score(NULL::uuid,NULL::uuid,NULL::smallint,NULL::text);
    WHEN 'itqan_school_exception_submit' THEN
      PERFORM public.itqan_school_exception_submit(NULL::uuid);
    WHEN 'itqan_school_request_review_exception' THEN
      PERFORM public.itqan_school_request_review_exception(NULL::uuid,NULL::text);
   END CASE;
  EXCEPTION WHEN insufficient_privilege THEN
   GET STACKED DIAGNOSTICS error_message=MESSAGE_TEXT;
   IF error_message='Active account required' THEN blocked:=true; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Disabled account was not denied by %',current_case; END IF;
 END LOOP;

 PERFORM set_config('request.jwt.claim.sub','82222222-2222-4222-8222-222222222222',true);
 active_profiles:=public.itqan_personnel_my_profiles();
 active_requests:=public.itqan_personnel_my_requests();
 IF active_profiles<>'[]'::jsonb OR active_requests<>'[]'::jsonb THEN
  RAISE EXCEPTION 'Active account own-record query unexpectedly changed behavior';
 END IF;
END $test$;
ROLLBACK;
