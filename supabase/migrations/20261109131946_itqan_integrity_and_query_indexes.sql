
create index if not exists evidence_assignments_assigned_by_idx on public.evidence_assignments(assigned_by);
create index if not exists evidence_assignments_assignee_idx on public.evidence_assignments(user_id);
create index if not exists evidence_records_assignment_idx on public.evidence_records(assignment_id);
create index if not exists evidence_records_portfolio_idx on public.evidence_records(portfolio_id);
create index if not exists evidence_records_school_idx on public.evidence_records(school_id);
create index if not exists evidence_records_template_idx on public.evidence_records(template_id);
create index if not exists evidence_templates_created_by_idx on public.evidence_templates(created_by);
create index if not exists performance_reviews_reviewer_idx on public.performance_reviews(reviewer_user_id);
create index if not exists performance_reviews_self_eval_idx on public.performance_reviews(self_evaluation_id);
create index if not exists portfolio_records_school_idx on public.portfolio_records(school_id);
create index if not exists role_permissions_permission_idx on public.role_permissions(permission_code);
create index if not exists school_memberships_access_role_idx on public.school_memberships(access_role);
create index if not exists self_evaluations_user_idx on public.self_evaluations(user_id);
create index if not exists user_roles_role_idx on public.user_roles(role_code);

drop policy review_insert on public.performance_reviews;
create policy review_insert on public.performance_reviews for insert to authenticated with check (
 reviewer_user_id=(select auth.uid()) and status='draft' and not visible_to_employee
 and published_at is null
 and (select itqan_private.has_school_permission(school_id,'school.manage_reviews'))
 and exists (
  select 1 from public.school_memberships m
  where m.school_id=performance_reviews.school_id
    and m.user_id=performance_reviews.subject_user_id and m.status='active'
 )
 and (self_evaluation_id is null or exists (
  select 1 from public.self_evaluations se
  where se.id=performance_reviews.self_evaluation_id
    and se.school_id=performance_reviews.school_id
    and se.user_id=performance_reviews.subject_user_id
 ))
);

drop policy evidence_insert on public.evidence_records;
create policy evidence_insert on public.evidence_records for insert to authenticated with check (
 user_id=(select auth.uid()) and (select itqan_private.has_school_permission(school_id,'self.manage_portfolio'))
 and exists (
  select 1 from public.portfolio_records p where p.id=evidence_records.portfolio_id
   and p.user_id=evidence_records.user_id and p.school_id=evidence_records.school_id and p.status='draft'
 )
 and (assignment_id is null or exists (
  select 1 from public.evidence_assignments a
  join public.school_memberships m on m.school_id=a.school_id and m.user_id=(select auth.uid())
  where a.id=evidence_records.assignment_id and a.school_id=evidence_records.school_id
   and a.active and m.status='active'
   and (a.user_id=(select auth.uid()) or (a.user_id is null and (a.job_role is null or a.job_role=m.job_role)))
   and (evidence_records.template_id is null or a.template_id=evidence_records.template_id)
 ))
 and (template_id is null or exists (
  select 1 from public.evidence_assignments a
  join public.school_memberships m on m.school_id=a.school_id and m.user_id=(select auth.uid())
  where a.template_id=evidence_records.template_id
   and a.school_id=evidence_records.school_id and a.active and m.status='active'
   and (a.user_id=(select auth.uid()) or (a.user_id is null and (a.job_role is null or a.job_role=m.job_role)))
 ))
);
