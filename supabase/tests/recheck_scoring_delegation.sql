-- Permission regression for previously delegated performance scoring.
-- Disposable Supabase database only; rollback prevents fixture persistence.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)
VALUES
 ('91111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','scoring-admin@itqan.invalid',now(),now(),now()),
 ('92222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','scoring-principal@itqan.invalid',now(),now(),now()),
 ('93333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','scoring-subject@itqan.invalid',now(),now(),now()),
 ('94444444-4444-4444-8444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','scoring-delegate@itqan.invalid',now(),now(),now());
INSERT INTO public.user_roles(user_id,role_code)
VALUES('91111111-1111-4111-8111-111111111111','site_admin');
INSERT INTO public.schools(id,name,status)
VALUES('95555555-5555-4555-8555-555555555555','Scoring delegation test school','active');
INSERT INTO public.school_memberships(school_id,user_id,access_role,job_role,status)
VALUES
 ('95555555-5555-4555-8555-555555555555','92222222-2222-4222-8222-222222222222','school_principal','principal','active'),
 ('95555555-5555-4555-8555-555555555555','93333333-3333-4333-8333-333333333333','employee','teacher','active'),
 ('95555555-5555-4555-8555-555555555555','94444444-4444-4444-8444-444444444444','employee','teacher','active');
SET LOCAL ROLE authenticated;
DO $setup_review$
DECLARE batch uuid;framework uuid;job uuid;criterion uuid;review uuid;grant_id uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','91111111-1111-4111-8111-111111111111',true);
 batch:=public.itqan_admin_stage_framework(
  '{"code":"SCORING-GATE-TEST","version_no":1,"title_ar":"Scoring auth fixture","source_reference":"temporary",
  "jobs":[{"code":"scoring_gate_teacher","title_ar":"Temporary role","criteria":[
    {"code":"scoring-gate-criterion","title_ar":"Single test criterion","weight":100,
     "descriptors":[{"level":5,"text":"Meets quality"}]}]}]}'::jsonb);
 framework:=public.itqan_admin_approve_framework(batch,'Audit fixture');
 PERFORM public.itqan_admin_publish_framework(batch);
 SELECT id INTO job FROM public.job_titles WHERE code='scoring_gate_teacher';
 SELECT id INTO criterion FROM public.evaluation_criteria WHERE code='scoring-gate-criterion';
 IF framework IS NULL OR job IS NULL OR criterion IS NULL THEN RAISE EXCEPTION 'Framework fixture missing';END IF;
 PERFORM set_config('request.jwt.claim.sub','92222222-2222-4222-8222-222222222222',true);
 review:=public.itqan_school_create_review('95555555-5555-4555-8555-555555555555',
 '93333333-3333-4333-8333-333333333333','security-scoring',framework,job);
 grant_id:=public.itqan_school_grant_review_delegation('95555555-5555-4555-8555-555555555555',
 '94444444-4444-4444-8444-444444444444','93333333-3333-4333-8333-333333333333',
 'performance_scoring',now()+interval '1 day');
 PERFORM set_config('request.jwt.claim.sub','94444444-4444-4444-8444-444444444444',true);
 IF NOT public.itqan_school_score_criterion(review,criterion,5::smallint,'Valid delegated scoring') THEN
  RAISE EXCEPTION 'Active authorized scorer was rejected';END IF;
END $setup_review$;
RESET ROLE;
UPDATE public.school_memberships SET status='inactive'
WHERE school_id='95555555-5555-4555-8555-555555555555'
 AND user_id='94444444-4444-4444-8444-444444444444';
SET LOCAL ROLE authenticated;
DO $inactive_delegate$
DECLARE denied boolean:=false;review uuid;criterion uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','94444444-4444-4444-8444-444444444444',true);
 SELECT id INTO review FROM public.performance_reviews WHERE academic_year='security-scoring';
 SELECT id INTO criterion FROM public.evaluation_criteria WHERE code='scoring-gate-criterion';
 BEGIN
  PERFORM public.itqan_school_score_criterion(review,criterion,4::smallint,'Must be rejected');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Inactive school membership retained delegated scoring access';END IF;
END $inactive_delegate$;
RESET ROLE;
UPDATE public.school_memberships SET access_role='employee',job_role='teacher'
WHERE school_id='95555555-5555-4555-8555-555555555555'
 AND user_id='92222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
DO $demoted_reviewer$
DECLARE denied boolean:=false;review uuid;criterion uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','92222222-2222-4222-8222-222222222222',true);
 SELECT id INTO review FROM public.performance_reviews WHERE academic_year='security-scoring';
 SELECT id INTO criterion FROM public.evaluation_criteria WHERE code='scoring-gate-criterion';
 BEGIN
  PERFORM public.itqan_school_score_criterion(review,criterion,4::smallint,'Must be rejected');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Demoted original evaluator retained scoring rights';END IF;
END $demoted_reviewer$;
RESET ROLE;
DO $assert_unchanged$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM public.evaluation_score_details d
  JOIN public.performance_reviews r ON r.id=d.performance_review_id
  WHERE r.academic_year='security-scoring' AND d.score_level=5
 ) THEN RAISE EXCEPTION 'Denied scoring mutated the original score';END IF;
END $assert_unchanged$;
ROLLBACK;
