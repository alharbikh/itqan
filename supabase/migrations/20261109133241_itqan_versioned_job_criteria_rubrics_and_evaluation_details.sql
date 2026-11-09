
-- V3 reference design: job titles are distinct from authorization roles.
create table public.job_titles (
 id uuid primary key default gen_random_uuid(),
 code text not null unique,
 title_ar text not null,
 category text not null default 'employee',
 description text,
 is_managerial boolean not null default false,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 constraint job_titles_code_not_blank check(length(btrim(code))>0)
);
create table public.evaluation_criteria (
 id uuid primary key default gen_random_uuid(),
 code text not null unique,
 title_ar text not null,
 description text,
 is_common boolean not null default false,
 category text,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint criterion_code_not_blank check(length(btrim(code))>0)
);
-- Year/model version for freezing weights historically.
create table public.evaluation_frameworks (
 id uuid primary key default gen_random_uuid(),
 code text not null,
 version_no integer not null check (version_no>0),
 title_ar text not null,
 academic_year text,
 source_reference text,
 effective_from date,
 effective_to date,
 status text not null default 'draft' check (status in ('draft','active','archived')),
 published_at timestamptz,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(code,version_no),
 constraint framework_date_order check (effective_to is null or effective_from is null or effective_to>=effective_from),
 constraint framework_publication_check check (status<>'active' or published_at is not null)
);
create table public.evaluation_framework_jobs (
 framework_id uuid not null references public.evaluation_frameworks(id) on delete cascade,
 job_title_id uuid not null references public.job_titles(id) on delete restrict,
 is_active boolean not null default true,
 primary key(framework_id,job_title_id)
);
create table public.evaluation_framework_criteria (
 framework_id uuid not null,
 job_title_id uuid not null,
 criterion_id uuid not null references public.evaluation_criteria(id) on delete restrict,
 weight numeric(6,3) not null check (weight>=0 and weight<=100),
 sort_order integer not null check (sort_order>0),
 is_required boolean not null default true,
 primary key(framework_id,job_title_id,criterion_id),
 unique(framework_id,job_title_id,sort_order),
 foreign key(framework_id,job_title_id)
  references public.evaluation_framework_jobs(framework_id,job_title_id) on delete cascade
);
-- The five-level descriptors are per criterion, and may be replaced by rubric revisions in future.
create table public.criterion_rating_descriptors (
 id uuid primary key default gen_random_uuid(),
 framework_id uuid not null,
 job_title_id uuid not null,
 criterion_id uuid not null,
 score_level smallint not null check(score_level between 1 and 5),
 descriptor text not null,
 unique(framework_id,job_title_id,criterion_id,score_level),
 foreign key(framework_id,job_title_id,criterion_id)
  references public.evaluation_framework_criteria(framework_id,job_title_id,criterion_id) on delete cascade
);
-- Platform suggestions are separate from school-specific requirements.
create table public.criterion_evidence_suggestions (
 id uuid primary key default gen_random_uuid(),
 criterion_id uuid not null references public.evaluation_criteria(id) on delete cascade,
 title_ar text not null,
 description text,
 active boolean not null default true,
 sort_order integer not null default 1 check(sort_order>0)
);
create table public.evaluation_periods (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 label text not null,
 academic_year text not null,
 starts_on date not null,
 ends_on date not null,
 self_evaluation_deadline date,
 manager_review_deadline date,
 status text not null default 'draft' check(status in ('draft','open','closed')),
 created_at timestamptz not null default now(),
 constraint period_dates_check check (starts_on<=ends_on)
);
alter table public.school_memberships
 add column job_title_id uuid references public.job_titles(id) on delete restrict;
alter table public.self_evaluations
 add column framework_id uuid references public.evaluation_frameworks(id) on delete restrict,
 add column job_title_id uuid references public.job_titles(id) on delete restrict,
 add column period_id uuid references public.evaluation_periods(id) on delete set null,
 add column final_score_100 numeric(6,3) check(final_score_100 between 0 and 100);
alter table public.performance_reviews
 add column framework_id uuid references public.evaluation_frameworks(id) on delete restrict,
 add column job_title_id uuid references public.job_titles(id) on delete restrict,
 add column period_id uuid references public.evaluation_periods(id) on delete set null,
 add column final_score_100 numeric(6,3) check(final_score_100 between 0 and 100);

-- Detailed criterion scores: one parent evaluation (self or manager) only.
create table public.evaluation_score_details (
 id uuid primary key default gen_random_uuid(),
 self_evaluation_id uuid references public.self_evaluations(id) on delete cascade,
 performance_review_id uuid references public.performance_reviews(id) on delete cascade,
 framework_id uuid not null,
 job_title_id uuid not null,
 criterion_id uuid not null,
 score_level smallint not null check(score_level between 1 and 5),
 weight_snapshot numeric(6,3) not null check(weight_snapshot between 0 and 100),
 weighted_score numeric(7,3) generated always as
  (round((score_level::numeric / 5)*weight_snapshot,3)) stored,
 evaluator_notes text,
 created_at timestamptz not null default now(),
 check ((self_evaluation_id is not null) <> (performance_review_id is not null)),
 foreign key(framework_id,job_title_id,criterion_id)
  references public.evaluation_framework_criteria(framework_id,job_title_id,criterion_id) on delete restrict
);
create unique index score_detail_self_criterion on public.evaluation_score_details(self_evaluation_id,criterion_id) where self_evaluation_id is not null;
create unique index score_detail_manager_criterion on public.evaluation_score_details(performance_review_id,criterion_id) where performance_review_id is not null;
create index score_detail_framework_idx on public.evaluation_score_details(framework_id,job_title_id);

