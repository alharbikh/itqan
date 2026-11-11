-- ITQAN SMART PRO: site administration and school management are independent grants.
-- Approved governance: a user may have both roles; school authorities require
-- a live school-specific membership and must never be inherited from site_admin.
-- This does not revoke site administrators' system.* privileges or their
-- separate access to centralized school/user administration.
BEGIN;

DELETE FROM public.role_permissions
WHERE role_code='site_admin'
  AND permission_code LIKE 'school.%';

CREATE OR REPLACE FUNCTION itqan_private.has_school_permission(p_school uuid, p_perm text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
 SELECT (SELECT auth.uid()) IS NOT NULL
  AND p_school IS NOT NULL
  AND (p_perm LIKE 'school.%' OR p_perm LIKE 'self.%')
  AND EXISTS (
    SELECT 1
    FROM public.school_memberships m
    JOIN public.role_permissions rp ON rp.role_code=m.access_role
    JOIN public.schools s ON s.id=m.school_id
    JOIN public.users u ON u.id=m.user_id
    WHERE m.school_id=p_school
      AND m.user_id=(SELECT auth.uid())
      AND m.status='active'
      AND s.status='active'
      AND u.status='active'
      AND rp.permission_code=p_perm
  );
$function$;

DO $role_separation_verify$
BEGIN
 IF EXISTS(SELECT 1 FROM public.role_permissions
   WHERE role_code='site_admin' AND permission_code LIKE 'school.%') THEN
   RAISE EXCEPTION 'Site administrator inherited school privileges';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.role_permissions
   WHERE role_code='site_admin' AND permission_code='system.manage_schools')
 OR NOT EXISTS(SELECT 1 FROM public.role_permissions
   WHERE role_code='site_admin' AND permission_code='system.manage_users')
 OR NOT EXISTS(SELECT 1 FROM public.role_permissions
   WHERE role_code='site_admin' AND permission_code='system.manage_roles') THEN
   RAISE EXCEPTION 'Site administrator central privileges were lost';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.role_permissions
   WHERE role_code='school_principal' AND permission_code='school.manage_reviews')
 OR NOT EXISTS(SELECT 1 FROM public.role_permissions
   WHERE role_code='school_principal' AND permission_code='school.publish_reviews') THEN
   RAISE EXCEPTION 'Principal school permissions were lost';
 END IF;
 IF EXISTS(SELECT 1 FROM public.role_permissions rp
   WHERE rp.role_code='site_admin' AND rp.permission_code LIKE 'self.%') THEN
   RAISE NOTICE 'Site administrator still has self.* permissions; assess separately';
 END IF;
END;
$role_separation_verify$;
COMMIT;
