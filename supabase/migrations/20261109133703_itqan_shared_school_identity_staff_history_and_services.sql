
-- Adapt the useful foundations of the school central schema without activating exams/committees.
create table public.education_regions (
 id uuid primary key default gen_random_uuid(),
 code text unique,
 name_ar text not null,
 active boolean not null default true
);
create table public.education_offices (
 id uuid primary key default gen_random_uuid(),
 region_id uuid not null references public.education_regions(id) on delete restrict,
 code text,
 name_ar text not null,
 active boolean not null default true,
 unique(region_id,code)
);
create index education_offices_region_idx on public.education_offices(region_id);

create table public.academic_years (
 id uuid primary key default gen_random_uuid(),
 label text not null unique,
 starts_on date not null,
 ends_on date not null,
 is_current boolean not null default false,
 check(starts_on<=ends_on)
);
create unique index academic_year_one_current on public.academic_years(is_current) where is_current;
alter table public.schools
 add column office_id uuid references public.education_offices(id) on delete set null,
 add column ministry_number text unique,
 add column school_type text,
 add column study_system text,
 add column phone text,
 add column mobile text,
 add column email text,
 add column has_special_education boolean not null default false;
create index schools_office_idx on public.schools(office_id);

-- A person exists independently of a login and can be assigned to multiple schools over time.
create table public.employees (
 id uuid primary key default gen_random_uuid(),
 user_id uuid unique references public.users(id) on delete set null,
 full_name text not null,
 national_id text unique,
 nationality text,
 qualification text,
 specialization text,
 mobile text,
 email text,
 government_email text,
 job_number text,
 job_grade text,
 ministry_start_date date,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.school_employees (
 id uuid primary key default gen_random_uuid(),
 employee_id uuid not null references public.employees(id) on delete restrict,
 school_id uuid not null references public.schools(id) on delete restrict,
 academic_year_id uuid not null references public.academic_years(id) on delete restrict,
 assignment_date date,
 starts_on date,
 ends_on date,
 weekly_periods smallint check(weekly_periods between 0 and 60),
 educational_supervisor text,
 status text not null default 'active' check (status in ('active','completed','transferred')),
 created_at timestamptz not null default now(),
 check(starts_on is null or ends_on is null or ends_on>=starts_on),
 unique(employee_id,school_id,academic_year_id)
);
create index school_employees_school_year_idx on public.school_employees(school_id,academic_year_id);
create index school_employees_employee_idx on public.school_employees(employee_id);

create table public.employee_school_jobs (
 id uuid primary key default gen_random_uuid(),
 school_employee_id uuid not null references public.school_employees(id) on delete cascade,
 job_title_id uuid not null references public.job_titles(id) on delete restrict,
 is_primary boolean not null default false,
 duties text,
 starts_on date,
 ends_on date,
 check(starts_on is null or ends_on is null or ends_on>=starts_on),
 unique(school_employee_id,job_title_id)
);
create unique index employee_school_one_primary_job
 on public.employee_school_jobs(school_employee_id) where is_primary;
create index employee_school_jobs_title_idx on public.employee_school_jobs(job_title_id);

-- Multiple administrative assignments do not automatically grant security privileges.
create table public.school_staff_assignments (
 id uuid primary key default gen_random_uuid(),
 school_employee_id uuid not null references public.school_employees(id) on delete cascade,
 assignment_code text not null,
 title_ar text not null,
 starts_on date,
 ends_on date,
 responsibilities text,
 is_primary boolean not null default false,
 check(starts_on is null or ends_on is null or ends_on>=starts_on)
);
create index school_staff_assignments_employee_idx on public.school_staff_assignments(school_employee_id);

-- Keep year-specific school identity and review history independent of current staff directory.
alter table public.school_memberships
 add column academic_year_id uuid references public.academic_years(id) on delete set null,
 add column employee_id uuid references public.employees(id) on delete set null;
create index school_memberships_year_idx on public.school_memberships(academic_year_id);
create index school_memberships_employee_idx on public.school_memberships(employee_id);
alter table public.evaluation_periods
 add column academic_year_id uuid references public.academic_years(id) on delete restrict;
create index evaluation_periods_year_idx on public.evaluation_periods(academic_year_id);

-- Services are future feature gates, not authentication or paid subscription enforcement yet.
create table public.platform_services (
 code text primary key,
 name_ar text not null,
 description text,
 is_active boolean not null default false
);
create table public.school_service_access (
 school_id uuid not null references public.schools(id) on delete cascade,
 service_code text not null references public.platform_services(code) on delete cascade,
 enabled boolean not null default false,
 enabled_at timestamptz,
 granted_by uuid references public.users(id) on delete set null,
 primary key(school_id,service_code)
);
create index school_service_access_service_idx on public.school_service_access(service_code);
create index school_service_access_granted_by_idx on public.school_service_access(granted_by);

-- All newly added entities start deny-by-default pending scoped API workflows.
alter table public.education_regions enable row level security;
alter table public.education_offices enable row level security;
alter table public.academic_years enable row level security;
alter table public.employees enable row level security;
alter table public.school_employees enable row level security;
alter table public.employee_school_jobs enable row level security;
alter table public.school_staff_assignments enable row level security;
alter table public.platform_services enable row level security;
alter table public.school_service_access enable row level security;
revoke all on public.education_regions, public.education_offices, public.academic_years,
 public.employees, public.school_employees, public.employee_school_jobs,
 public.school_staff_assignments, public.platform_services, public.school_service_access
 from anon, authenticated;
