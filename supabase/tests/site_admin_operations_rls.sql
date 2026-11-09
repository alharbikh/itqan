-- Authorization denial for non-site-admin users; no persistent records.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='site_admin_audit' AND policyname='site_admin_audit_read') THEN
    RAISE EXCEPTION 'Admin audit policy missing';
  END IF;
  IF has_table_privilege('anon','public.site_admin_audit','SELECT')
     OR has_table_privilege('authenticated','public.site_admin_audit','INSERT') THEN
    RAISE EXCEPTION 'Audit data improperly exposed';
  END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
DO $$
DECLARE denied boolean;
BEGIN
  denied := false;
  BEGIN
    PERFORM public.itqan_admin_delete_empty_school('44444444-4444-4444-8444-444444444444');
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Non-admin allowed to delete school'; END IF;
  denied := false;
  BEGIN
    PERFORM public.itqan_admin_manage_membership('44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555','school_principal','principal','active');
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Non-admin allowed to assign a principal'; END IF;
  denied := false;
  BEGIN
    PERFORM public.itqan_admin_set_user_status('55555555-5555-4555-8555-555555555555','inactive');
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Non-admin allowed to change user status'; END IF;
END $$;
ROLLBACK;
