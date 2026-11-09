
create schema if not exists itqan_private;
revoke all on schema itqan_private from public, anon;
grant usage on schema itqan_private to authenticated;

create function itqan_private.has_system_permission(p_perm text)
returns boolean language sql stable security definer set search_path = ''
as $$
 select (select auth.uid()) is not null and exists (
 select 1 from public.user_roles ur
 join public.role_permissions rp on rp.role_code=ur.role_code
 join public.users u on u.id=ur.user_id
 where ur.user_id=(select auth.uid()) and u.status='active'
   and rp.permission_code=p_perm
 );
$$;
create function itqan_private.has_school_permission(p_school uuid,p_perm text)
returns boolean language sql stable security definer set search_path = ''
as $$
 select (select auth.uid()) is not null and (
  (select itqan_private.has_system_permission(p_perm))
  or exists (
    select 1 from public.school_memberships m
    join public.role_permissions rp on rp.role_code=m.access_role
    join public.schools s on s.id=m.school_id
    join public.users u on u.id=m.user_id
    where m.school_id=p_school and m.user_id=(select auth.uid())
      and m.status='active' and s.status='active' and u.status='active'
      and rp.permission_code=p_perm
  )
 );
$$;
revoke all on function itqan_private.has_system_permission(text) from public,anon;
revoke all on function itqan_private.has_school_permission(uuid,text) from public,anon;
grant execute on function itqan_private.has_system_permission(text) to authenticated;
grant execute on function itqan_private.has_school_permission(uuid,text) to authenticated;

-- Remove initial narrow policies and replace with role and school aware rules.
drop policy if exists profiles_read_self on public.users;
drop policy if exists memberships_read_self on public.school_memberships;
drop policy if exists schools_read_member on public.schools;
drop policy if exists reviews_read_subject on public.performance_reviews;
drop policy if exists portfolio_read_own on public.portfolio_records;
drop policy if exists portfolio_insert_own on public.portfolio_records;
drop policy if exists portfolio_update_own on public.portfolio_records;
drop policy if exists portfolio_delete_own on public.portfolio_records;
drop policy if exists evidence_read_own on public.evidence_records;
drop policy if exists evidence_insert_own on public.evidence_records;
drop policy if exists evidence_delete_own on public.evidence_records;

-- Authorization catalogs: readable only to signed-in users.
grant select on public.roles,public.permissions,public.role_permissions,public.user_roles to authenticated;
create policy roles_read on public.roles for select to authenticated using (true);
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
create policy user_roles_read on public.user_roles for select to authenticated
 using (user_id=(select auth.uid()) or (select itqan_private.has_system_permission('system.manage_roles')));

-- Users may read their own record; principals can read employees of their own school.
grant select on public.users to authenticated;
create policy users_read_authorized on public.users for select to authenticated using (
 id=(select auth.uid())
 or (select itqan_private.has_system_permission('system.manage_users'))
 or exists (
  select 1 from public.school_memberships m
  where m.user_id=users.id and m.status='active'
    and (select itqan_private.has_school_permission(m.school_id,'school.manage_members'))
 )
);

create policy schools_read_authorized on public.schools for select to authenticated using (
 (select itqan_private.has_system_permission('system.manage_schools'))
 or (select itqan_private.has_school_permission(id,'school.view'))
);
grant update (name, education_stage, gender) on public.schools to authenticated;
create policy schools_edit_principal on public.schools for update to authenticated
 using ((select itqan_private.has_school_permission(id,'school.edit')))
 with check ((select itqan_private.has_school_permission(id,'school.edit')));

create policy membership_read_authorized on public.school_memberships for select to authenticated using (
 user_id=(select auth.uid())
 or (select itqan_private.has_school_permission(school_id,'school.manage_members'))
);
-- Nobody can assign themselves a role, a school or a different identity through public API.

