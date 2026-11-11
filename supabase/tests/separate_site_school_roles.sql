-- ITQAN approved governance: site and school grants never inherit one another.
-- Test only in the disposable Supabase CI database; all fixtures rolled back.
BEGIN;

INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)
VALUES
 ('a1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','roles-site@itqan.invalid',now(),now(),now()),
 ('a2222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','roles-principal@itqan.invalid',now(),now(),now()),
 ('a3333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','roles-employee@itqan.invalid',now(),now(),now());

INSERT INTO public.schools(id,name,status) VALUES
 ('a4444444-4444-4444-8444-444444444444','Role test school A','active'),
 ('a5555555-5555-4555-8555-555555555555','Role test school B','active');

INSERT INTO public.user_roles(user_id,role_code) VALUES
 ('a1111111-1111-4111-8111-111111111111','site_admin');

INSERT INTO public.school_memberships(school_id,user_id,access_role,job_role,status) VALUES
 ('a5555555-5555-4555-8555-555555555555','a2222222-2222-4222-8222-222222222222','school_principal','principal','active'),
 ('a4444444-4444-4444-8444-444444444444','a3333333-3333-4333-8333-333333333333','employee','teacher','active');

SET LOCAL ROLE authenticated;

DO $site_only$
BEGIN
 PERFORM set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
 IF NOT itqan_private.has_system_permission('system.manage_schools')
 OR NOT itqan_private.has_system_permission('system.manage_users')
 OR NOT itqan_private.has_system_permission('system.manage_roles') THEN
  RAISE EXCEPTION 'Site administrator lost central permissions';
 END IF;

 IF itqan_private.has_school_permission('a4444444-4444-4444-8444-444444444444','school.manage_reviews')
 OR itqan_private.has_school_permission('a5555555-5555-4555-8555-555555555555','school.publish_reviews')
 OR itqan_private.has_school_permission('a4444444-4444-4444-8444-444444444444','school.manage_members')
 OR itqan_private.has_school_permission('a5555555-5555-4555-8555-555555555555','school.view') THEN
  RAISE EXCEPTION 'Central site administrator inherited school authority';
 END IF;
END $site_only$;

DO $principal_only$
BEGIN
 PERFORM set_config('request.jwt.claim.sub','a2222222-2222-4222-8222-222222222222',true);
 IF itqan_private.has_system_permission('system.manage_roles')
 OR itqan_private.has_system_permission('system.manage_schools') THEN
  RAISE EXCEPTION 'Principal inherited site-wide authority';
 END IF;
 IF NOT itqan_private.has_school_permission('a5555555-5555-4555-8555-555555555555','school.manage_reviews')
 OR NOT itqan_private.has_school_permission('a5555555-5555-4555-8555-555555555555','school.publish_reviews')
 OR itqan_private.has_school_permission('a4444444-4444-4444-8444-444444444444','school.manage_reviews') THEN
  RAISE EXCEPTION 'Principal school scope invalid';
 END IF;
END $principal_only$;

DO $employee_only$
BEGIN
 PERFORM set_config('request.jwt.claim.sub','a3333333-3333-4333-8333-333333333333',true);
 IF NOT itqan_private.has_school_permission('a4444444-4444-4444-8444-444444444444','school.view')
 OR itqan_private.has_school_permission('a4444444-4444-4444-8444-444444444444','school.manage_reviews')
 OR itqan_private.has_school_permission('a5555555-5555-4555-8555-555555555555','school.view')
 OR itqan_private.has_system_permission('system.manage_users') THEN
  RAISE EXCEPTION 'Employee permissions or school scope invalid';
 END IF;
END $employee_only$;

RESET ROLE;
-- The same user has site_admin plus a principal membership at school A.
INSERT INTO public.school_memberships(school_id,user_id,access_role,job_role,status)
VALUES('a4444444-4444-4444-8444-444444444444',
'a1111111-1111-4111-8111-111111111111','school_principal','principal','active');

SET LOCAL ROLE authenticated;
DO $dual_role$
BEGIN
 PERFORM set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
 IF NOT itqan_private.has_system_permission('system.manage_users')
 OR NOT itqan_private.has_school_permission('a4444444-4444-4444-8444-444444444444','school.manage_reviews')
 OR NOT itqan_private.has_school_permission('a4444444-4444-4444-8444-444444444444','school.publish_reviews')
 OR itqan_private.has_school_permission('a5555555-5555-4555-8555-555555555555','school.manage_reviews') THEN
  RAISE EXCEPTION 'Dual-role user not correctly scoped to school A';
 END IF;
END $dual_role$;

RESET ROLE;
UPDATE public.school_memberships
 SET status='inactive'
 WHERE school_id='a4444444-4444-4444-8444-444444444444'
 AND user_id='a1111111-1111-4111-8111-111111111111';

SET LOCAL ROLE authenticated;
DO $inactive_school_role$
BEGIN
 PERFORM set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
 IF itqan_private.has_school_permission('a4444444-4444-4444-8444-444444444444','school.manage_reviews')
 OR NOT itqan_private.has_system_permission('system.manage_schools') THEN
   RAISE EXCEPTION 'Inactive school membership did not revoke only school scope';
 END IF;
END $inactive_school_role$;

RESET ROLE;
UPDATE public.school_memberships
 SET status='active'
 WHERE school_id='a4444444-4444-4444-8444-444444444444'
 AND user_id='a1111111-1111-4111-8111-111111111111';
UPDATE public.schools SET status='inactive'
 WHERE id='a4444444-4444-4444-8444-444444444444';
SET LOCAL ROLE authenticated;
DO $inactive_school$
BEGIN
 PERFORM set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
 IF itqan_private.has_school_permission('a4444444-4444-4444-8444-444444444444','school.manage_reviews')
 OR NOT itqan_private.has_system_permission('system.manage_schools') THEN
  RAISE EXCEPTION 'Inactive school still authorizes its principal';
 END IF;
END $inactive_school$;

RESET ROLE;
UPDATE public.schools SET status='active'
 WHERE id='a4444444-4444-4444-8444-444444444444';
UPDATE public.users SET status='disabled'
 WHERE id='a1111111-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
DO $disabled_dual_role$
BEGIN
 PERFORM set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
 IF itqan_private.has_school_permission('a4444444-4444-4444-8444-444444444444','school.manage_reviews')
 OR itqan_private.has_system_permission('system.manage_schools') THEN
   RAISE EXCEPTION 'Disabled dual-role account retained permission';
 END IF;
END $disabled_dual_role$;

RESET ROLE;
DO $role_matrix_guards$
BEGIN
 IF EXISTS(SELECT 1 FROM public.role_permissions
 WHERE role_code='site_admin' AND permission_code LIKE 'school.%') THEN
  RAISE EXCEPTION 'Site role still inherits school grants';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.role_permissions
 WHERE role_code='school_principal' AND permission_code='school.publish_reviews') THEN
  RAISE EXCEPTION 'Principal role grant missing';
 END IF;
END $role_matrix_guards$;

ROLLBACK;
