-- ITQAN #12: extend strict audit allowlists with the newly approved personnel actions.
-- Existing site administration actions remain valid and unchanged.
alter table public.site_admin_audit
 drop constraint site_admin_audit_operation_check,
 add constraint site_admin_audit_operation_check check (operation in (
  'school.create','school.update','school.delete','school.status',
  'membership.upsert','user.status','user.role.grant','user.role.revoke',
  'user.password.temporary_attempt','user.password.recovery_email',
  'personnel.request.created','personnel.request.updated',
  'personnel.request.status_changed','personnel.request.approved',
  'personnel.identity.reveal','personnel.operation.consent','personnel.operation.completed'
 ));
alter table public.site_admin_audit
 drop constraint site_admin_audit_target_type_check,
 add constraint site_admin_audit_target_type_check check (target_type in (
  'school','membership','user',
  'personnel_request','personnel_profile','personnel_operation'
 ));
