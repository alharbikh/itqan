-- ITQAN SMART PRO — least-privilege grants for browser API roles.
-- Issue #24. No table data, RLS policy, or SECURITY DEFINER function is changed.
--
-- PostgreSQL TRUNCATE bypasses RLS. Neither anon nor authenticated requires
-- TRUNCATE, TRIGGER or REFERENCES on the application's public tables.
-- Read/write operations still use explicit SELECT/INSERT/UPDATE/DELETE grants,
-- the application's RLS policies and permission-checking RPCs.
--
-- Verified with the disposable Supabase schema and complete workflow tests
-- before permitting this change to reach production.
BEGIN;

REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

DO $itqan_least_privilege_verify$
DECLARE
  role_name text;
  privilege_name text;
  remaining integer;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH privilege_name IN ARRAY ARRAY['TRUNCATE','TRIGGER','REFERENCES'] LOOP
      SELECT count(*) INTO remaining
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
        AND has_table_privilege(role_name,c.oid,privilege_name);
      IF remaining <> 0 THEN
        RAISE EXCEPTION 'Unauthorized table privilege still granted: role %, privilege %, tables %',
          role_name,privilege_name,remaining;
      END IF;
    END LOOP;
  END LOOP;
END;
$itqan_least_privilege_verify$;

COMMIT;
