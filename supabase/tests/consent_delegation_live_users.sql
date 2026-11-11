-- Authorization regression for disabled subject, delegate and grantor accounts.
-- Disposable Supabase only. Fixture changes are rolled back.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)
VALUES
 ('61111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','audit-principal@itqan.invalid',now(),now(),now()),
 ('62222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','audit-subject@itqan.invalid',now(),now(),now()),
 ('63333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','audit-delegate@itqan.invalid',now(),now(),now());
INSERT INTO public.schools(id,name,status) VALUES
 ('64444444-4444-4444-8444-444444444444','Consent status test school','active');
INSERT INTO public.school_memberships(school_id,user_id,access_role,job_role,status)
VALUES
 ('64444444-4444-4444-8444-444444444444','61111111-1111-4111-8111-111111111111','school_principal','principal','active'),
 ('64444444-4444-4444-8444-444444444444','62222222-2222-4222-8222-222222222222','employee','teacher','active'),
 ('64444444-4444-4444-8444-444444444444','63333333-3333-4333-8333-333333333333','employee','teacher','active');
SET LOCAL ROLE authenticated;
DO $grant_active$
DECLARE v_id uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','61111111-1111-4111-8111-111111111111',true);
 v_id:=public.itqan_school_grant_review_delegation(
  '64444444-4444-4444-8444-444444444444',
  '63333333-3333-4333-8333-333333333333',
  '62222222-2222-4222-8222-222222222222',
  'evidence_review',now()+interval '1 day');
 IF v_id IS NULL THEN RAISE EXCEPTION 'Active delegation was not created';END IF;
END $grant_active$;
RESET ROLE;
UPDATE public.users SET status='disabled'
WHERE id='63333333-3333-4333-8333-333333333333';
SET LOCAL ROLE authenticated;
DO $disabled_delegate$
DECLARE denied boolean:=false;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','61111111-1111-4111-8111-111111111111',true);
 BEGIN
 PERFORM public.itqan_school_grant_review_delegation(
  '64444444-4444-4444-8444-444444444444',
  '63333333-3333-4333-8333-333333333333',
  '62222222-2222-4222-8222-222222222222',
  'performance_scoring',now()+interval '1 day');
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Disabled delegate was accepted';END IF;
END $disabled_delegate$;
RESET ROLE;
UPDATE public.users SET status='active'
WHERE id='63333333-3333-4333-8333-333333333333';
UPDATE public.users SET status='disabled'
WHERE id='62222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
DO $disabled_subject$
DECLARE denied boolean:=false;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','61111111-1111-4111-8111-111111111111',true);
 BEGIN
 PERFORM public.itqan_school_grant_review_delegation(
  '64444444-4444-4444-8444-444444444444',
  '63333333-3333-4333-8333-333333333333',
  '62222222-2222-4222-8222-222222222222',
  'performance_scoring',now()+interval '1 day');
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Disabled review subject was accepted';END IF;
END $disabled_subject$;
RESET ROLE;
UPDATE public.users SET status='active'
WHERE id='62222222-2222-4222-8222-222222222222';
UPDATE public.users SET status='disabled'
WHERE id='61111111-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
DO $disabled_actor$
DECLARE denied boolean; err text; v_id uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','61111111-1111-4111-8111-111111111111',true);
 denied:=false;
 BEGIN
  PERFORM public.itqan_profile_operation_decide(NULL::uuid,'subject','approved');
 EXCEPTION WHEN insufficient_privilege THEN
  GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
  denied:=err='Active account required';
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Disabled user could call profile operation decision';END IF;
 denied:=false;
 SELECT id INTO v_id FROM public.school_review_delegations
 WHERE school_id='64444444-4444-4444-8444-444444444444'
 AND delegate_user_id='63333333-3333-4333-8333-333333333333';
 BEGIN
  PERFORM public.itqan_school_revoke_review_delegation(v_id);
 EXCEPTION WHEN insufficient_privilege THEN
  GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
  denied:=err='Active account required';
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Disabled grantor could revoke delegation';END IF;
END $disabled_actor$;
RESET ROLE;
DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.school_review_delegations
   WHERE school_id='64444444-4444-4444-8444-444444444444')<>1 THEN
   RAISE EXCEPTION 'Rejected delegation attempts inserted extra records';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.school_review_delegations
   WHERE school_id='64444444-4444-4444-8444-444444444444'
   AND revoked_at IS NULL) THEN
   RAISE EXCEPTION 'Rejected revocation changed existing delegation';END IF;
END $verify$;
ROLLBACK;
