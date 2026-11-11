-- READ-ONLY production preflight for ITQAN school/site role separation.
-- Intentionally not a migration; must not modify production data or history.
-- Values reflect the production baseline observed 11 November 2026 and MUST
-- be revalidated before release. If anything has changed, stop and review.
DO $preflight$
DECLARE v_count integer;
BEGIN
 SELECT count(*) INTO v_count FROM supabase_migrations.schema_migrations;
 IF v_count<>41 THEN RAISE EXCEPTION 'Unexpected migration count: %, expected 41; stop release',v_count; END IF;
 IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
  WHERE version='20261111114500' AND name='reject_disabled_account_privileged_rpcs') THEN
  RAISE EXCEPTION 'Missing last production baseline migration';
 END IF;
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
 WHERE version IN ('20261111133000','20261111134500','20261111135500','20261111141500')) THEN
  RAISE EXCEPTION 'One or more pending migrations have already been registered; replan release';
 END IF;
 IF (SELECT count(*) FROM public.role_permissions
   WHERE role_code='site_admin' AND permission_code LIKE 'school.%')<>9 THEN
   RAISE EXCEPTION 'Inherited school permissions differ from baseline';
 END IF;
 IF (SELECT count(*) FROM public.role_permissions
   WHERE role_code='site_admin' AND permission_code LIKE 'system.%')<>4 THEN
   RAISE EXCEPTION 'Central site permissions differ from baseline';
 END IF;
 IF (SELECT count(*) FROM public.user_roles WHERE role_code='site_admin')<>1 THEN
   RAISE EXCEPTION 'Site admin account count differs from baseline';
 END IF;
 IF EXISTS(SELECT 1 FROM public.user_roles ur
   JOIN public.school_memberships m ON m.user_id=ur.user_id AND m.status='active'
   WHERE ur.role_code='site_admin') THEN
   RAISE EXCEPTION 'Site admin acquired school membership since impact review';
 END IF;
END;
$preflight$;

SELECT
 (SELECT count(*) FROM supabase_migrations.schema_migrations) AS migrations_before,
 (SELECT count(*) FROM public.role_permissions WHERE role_code='site_admin' AND permission_code LIKE 'school.%') AS inherited_school_permissions_before,
 (SELECT count(*) FROM public.role_permissions WHERE role_code='site_admin' AND permission_code LIKE 'system.%') AS central_permissions_before,
 (SELECT count(*) FROM public.school_memberships WHERE status='active') AS active_school_memberships,
 (SELECT count(*) FROM public.users) AS users_count,
 (SELECT count(*) FROM public.schools) AS schools_count;
