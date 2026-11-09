-- Site administrator school provisioning. Never grant a browser the ability to assign memberships or system roles.
-- All writes run as the authenticated user's JWT and remain subject to RLS.
grant insert (name,education_stage,gender,education_department,ministry_number)
  on table public.schools to authenticated;
grant update (education_department,ministry_number) on table public.schools to authenticated;

create policy schools_create_site_admin on public.schools
  for insert to authenticated
  with check ((select itqan_private.has_system_permission('system.manage_schools')));

create policy schools_update_site_admin on public.schools
  for update to authenticated
  using ((select itqan_private.has_system_permission('system.manage_schools')))
  with check ((select itqan_private.has_system_permission('system.manage_schools')));