-- Employee self-evaluations.
grant select,insert on public.self_evaluations to authenticated;
grant update (criteria_scores,notes,status,submitted_at,updated_at) on public.self_evaluations to authenticated;
create policy self_eval_read on public.self_evaluations for select to authenticated using (
 (user_id=(select auth.uid()) and (select itqan_private.has_school_permission(school_id,'self.submit_self_evaluation')))
 or (status='submitted' and (select itqan_private.has_school_permission(school_id,'school.view_self_evaluations')))
);
create policy self_eval_insert on public.self_evaluations for insert to authenticated with check (
 user_id=(select auth.uid()) and status='draft' and submitted_at is null
 and (select itqan_private.has_school_permission(school_id,'self.submit_self_evaluation'))
);
create policy self_eval_update on public.self_evaluations for update to authenticated
 using (
  user_id=(select auth.uid()) and status='draft'
  and (select itqan_private.has_school_permission(school_id,'self.submit_self_evaluation'))
 )
 with check (
  user_id=(select auth.uid()) and (
   (status='draft' and submitted_at is null)
   or (status='submitted' and submitted_at is not null)
  )
  and (select itqan_private.has_school_permission(school_id,'self.submit_self_evaluation'))
 );

-- School-manager reviews; employees only see approved and explicitly released results.
grant select,insert on public.performance_reviews to authenticated;
grant update (criteria_scores,status,notes,visible_to_employee,published_at,updated_at)
 on public.performance_reviews to authenticated;
create policy review_read on public.performance_reviews for select to authenticated using (
 (select itqan_private.has_school_permission(school_id,'school.manage_reviews'))
 or (
  subject_user_id=(select auth.uid()) and status='approved'
  and visible_to_employee and published_at is not null
  and (select itqan_private.has_school_permission(school_id,'self.view_published_review'))
 )
);
create policy review_insert on public.performance_reviews for insert to authenticated with check (
 reviewer_user_id=(select auth.uid()) and status='draft' and not visible_to_employee
 and published_at is null
 and (select itqan_private.has_school_permission(school_id,'school.manage_reviews'))
 and exists (
  select 1 from public.school_memberships m
  where m.school_id=performance_reviews.school_id
    and m.user_id=performance_reviews.subject_user_id and m.status='active'
 )
);
create policy review_update on public.performance_reviews for update to authenticated
 using ((select itqan_private.has_school_permission(school_id,'school.manage_reviews')))
 with check (
  (select itqan_private.has_school_permission(school_id,'school.manage_reviews'))
  and (
    (not visible_to_employee and published_at is null)
    or (status='approved' and visible_to_employee and published_at is not null
       and (select itqan_private.has_school_permission(school_id,'school.publish_reviews')))
  )
 );

create policy portfolio_read on public.portfolio_records for select to authenticated using (
 (user_id=(select auth.uid()) and (select itqan_private.has_school_permission(school_id,'self.manage_portfolio')))
 or (select itqan_private.has_school_permission(school_id,'school.view_portfolios'))
);
create policy portfolio_insert on public.portfolio_records for insert to authenticated with check (
 user_id=(select auth.uid()) and status='draft'
 and (select itqan_private.has_school_permission(school_id,'self.manage_portfolio'))
);
create policy portfolio_update on public.portfolio_records for update to authenticated
 using (
  user_id=(select auth.uid()) and status='draft'
  and (select itqan_private.has_school_permission(school_id,'self.manage_portfolio'))
 )
 with check (
  user_id=(select auth.uid()) and status='draft'
  and (select itqan_private.has_school_permission(school_id,'self.manage_portfolio'))
 );
create policy portfolio_delete on public.portfolio_records for delete to authenticated using (
 user_id=(select auth.uid()) and status='draft'
 and (select itqan_private.has_school_permission(school_id,'self.manage_portfolio'))
);

grant select,insert,update,delete on public.evidence_templates to authenticated;
create policy evidence_templates_read on public.evidence_templates for select to authenticated using (
 (school_id is null and (select itqan_private.has_system_permission('system.manage_schools')))
 or (school_id is not null and (select itqan_private.has_school_permission(school_id,'school.manage_evidence_templates')))
 or exists (
  select 1 from public.evidence_assignments a
  join public.school_memberships m on m.school_id=a.school_id and m.user_id=(select auth.uid())
  where a.template_id=evidence_templates.id and a.active and m.status='active'
   and (a.user_id=(select auth.uid()) or
       (a.user_id is null and (a.job_role is null or a.job_role=m.job_role)))
   and (select itqan_private.has_school_permission(m.school_id,'school.view'))
 )
);
create policy evidence_templates_insert on public.evidence_templates for insert to authenticated with check (
 created_by=(select auth.uid()) and (
 (school_id is null and (select itqan_private.has_system_permission('system.manage_schools')))
 or (school_id is not null and (select itqan_private.has_school_permission(school_id,'school.manage_evidence_templates')))
 ));
