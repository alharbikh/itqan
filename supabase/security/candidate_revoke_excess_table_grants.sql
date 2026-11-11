-- Proposed least-privilege change for disposable-database validation only.
-- Not a production migration. An approved, CLI-generated migration is needed
-- after impact review before applying changes to a live Supabase project.
--
-- TRUNCATE is outside PostgreSQL row-level security. Browser API roles never
-- need TRUNCATE, TRIGGER creation, or REFERENCES on application tables.
-- SECURITY DEFINER RPCs still run with their owner's privileges.
BEGIN;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public
  FROM authenticated, anon;
COMMIT;
