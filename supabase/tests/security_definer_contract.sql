-- Static contract for privileged, REST-exposed functions.
-- This is defense-in-depth only; a textual auth.uid() check cannot prove
-- authorization correctness. Existing behavior is covered by workflow tests.
DO $itqan_definer_contract$
DECLARE
  anon_callable integer;
  missing_identity integer;
  missing_search_path integer;
BEGIN
  SELECT count(*) INTO anon_callable
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND has_function_privilege('anon',p.oid,'EXECUTE');
  IF anon_callable > 0 THEN
    RAISE EXCEPTION '% privileged functions are callable by anon',anon_callable;
  END IF;

  SELECT count(*) INTO missing_identity
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND pg_get_functiondef(p.oid) NOT ILIKE '%auth.uid%';
  IF missing_identity > 0 THEN
    RAISE EXCEPTION '% authenticated SECURITY DEFINER functions lack auth.uid() reference',
      missing_identity;
  END IF;

  SELECT count(*) INTO missing_search_path
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND NOT EXISTS (
      SELECT 1 FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) AS setting
      WHERE setting LIKE 'search_path=%'
    );
  IF missing_search_path > 0 THEN
    RAISE EXCEPTION '% exposed SECURITY DEFINER functions lack explicit search_path',
      missing_search_path;
  END IF;
END;
$itqan_definer_contract$;


-- Structural defense against a still-valid token for a disabled account:
-- exposed RPCs must either check active user status directly or invoke one
-- of the centrally verified helpers that check users.status='active'.
-- Textual checks alone do NOT establish full authorization correctness.
DO $itqan_active_definer_contract$
DECLARE unguarded text;
BEGIN
 SELECT string_agg(p.proname,', ' ORDER BY p.proname) INTO unguarded
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef
  AND has_function_privilege('authenticated',p.oid,'EXECUTE')
  AND pg_get_functiondef(p.oid) NOT ILIKE '%status=''active''%'
  AND pg_get_functiondef(p.oid) NOT ILIKE '%has_school_permission%'
  AND pg_get_functiondef(p.oid) NOT ILIKE '%has_system_permission%';
 IF unguarded IS NOT NULL THEN
   RAISE EXCEPTION 'Exposed privileged functions without active user guards: %',unguarded;
 END IF;
END;
$itqan_active_definer_contract$;
