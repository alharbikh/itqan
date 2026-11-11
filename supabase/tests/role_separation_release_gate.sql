-- Post-migration release gate, read-only and safe for isolated CI or production.
-- Must be executed only AFTER all four pending security migrations were applied.
-- If a new migration has been added after this plan, amend this release gate
-- in a reviewed commit rather than forcing an obsolete baseline into production.
DO $role_separation_release_gate$
DECLARE
  version_id text;
BEGIN
  FOREACH version_id IN ARRAY ARRAY[
    '20261111133000',
    '20261111134500',
    '20261111135500',
    '20261111141500'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations
      WHERE version=version_id
    ) THEN
      RAISE EXCEPTION 'Required ordered security migration % not present',version_id;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>45 THEN
    RAISE EXCEPTION 'Unexpected migration count after role separation; re-check release sequence';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_code='site_admin' AND permission_code LIKE 'school.%'
  ) THEN
    RAISE EXCEPTION 'Central site administrator still inherits school permissions';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_code='site_admin' AND permission_code='system.manage_schools'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_code='site_admin' AND permission_code='system.manage_users'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_code='site_admin' AND permission_code='system.manage_roles'
  ) THEN
    RAISE EXCEPTION 'A central site administrator privilege was lost';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_code='school_principal' AND permission_code='school.manage_reviews'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_code='school_principal' AND permission_code='school.publish_reviews'
  ) THEN
    RAISE EXCEPTION 'School principal permissions were lost';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public' AND grantee IN ('anon','authenticated')
      AND privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES')
  ) THEN
    RAISE EXCEPTION 'Previously revoked unsafe table privileges were restored';
  END IF;
END;
$role_separation_release_gate$;

SELECT
  (SELECT count(*) FROM supabase_migrations.schema_migrations) AS migration_count,
  (SELECT count(*) FROM public.role_permissions WHERE role_code='site_admin'
      AND permission_code LIKE 'school.%') AS inherited_school_grants,
  (SELECT count(*) FROM public.role_permissions WHERE role_code='site_admin'
      AND permission_code LIKE 'system.%') AS central_system_grants,
  (SELECT count(*) FROM public.role_permissions WHERE role_code='school_principal'
      AND permission_code LIKE 'school.%') AS school_principal_grants;
