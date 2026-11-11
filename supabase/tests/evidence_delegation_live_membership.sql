-- Authenticated delegated evidence reviewer: active school membership and
-- active application account are checked on every call.
-- Disposable Supabase only. Everything is rolled back.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)
VALUES
 ('81111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','delegation-owner@itqan.invalid',now(),now(),now()),
 ('82222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','delegation-reviewer@itqan.invalid',now(),now(),now()),
 ('83333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','delegation-admin@itqan.invalid',now(),now(),now());
INSERT INTO public.schools(id,name,status)
VALUES('84444444-4444-4444-8444-444444444444','Delegated evidence test','active');
INSERT INTO public.school_memberships(school_id,user_id,access_role,job_role,status)
VALUES
 ('84444444-4444-4444-8444-444444444444','81111111-1111-4111-8111-111111111111','employee','teacher','active'),
 ('84444444-4444-4444-8444-444444444444','82222222-2222-4222-8222-222222222222','employee','teacher','active'),
 ('84444444-4444-4444-8444-444444444444','83333333-3333-4333-8333-333333333333','school_principal','principal','active');
INSERT INTO public.portfolio_records(id,school_id,user_id,title)
VALUES('85555555-5555-4555-8555-555555555555','84444444-4444-4444-8444-444444444444',
'81111111-1111-4111-8111-111111111111','Temporary evidence portfolio');
INSERT INTO public.evidence_records(id,portfolio_id,school_id,user_id,title)
VALUES('86666666-6666-4666-8666-666666666666','85555555-5555-4555-8555-555555555555',
'84444444-4444-4444-8444-444444444444','81111111-1111-4111-8111-111111111111','Temporary evidence');
INSERT INTO public.school_review_delegations(school_id,granted_by,delegate_user_id,subject_user_id,scope,expires_at)
VALUES('84444444-4444-4444-8444-444444444444','83333333-3333-4333-8333-333333333333',
'82222222-2222-4222-8222-222222222222','81111111-1111-4111-8111-111111111111',
'evidence_review',now()+interval '1 day');

SET LOCAL ROLE authenticated;
DO $active_delegation$
BEGIN
 PERFORM set_config('request.jwt.claim.sub','82222222-2222-4222-8222-222222222222',true);
 IF NOT public.itqan_school_review_evidence('86666666-6666-4666-8666-666666666666','approved','legitimate delegated review') THEN
  RAISE EXCEPTION 'Authorized active delegate should review evidence';
 END IF;
END $active_delegation$;
RESET ROLE;
DO $confirmed$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.evidence_records
 WHERE id='86666666-6666-4666-8666-666666666666' AND evidence_status='approved') THEN
  RAISE EXCEPTION 'Active delegate action not persisted within transaction';
 END IF;
END $confirmed$;

UPDATE public.school_memberships SET status='inactive'
WHERE school_id='84444444-4444-4444-8444-444444444444'
 AND user_id='82222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
DO $expired_membership$
DECLARE rejected boolean:=false;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','82222222-2222-4222-8222-222222222222',true);
 BEGIN
  PERFORM public.itqan_school_review_evidence('86666666-6666-4666-8666-666666666666','rejected','should not apply');
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'Removed school delegate still has review authority';END IF;
END $expired_membership$;
RESET ROLE;
UPDATE public.school_memberships SET status='active'
WHERE school_id='84444444-4444-4444-8444-444444444444'
 AND user_id='82222222-2222-4222-8222-222222222222';
UPDATE public.users SET status='disabled' WHERE id='82222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
DO $disabled_reviewer$
DECLARE rejected boolean:=false;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','82222222-2222-4222-8222-222222222222',true);
 BEGIN
  PERFORM public.itqan_school_review_evidence('86666666-6666-4666-8666-666666666666','rejected','should not apply');
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'Disabled account still has delegated evidence review authority';END IF;
END $disabled_reviewer$;
RESET ROLE;
DO $final_evidence$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.evidence_records
 WHERE id='86666666-6666-4666-8666-666666666666' AND evidence_status='approved') THEN
  RAISE EXCEPTION 'Denied delegation mutated evidence';
 END IF;
END $final_evidence$;
ROLLBACK;