-- School-specific evidence templates can be attached to a standard criterion.
alter table public.evidence_templates
 add column criterion_id uuid references public.evaluation_criteria(id) on delete set null,
 add column suggestion_id uuid references public.criterion_evidence_suggestions(id) on delete set null;
alter table public.evidence_assignments
 add column job_title_id uuid references public.job_titles(id) on delete restrict;
-- Existing user_id/job_role mutually exclusive; job_title_id also must be exclusive.
alter table public.evidence_assignments
 add constraint evidence_assignment_target_exclusive
 check (num_nonnulls(user_id,job_role,job_title_id)<=1);

-- Placeholder metadata for future file uploads, without uploading files yet.
alter table public.evidence_records
 add column evidence_status text not null default 'pending'
  check(evidence_status in ('pending','approved','rejected','needs_changes')),
 add column link_url text,
 add column storage_bucket text,
 add column storage_path text,
 add column original_file_name text,
 add column mime_type text,
 add column file_size_bytes bigint check(file_size_bytes>=0),
 add column reviewed_by uuid references public.users(id) on delete set null,
 add column reviewed_at timestamptz,
 add column reviewer_notes text;

-- Indexes needed for common joins and history lookups.
create index on public.evaluation_framework_criteria(criterion_id);
create index on public.evaluation_framework_jobs(job_title_id);
create index on public.criterion_rating_descriptors(criterion_id);
create index on public.criterion_evidence_suggestions(criterion_id);
create index on public.school_memberships(job_title_id);
create index on public.evaluation_periods(school_id,status);
create index on public.self_evaluations(framework_id,job_title_id);
create index on public.performance_reviews(framework_id,job_title_id);
create index on public.evidence_templates(criterion_id);
create index on public.evidence_templates(suggestion_id);
create index on public.evidence_assignments(job_title_id);
create index on public.evidence_records(reviewed_by);

-- All newly exposed public tables are locked down until corresponding
-- authorization workflows and authenticated user tests are complete.
alter table public.job_titles enable row level security;
alter table public.evaluation_criteria enable row level security;
alter table public.evaluation_frameworks enable row level security;
alter table public.evaluation_framework_jobs enable row level security;
alter table public.evaluation_framework_criteria enable row level security;
alter table public.criterion_rating_descriptors enable row level security;
alter table public.criterion_evidence_suggestions enable row level security;
alter table public.evaluation_periods enable row level security;
alter table public.evaluation_score_details enable row level security;

revoke all on public.job_titles,public.evaluation_criteria,public.evaluation_frameworks,
 public.evaluation_framework_jobs,public.evaluation_framework_criteria,
 public.criterion_rating_descriptors,public.criterion_evidence_suggestions,
 public.evaluation_periods,public.evaluation_score_details from anon;
grant select on public.job_titles,public.evaluation_criteria,public.evaluation_frameworks,
 public.evaluation_framework_jobs,public.evaluation_framework_criteria,
 public.criterion_rating_descriptors,public.criterion_evidence_suggestions to authenticated;
grant select on public.evaluation_periods,public.evaluation_score_details to authenticated;

create policy job_titles_read on public.job_titles for select to authenticated using (active);
create policy criteria_read on public.evaluation_criteria for select to authenticated using (active);
create policy frameworks_read on public.evaluation_frameworks for select to authenticated using (status='active');
create policy framework_jobs_read on public.evaluation_framework_jobs for select to authenticated
 using (exists(select 1 from public.evaluation_frameworks f where f.id=framework_id and f.status='active'));
create policy framework_criteria_read on public.evaluation_framework_criteria for select to authenticated
 using (exists(select 1 from public.evaluation_frameworks f where f.id=framework_id and f.status='active'));
create policy rubric_read on public.criterion_rating_descriptors for select to authenticated
 using (exists(select 1 from public.evaluation_frameworks f where f.id=framework_id and f.status='active'));
create policy evidence_suggestions_read on public.criterion_evidence_suggestions for select to authenticated
 using (active);
create policy evaluation_period_read on public.evaluation_periods for select to authenticated
 using ((select itqan_private.has_school_permission(school_id,'school.view')));
create policy evaluation_scores_read on public.evaluation_score_details for select to authenticated using (
  (self_evaluation_id is not null and exists
   (select 1 from public.self_evaluations se where se.id=self_evaluation_id))
  or
  (performance_review_id is not null and exists
   (select 1 from public.performance_reviews pr where pr.id=performance_review_id))
);
