-- #47: school-invited user signs in and accepts, school isolation and legacy deny.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)
VALUES
('d1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','invite-principal@itqan.invalid',now(),now(),now()),
('d2222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','wrong-recipient@itqan.invalid',now(),now(),now());
INSERT INTO public.schools(id,name,status)
VALUES('d3333333-3333-4333-8333-333333333333','Invitations school','active'),
('d4444444-4444-4444-8444-444444444444','Other school','active');
INSERT INTO public.academic_years(id,label,starts_on,ends_on,is_current)
VALUES('d5555555-5555-4555-8555-555555555555','1448-invites','2026-08-01','2027-07-31',false);
INSERT INTO public.school_memberships(school_id,user_id,access_role,job_role,status)
VALUES('d3333333-3333-4333-8333-333333333333',
 'd1111111-1111-4111-8111-111111111111','school_principal','principal','active');
SET LOCAL ROLE authenticated;
DO $create$
DECLARE v_profile uuid;v_invite uuid;v_rejected boolean:=false;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','d1111111-1111-4111-8111-111111111111',true);
 v_profile:=public.itqan_school_create_profile('d3333333-3333-4333-8333-333333333333',
  'd5555555-5555-4555-8555-555555555555','Invited Teacher','2234567890','INV-01',null,null);
 v_invite:=public.itqan_school_invitation_create('d3333333-3333-4333-8333-333333333333',
  v_profile,'invited-new@itqan.invalid','school');
 PERFORM set_config('itqan_test.invite_id',v_invite::text,true);
 BEGIN
  PERFORM public.itqan_school_invitation_create('d4444444-4444-4444-8444-444444444444',
   v_profile,'another@itqan.invalid','school');
 EXCEPTION WHEN insufficient_privilege THEN v_rejected:=true;
 END;
 IF NOT v_rejected THEN RAISE EXCEPTION 'Cross-school creation permitted'; END IF;
END $create$;
DO $wrong$
DECLARE rejected boolean:=false;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','d2222222-2222-4222-8222-222222222222',true);
 BEGIN
  PERFORM public.itqan_school_invitation_decide(current_setting('itqan_test.invite_id')::uuid,true);
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'Different email accepted invitation'; END IF;
END $wrong$;
RESET ROLE;
INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)
VALUES('d6666666-6666-4666-8666-666666666666',
 '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
 'invited-new@itqan.invalid',now(),now(),now());
SET LOCAL ROLE authenticated;
DO $accept$
DECLARE v_result jsonb;v_count integer;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','d6666666-6666-4666-8666-666666666666',true);
 v_result:=public.itqan_school_invitation_decide(current_setting('itqan_test.invite_id')::uuid,true);
 IF v_result->>'status'<>'accepted' THEN RAISE EXCEPTION 'Invitation was not accepted';END IF;
 SELECT count(*) into v_count from public.school_memberships
 where school_id='d3333333-3333-4333-8333-333333333333'
 and user_id='d6666666-6666-4666-8666-666666666666'
 and access_role='employee' and status='active';
 IF v_count<>1 THEN RAISE EXCEPTION 'Employee membership missing'; END IF;
 IF itqan_private.has_school_permission('d4444444-4444-4444-8444-444444444444','school.manage_members')
 THEN RAISE EXCEPTION 'Membership leaked outside invited school';END IF;
END $accept$;
RESET ROLE;
DO $security$
BEGIN
 IF has_function_privilege('authenticated',
 'public.itqan_personnel_submit_request(uuid,text,text,uuid,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.itqan_school_request_link(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Legacy employee self-request functions still executable';END IF;
END $security$;
ROLLBACK;
