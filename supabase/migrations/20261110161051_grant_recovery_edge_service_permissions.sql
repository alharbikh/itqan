-- Least-privilege table grants required by Itqan's Supabase Edge recovery service.
-- Service-role API keys bypass RLS but must still hold table privileges.
GRANT SELECT ON TABLE public.users TO service_role;
GRANT SELECT ON TABLE public.user_roles TO service_role;
GRANT INSERT ON TABLE public.site_admin_audit TO service_role;
