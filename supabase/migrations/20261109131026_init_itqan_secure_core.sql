
-- Itqan foundation: no seed records, no uploaded files.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  gender text check (gender in ('male','female')),
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  education_stage text,
  gender text check (gender in ('male','female','mixed')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);
create table public.school_memberships (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('principal','teacher','vice_principal','counselor','staff')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  unique(school_id,user_id)
);
create table public.performance_reviews (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  subject_user_id uuid not null references public.profiles(id) on delete cascade,
  reviewer_user_id uuid references public.profiles(id) on delete set null,
  academic_year text not null,
  criteria_scores jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','submitted','approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.portfolio_records (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  category text,
  content jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','submitted','approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.evidence_records (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolio_records(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  evidence_type text,
  created_at timestamptz not null default now()
);
create index on public.school_memberships(user_id, school_id);
create index on public.performance_reviews(subject_user_id, school_id);
create index on public.portfolio_records(user_id,school_id);
create index on public.evidence_records(user_id,school_id);
alter table public.profiles enable row level security;
alter table public.schools enable row level security;
alter table public.school_memberships enable row level security;
alter table public.performance_reviews enable row level security;
alter table public.portfolio_records enable row level security;
alter table public.evidence_records enable row level security;

-- Avoid exposing any table to unauthenticated clients.
revoke all on public.profiles,public.schools,public.school_memberships,
  public.performance_reviews,public.portfolio_records,public.evidence_records from anon;
grant select on public.profiles,public.schools,public.school_memberships,
  public.performance_reviews,public.portfolio_records,public.evidence_records to authenticated;
grant insert,update,delete on public.portfolio_records,public.evidence_records to authenticated;

-- Personal records and school membership are provisioned through trusted server-side workflows.
create policy profiles_read_self on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy memberships_read_self on public.school_memberships for select to authenticated
  using (user_id = (select auth.uid()));
create policy schools_read_member on public.schools for select to authenticated
  using (exists (
    select 1 from public.school_memberships m
    where m.school_id=schools.id and m.user_id=(select auth.uid()) and m.status='active'
  ));
create policy reviews_read_subject on public.performance_reviews for select to authenticated
  using (subject_user_id=(select auth.uid()) and exists (
    select 1 from public.school_memberships m
    where m.school_id=performance_reviews.school_id and m.user_id=(select auth.uid()) and m.status='active'
  ));

-- Members may manage only their own portfolio content within active school memberships.
create policy portfolio_read_own on public.portfolio_records for select to authenticated
  using (user_id=(select auth.uid()) and exists (
    select 1 from public.school_memberships m
    where m.school_id=portfolio_records.school_id and m.user_id=(select auth.uid()) and m.status='active'
  ));
create policy portfolio_insert_own on public.portfolio_records for insert to authenticated
  with check (user_id=(select auth.uid()) and status='draft' and exists (
    select 1 from public.school_memberships m where m.school_id=portfolio_records.school_id
    and m.user_id=(select auth.uid()) and m.status='active'
  ));
create policy portfolio_update_own on public.portfolio_records for update to authenticated
  using (user_id=(select auth.uid()) and status='draft' and exists (
    select 1 from public.school_memberships m where m.school_id=portfolio_records.school_id
    and m.user_id=(select auth.uid()) and m.status='active'
  ))
  with check (user_id=(select auth.uid()) and status='draft' and exists (
    select 1 from public.school_memberships m where m.school_id=portfolio_records.school_id
    and m.user_id=(select auth.uid()) and m.status='active'
  ));
create policy portfolio_delete_own on public.portfolio_records for delete to authenticated
  using (user_id=(select auth.uid()) and status='draft');
create policy evidence_read_own on public.evidence_records for select to authenticated
  using (user_id=(select auth.uid()) and exists (
    select 1 from public.portfolio_records p where p.id=evidence_records.portfolio_id
      and p.user_id=(select auth.uid()) and p.school_id=evidence_records.school_id
  ));
create policy evidence_insert_own on public.evidence_records for insert to authenticated
  with check (user_id=(select auth.uid()) and exists (
    select 1 from public.portfolio_records p where p.id=evidence_records.portfolio_id
      and p.user_id=(select auth.uid()) and p.school_id=evidence_records.school_id and p.status='draft'
  ));
create policy evidence_delete_own on public.evidence_records for delete to authenticated
  using (user_id=(select auth.uid()) and exists (
    select 1 from public.portfolio_records p where p.id=evidence_records.portfolio_id
      and p.user_id=(select auth.uid()) and p.school_id=evidence_records.school_id and p.status='draft'
  ));
