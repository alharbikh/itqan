
create index if not exists school_employees_academic_year_idx on public.school_employees(academic_year_id);
-- A school employee may return during the same academic year after an interruption.
alter table public.school_employees drop constraint if exists school_employees_employee_id_school_id_academic_year_id_key;
create index if not exists school_employees_employee_school_year_idx on public.school_employees(employee_id,school_id,academic_year_id);
comment on table public.school_memberships is 'Authentication/authorization membership; do not use as historical employment record';
comment on table public.school_employees is 'Historical work placement across schools and academic years. One employee may have multiple placements.';
comment on table public.employee_school_jobs is 'Professional duties and job titles; independent of security roles';
comment on table public.employees is 'Professional identity independent of an auth.users account; personal fields require scoped server-side access';

