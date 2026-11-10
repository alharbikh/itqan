-- Permit password-recovery audit events without altering historical audit records.
-- Applied to Supabase project itqan on 2026-11-10.
ALTER TABLE public.site_admin_audit
  DROP CONSTRAINT site_admin_audit_operation_check;
ALTER TABLE public.site_admin_audit
  ADD CONSTRAINT site_admin_audit_operation_check
  CHECK (operation = ANY (ARRAY[
    'school.create', 'school.update', 'school.delete', 'school.status',
    'membership.upsert', 'user.status', 'user.role.grant', 'user.role.revoke',
    'user.password.temporary_attempt', 'user.password.recovery_email'
  ]));
