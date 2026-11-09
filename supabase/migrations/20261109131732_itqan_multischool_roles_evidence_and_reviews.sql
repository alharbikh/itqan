
alter table public.profiles rename to users;
alter table public.school_memberships rename column role to job_role;

create table public.roles (
  code text primary key check (code in ('site_admin','school_principal','employee')),
  name_ar text not null,
  scope text not null check (scope in ('system','school'))
);
create table public.permissions (
  code text primary key,
  name_ar text not null,
  scope text not null check(scope in ('system','school'))
);
create table public.role_permissions (
  role_code text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key(role_code,permission_code)
);
create table public.user_roles (
  user_id uuid not null references public.users(id) on delete cascade,
  role_code text not null references public.roles(code),
  primary key(user_id,role_code),
  constraint site_role_only check (role_code='site_admin')
);

insert into public.roles(code,name_ar,scope) values
 ('site_admin','مدير الموقع','system'),
 ('school_principal','مدير المدرسة','school'),
 ('employee','المعلم أو الموظف','school');

insert into public.permissions(code,name_ar,scope) values
 ('system.manage_schools','إدارة المدارس','system'),
 ('system.manage_users','إدارة جميع الحسابات','system'),
 ('system.manage_roles','إدارة الأدوار والصلاحيات','system'),
 ('system.view_reports','عرض تقارير المنصة','system'),
 ('school.view','عرض بيانات المدرسة','school'),
 ('school.edit','تعديل بيانات المدرسة','school'),
 ('school.manage_members','إدارة موظفي المدرسة','school'),
 ('school.view_portfolios','عرض ملفات الإنجاز بالمدرسة','school'),
 ('school.manage_evidence_templates','تخصيص قوالب الشواهد','school'),
 ('school.assign_evidence','تخصيص الشواهد للموظفين','school'),
 ('school.view_self_evaluations','عرض التقييم الذاتي المقدم','school'),
 ('school.manage_reviews','تقييم الموظفين','school'),
 ('school.publish_reviews','إظهار التقييم للموظف','school'),
 ('self.manage_portfolio','إدارة ملف الإنجاز الشخصي','school'),
 ('self.submit_self_evaluation','إرسال التقييم الذاتي','school'),
 ('self.view_published_review','عرض التقييم المعتمد المنشور','school');

insert into public.role_permissions(role_code,permission_code)
select 'site_admin',code from public.permissions;
insert into public.role_permissions(role_code,permission_code)
select 'school_principal',code from public.permissions where code like 'school.%' or code like 'self.%';
insert into public.role_permissions(role_code,permission_code)
select 'employee',code from public.permissions where code in
 ('school.view','self.manage_portfolio','self.submit_self_evaluation','self.view_published_review');

alter table public.school_memberships
 add column access_role text not null default 'employee' references public.roles(code),
 add constraint school_access_role_check check (access_role in ('school_principal','employee'));
create index school_memberships_school_status_idx on public.school_memberships(school_id,status,access_role);

create table public.evidence_templates (
 id uuid primary key default gen_random_uuid(),
 school_id uuid references public.schools(id) on delete cascade,
 title text not null,
 description text,
 category text,
 criteria_code text,
 is_active boolean not null default true,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index evidence_templates_school_idx on public.evidence_templates(school_id,is_active);
create table public.evidence_assignments (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 template_id uuid not null references public.evidence_templates(id) on delete cascade,
 user_id uuid references public.users(id) on delete cascade,
 job_role text,
 is_required boolean not null default true,
 active boolean not null default true,
 assigned_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 check (user_id is null or job_role is null)
);
create index evidence_assignments_school_user_idx on public.evidence_assignments(school_id,user_id);
create index evidence_assignments_template_idx on public.evidence_assignments(template_id);

create table public.self_evaluations (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete cascade,
 user_id uuid not null references public.users(id) on delete cascade,
 academic_year text not null,
 criteria_scores jsonb not null default '{}'::jsonb,
 notes text,
 status text not null default 'draft' check(status in ('draft','submitted')),
 submitted_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(school_id,user_id,academic_year)
);
create index self_evaluations_school_status_idx on public.self_evaluations(school_id,status);

alter table public.performance_reviews
 add column visible_to_employee boolean not null default false,
 add column published_at timestamptz,
 add column notes text,
 add column self_evaluation_id uuid references public.self_evaluations(id) on delete set null;
create index performance_reviews_school_status_idx on public.performance_reviews(school_id,status);

alter table public.evidence_records
 add column template_id uuid references public.evidence_templates(id) on delete set null,
 add column assignment_id uuid references public.evidence_assignments(id) on delete set null;

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.evidence_templates enable row level security;
alter table public.evidence_assignments enable row level security;
alter table public.self_evaluations enable row level security;
revoke all on public.roles,public.permissions,public.role_permissions,
 public.user_roles,public.evidence_templates,public.evidence_assignments,
 public.self_evaluations from anon;
