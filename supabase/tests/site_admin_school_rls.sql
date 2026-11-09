-- Run in a disposable Supabase instance only, after all migrations.
-- Verify RLS guards school writes; the single attempted record is rolled back.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='schools'
      AND policyname='schools_create_site_admin' AND cmd='INSERT'
  ) THEN RAISE EXCEPTION 'Missing site-admin-only school creation policy'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='schools'
      AND policyname='schools_update_site_admin' AND cmd='UPDATE'
  ) THEN RAISE EXCEPTION 'Missing site-admin school edit policy'; END IF;

  IF NOT has_column_privilege('authenticated','public.schools','name','INSERT') THEN
    RAISE EXCEPTION 'Authenticated user should have column grant constrained by RLS';
  END IF;
  IF has_column_privilege('anon','public.schools','name','INSERT') THEN
    RAISE EXCEPTION 'Anonymous users must not have school create grant';
  END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.schools (name) VALUES ('Isolated RLS probe');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'An unauthorised authenticated user inserted a school';
  END IF;
END $$;
ROLLBACK;
