-- ITQAN #12 — Phase P1 (expand only).
-- The legacy tables, RPC functions and one-active-membership index are preserved.
-- Apply only after separate review, backup and isolated automated tests.
-- This migration does not create or approve personnel records, nor backfill memberships.

create table public.school_personnel_profiles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  employee_number text not null,
  full_name_snapshot text not null,
  job_title_id uuid references public.job_titles(id) on delete restrict,
  specialization text,
  started_on date,
  ended_on date,
  status text not null default 'active' check (status in ('active', 'historical')),
  source_profile_id uuid references public.school_personnel_profiles(id) on delete restrict,
  created_by uuid not null references public.users(id) on delete restrict,
  approved_by uuid not null references public.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_personnel_profile_number_not_blank
    check (length(employee_number) between 1 and 80 and employee_number = btrim(employee_number)),
  constraint school_personnel_profile_name_valid
    check (length(btrim(full_name_snapshot)) between 2 and 200),
  constraint school_personnel_profile_dates_valid
    check (started_on is null or ended_on is null or ended_on >= started_on),
  constraint school_personnel_profile_historical_end
    check (status <> 'historical' or ended_on is not null),
  constraint school_personnel_profile_source_not_self
    check (source_profile_id is null or source_profile_id <> id),
  constraint school_personnel_profiles_id_school_unique unique (id, school_id),
  constraint school_personnel_profiles_id_school_employee_unique unique (id, school_id, employee_id),
  constraint school_personnel_profiles_school_number_unique unique (school_id, employee_number),
  constraint school_personnel_profiles_school_employee_unique unique (school_id, employee_id)
);
create index school_personnel_profiles_school_status_idx
  on public.school_personnel_profiles(school_id, status, created_at desc);
create index school_personnel_profiles_employee_idx
  on public.school_personnel_profiles(employee_id);

-- A pre-personnel application is independent of the old link-request table.
create table public.school_personnel_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  request_type text not null default 'create_or_link'
    check (request_type in ('create_or_link')),
  submitted_data jsonb not null,
  matched_profile_id uuid,
  approved_profile_id uuid,
  status text not null default 'pending'
    check (status in ('draft', 'pending', 'under_review', 'changes_requested',
                     'approved', 'rejected', 'cancelled')),
  review_started_at timestamptz,
  reviewed_by uuid references public.users(id) on delete restrict,
  decision_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_personnel_request_data_object check (jsonb_typeof(submitted_data)='object'),
  constraint school_personnel_request_decision_consistency check (
    (status = 'approved' and approved_profile_id is not null and
      reviewed_by is not null and decision_at is not null)
    or (status = 'rejected' and decision_at is not null and reviewed_by is not null)\n    or (status = 'cancelled' and approved_profile_id is null)
    or (status not in ('approved','rejected','cancelled') and
      approved_profile_id is null and decision_at is null)
  ),
  constraint school_personnel_requests_match_school_fk
    foreign key (matched_profile_id,school_id)
    references public.school_personnel_profiles(id,school_id) on delete restrict,
  constraint school_personnel_requests_approved_school_fk
    foreign key (approved_profile_id,school_id)
    references public.school_personnel_profiles(id,school_id) on delete restrict
);
create unique index school_personnel_requests_one_open_per_user_school
  on public.school_personnel_requests(user_id,school_id)
  where status in ('draft','pending','under_review','changes_requested');
create index school_personnel_requests_school_status
  on public.school_personnel_requests(school_id,status,created_at desc);

-- Copy/transfer is a separately authorised operation, NOT a membership transfer.
create table public.school_profile_operations (
  id uuid primary key default gen_random_uuid(),
  operation_type text not null check (operation_type in ('copy','transfer')),
  source_profile_id uuid not null,
  source_school_id uuid not null references public.schools(id) on delete restrict,
  target_school_id uuid not null references public.schools(id) on delete restrict,
  target_profile_id uuid,
  selected_fields jsonb not null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled','completed','failed')),
  requested_by uuid not null references public.users(id) on delete restrict,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_profile_operations_different_schools check (source_school_id <> target_school_id),
  constraint school_profile_operations_field_list check (
    jsonb_typeof(selected_fields) = 'array' and jsonb_array_length(selected_fields) between 1 and 30
  ),
  constraint school_profile_operations_source_fk
    foreign key (source_profile_id,source_school_id)
    references public.school_personnel_profiles(id,school_id) on delete restrict,
  constraint school_profile_operations_target_fk
    foreign key (target_profile_id,target_school_id)
    references public.school_personnel_profiles(id,school_id) on delete restrict,
  constraint school_profile_operations_completed_consistency check (
    (status = 'completed' and target_profile_id is not null and executed_at is not null)
    or status <> 'completed'
  )
);
create index school_profile_operations_target_idx
  on public.school_profile_operations(target_school_id,status,created_at desc);
create index school_profile_operations_source_idx
  on public.school_profile_operations(source_school_id,status,created_at desc);

create table public.school_profile_operation_approvals (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.school_profile_operations(id) on delete restrict,
  approval_type text not null check (approval_type in ('subject','source_school_owner')),
  approver_user_id uuid not null references public.users(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected')),
  approved_fields jsonb not null,
  consent_version integer not null default 1 check (consent_version >= 1),
  decided_at timestamptz not null default now(),
  constraint school_profile_operation_approvals_fields_list check (
    jsonb_typeof(approved_fields) = 'array'
  ),
  constraint school_profile_operation_approvals_unique_type unique (operation_id,approval_type)
);
create index school_profile_operation_approvals_actor_idx
  on public.school_profile_operation_approvals(approver_user_id,decided_at desc);

-- Optional links preserve the three existing active memberships and legacy APIs.
alter table public.school_employees
  add column personnel_profile_id uuid;
alter table public.school_employees
  add constraint school_employees_personnel_profile_school_employee_fk
    foreign key (personnel_profile_id,school_id,employee_id)
    references public.school_personnel_profiles(id,school_id,employee_id) on delete restrict;
create index school_employees_personnel_profile_idx
  on public.school_employees(personnel_profile_id);

alter table public.school_memberships
  add column personnel_profile_id uuid;
alter table public.school_memberships
  add constraint school_memberships_personnel_profile_school_fk
    foreign key (personnel_profile_id,school_id)
    references public.school_personnel_profiles(id,school_id) on delete restrict;
create index school_memberships_personnel_profile_idx
  on public.school_memberships(personnel_profile_id);

-- Explicit default-deny. Later RPCs must enforce authorization and consent
-- before granting narrowly scoped access to these new tables.
alter table public.school_personnel_profiles enable row level security;
alter table public.school_personnel_requests enable row level security;
alter table public.school_profile_operations enable row level security;
alter table public.school_profile_operation_approvals enable row level security;
revoke all on public.school_personnel_profiles,
  public.school_personnel_requests, public.school_profile_operations,
  public.school_profile_operation_approvals from public, anon, authenticated;

comment on table public.school_personnel_profiles is
 'ITQAN #12: permanent school-owned personnel identity; employee_number unique within school.';
comment on table public.school_personnel_requests is
 'ITQAN #12: pending initial self-service requests; no membership is created by submission.';
comment on table public.school_profile_operations is
 'ITQAN #12: approved field-scoped copy/transfer requiring subject and source-owner consent.';
comment on table public.school_profile_operation_approvals is
 'ITQAN #12: consent decisions for copy/transfer; authorisation enforced by privileged RPC.';