create policy evidence_templates_update on public.evidence_templates for update to authenticated
 using (
 (school_id is null and (select itqan_private.has_system_permission('system.manage_schools')))
 or (school_id is not null and (select itqan_private.has_school_permission(school_id,'school.manage_evidence_templates')))
 )
 with check (
 (school_id is null and (select itqan_private.has_system_permission('system.manage_schools')))
 or (school_id is not null and (select itqan_private.has_school_permission(school_id,'school.manage_evidence_templates')))
 );
create policy evidence_templates_delete on public.evidence_templates for delete to authenticated using (
 (school_id is null and (select itqan_private.has_system_permission('system.manage_schools')))
 or (school_id is not null and (select itqan_private.has_school_permission(school_id,'school.manage_evidence_templates')))
);

grant select,insert,update,delete on public.evidence_assignments to authenticated;
create policy assignments_read on public.evidence_assignments for select to authenticated using (
 (select itqan_private.has_school_permission(school_id,'school.assign_evidence'))
 or exists (
  select 1 from public.school_memberships m
  where m.school_id=evidence_assignments.school_id
   and m.user_id=(select auth.uid()) and m.status='active'
   and active and (user_id=(select auth.uid()) or
   (user_id is null and (job_role is null or job_role=m.job_role)))
   and (select itqan_private.has_school_permission(school_id,'school.view'))
 )
);
create policy assignments_insert on public.evidence_assignments for insert to authenticated with check (
 assigned_by=(select auth.uid()) and (select itqan_private.has_school_permission(school_id,'school.assign_evidence'))
 and exists (
  select 1 from public.evidence_templates t where t.id=template_id
   and (t.school_id is null or t.school_id=evidence_assignments.school_id)
 )
 and (user_id is null or exists(
  select 1 from public.school_memberships m where m.user_id=evidence_assignments.user_id
   and m.school_id=evidence_assignments.school_id and m.status='active'
 ))
);
create policy assignments_update on public.evidence_assignments for update to authenticated
 using ((select itqan_private.has_school_permission(school_id,'school.assign_evidence')))
 with check (
 (select itqan_private.has_school_permission(school_id,'school.assign_evidence'))
 and exists (
  select 1 from public.evidence_templates t where t.id=template_id
   and (t.school_id is null or t.school_id=evidence_assignments.school_id)
 )
 and (user_id is null or exists(
  select 1 from public.school_memberships m where m.user_id=evidence_assignments.user_id
   and m.school_id=evidence_assignments.school_id and m.status='active'
 ))
);
create policy assignments_delete on public.evidence_assignments for delete to authenticated
 using ((select itqan_private.has_school_permission(school_id,'school.assign_evidence')));

create policy evidence_read on public.evidence_records for select to authenticated using (
 (user_id=(select auth.uid()) and (select itqan_private.has_school_permission(school_id,'self.manage_portfolio')))
 or (select itqan_private.has_school_permission(school_id,'school.view_portfolios'))
);
create policy evidence_insert on public.evidence_records for insert to authenticated with check (
 user_id=(select auth.uid()) and (select itqan_private.has_school_permission(school_id,'self.manage_portfolio'))
 and exists (
  select 1 from public.portfolio_records p where p.id=evidence_records.portfolio_id
   and p.user_id=evidence_records.user_id and p.school_id=evidence_records.school_id and p.status='draft'
 )
 and (template_id is null or exists (
  select 1 from public.evidence_assignments a
  join public.school_memberships m on m.school_id=a.school_id and m.user_id=(select auth.uid())
  where a.template_id=evidence_records.template_id
   and a.school_id=evidence_records.school_id and a.active and m.status='active'
   and (a.user_id=(select auth.uid()) or (a.user_id is null and (a.job_role is null or a.job_role=m.job_role)))
 ))
);
create policy evidence_delete on public.evidence_records for delete to authenticated using (
 user_id=(select auth.uid()) and (select itqan_private.has_school_permission(school_id,'self.manage_portfolio'))
 and exists (
  select 1 from public.portfolio_records p where p.id=evidence_records.portfolio_id
   and p.user_id=(select auth.uid()) and p.status='draft'
 )
);
