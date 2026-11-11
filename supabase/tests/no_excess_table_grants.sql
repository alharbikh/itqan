-- Validate that application roles cannot execute RLS-bypassing table operations.
-- Run only after candidate_revoke_excess_table_grants.sql in isolated CI.
DO $$
DECLARE
  role_name text;
  privilege text;
  excess_count integer;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH privilege IN ARRAY ARRAY['TRUNCATE','TRIGGER','REFERENCES'] LOOP
      SELECT count(*) INTO excess_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
        AND has_table_privilege(role_name,c.oid,privilege);
      IF excess_count <> 0 THEN
        RAISE EXCEPTION 'Role % retains % on % public tables',role_name,privilege,excess_count;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- Confirm removing unsafe grants does not accidentally remove existing
-- legitimate application DML privileges. RLS still controls which rows.
DO $
DECLARE role_name text;
BEGIN
  IF NOT has_table_privilege('authenticated','public.schools','SELECT')
    OR NOT has_table_privilege('authenticated','public.school_memberships','SELECT')
    OR NOT has_table_privilege('authenticated','public.users','SELECT') THEN
    RAISE EXCEPTION 'Essential authenticated catalog read grant was lost';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
    IF NOT has_table_privilege('authenticated','public.personal_evidence',role_name)
      OR NOT has_table_privilege('authenticated','public.personal_evidence_attachments',role_name) THEN
      RAISE EXCEPTION 'Essential evidence operation privilege % was lost',role_name;
    END IF;
  END LOOP;
END;
$$;
