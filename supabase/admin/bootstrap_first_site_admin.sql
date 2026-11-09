-- Issue #2 / P1: one-time trusted bootstrap for the first site administrator.
-- Execute ONLY via privileged psql against the intended Itqan project after
-- verifying the confirmed owner identity. NEVER invoke from the browser.
-- Usage: psql -X -v ON_ERROR_STOP=1 -v admin_email='verified@example.com' -f supabase/admin/bootstrap_first_site_admin.sql
\set ON_ERROR_STOP on
\if :{?admin_email}
\else
  \echo 'Missing required admin_email psql variable'
  SELECT 1/0; -- Explicitly fail under ON_ERROR_STOP before BEGIN, rather than silently quitting
\endif
BEGIN;
-- Serialize concurrent bootstrap attempts so only one privileged account can be created.
SELECT pg_advisory_xact_lock(hashtext('itqan:first-site-admin'));
SELECT set_config('itqan.bootstrap_admin_email', :'admin_email', true);
DO $itqan_bootstrap$
DECLARE
  admin_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role_code='site_admin') THEN
    RAISE EXCEPTION 'A site administrator already exists; no bootstrap operation allowed';
  END IF;
  SELECT a.id INTO admin_id
  FROM auth.users a
  JOIN public.users u ON u.id=a.id
  WHERE lower(a.email)=lower(current_setting('itqan.bootstrap_admin_email'))
    AND a.email_confirmed_at IS NOT NULL
    AND u.status='active';
  IF admin_id IS NULL THEN
    RAISE EXCEPTION 'Verified, active Auth user does not exist';
  END IF;
  INSERT INTO public.user_roles(user_id,role_code) VALUES (admin_id,'site_admin');
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=admin_id AND role_code='site_admin') THEN
    RAISE EXCEPTION 'Site-admin bootstrap verification failed';
  END IF;
END
$itqan_bootstrap$;
COMMIT;
\echo 'First site admin was bootstrapped through a privileged database connection.'
