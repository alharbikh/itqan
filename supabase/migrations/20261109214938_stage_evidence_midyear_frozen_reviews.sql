-- #14: one central schedule per academic year and stage, optionally overridden by each school.
create table public.performance_stage_defaults (
 academic_year_id uuid not null references public.academic_years(id) on delete restrict,
 stage text not null check(stage in ('planning','midyear','final')),
 starts_on date not null,
 ends_on date not null,
 earliest_start date not null,
 latest_end date not null,
 updated_by uuid references public.users(id) on delete set null,
 updated_at timestamptz not null default now(),
 primary key(academic_year_id,stage),
 check(earliest_start<=starts_on and starts_on<=ends_on and ends_on<=latest_end)
);
create table public.school_stage_overrides (
 school_id uuid not null references public.schools(id) on delete restrict,
 academic_year_id uuid not null,
 stage text not null,
 starts_on date not null,
 ends_on date not null,
 reason text not null check(length(btrim(reason)) between 3 and 500),
 changed_by uuid not null references public.users(id) on delete restrict,
 changed_at timestamptz not null default now(),
 primary key(school_id,academic_year_id,stage),
 foreign key(academic_year_id,stage) references public.performance_stage_defaults(academic_year_id,stage),
 check(starts_on<=ends_on)
);
create table public.school_stage_change_log (
 id bigint generated always as identity primary key,
 school_id uuid not null references public.schools(id) on delete restrict,
 academic_year_id uuid not null references public.academic_years(id) on delete restrict,
 stage text not null,
 changed_by uuid not null references public.users(id) on delete restrict,
 old_dates jsonb,
 new_dates jsonb not null,
 reason text not null,
 changed_at timestamptz not null default now()
);
create table public.framework_acknowledgements (
 school_id uuid not null references public.schools(id) on delete restrict,
 user_id uuid not null references public.users(id) on delete restrict,
 framework_id uuid not null references public.evaluation_frameworks(id) on delete restrict,
 acknowledged_at timestamptz not null default now(),
 primary key(school_id,user_id,framework_id)
);
alter table public.performance_stage_defaults enable row level security;
alter table public.school_stage_overrides enable row level security;
alter table public.school_stage_change_log enable row level security;
alter table public.framework_acknowledgements enable row level security;
revoke all on public.performance_stage_defaults,public.school_stage_overrides,
 public.school_stage_change_log,public.framework_acknowledgements from public,anon,authenticated;
grant select on public.performance_stage_defaults,public.school_stage_overrides,
 public.school_stage_change_log,public.framework_acknowledgements to authenticated;
create policy stage_defaults_read on public.performance_stage_defaults for select to authenticated using(true);
create policy stage_overrides_school_read on public.school_stage_overrides for select to authenticated
 using((select itqan_private.has_school_permission(school_id,'school.view')));
create policy stage_changes_principal_read on public.school_stage_change_log for select to authenticated
 using((select itqan_private.has_school_permission(school_id,'school.manage_members')));
create policy framework_ack_read on public.framework_acknowledgements for select to authenticated using(
 user_id=(select auth.uid()) or (select itqan_private.has_school_permission(school_id,'school.manage_reviews')));

create function public.itqan_admin_set_stage_default(
 p_year uuid,p_stage text,p_start date,p_end date,p_earliest date,p_latest date)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();
begin
 if v_actor is null or not itqan_private.has_system_permission('system.manage_roles') then
  raise exception 'Forbidden' using errcode='42501';end if;
 if p_stage not in ('planning','midyear','final') or p_earliest>p_start or
 p_start>p_end or p_end>p_latest or not exists(
  select 1 from public.academic_years where id=p_year and starts_on<=p_earliest and ends_on>=p_latest)
 then raise exception 'Invalid stage schedule' using errcode='22023';end if;
 insert into public.performance_stage_defaults(academic_year_id,stage,starts_on,ends_on,earliest_start,latest_end,updated_by)
 values(p_year,p_stage,p_start,p_end,p_earliest,p_latest,v_actor)
 on conflict(academic_year_id,stage) do update set starts_on=excluded.starts_on,ends_on=excluded.ends_on,
 earliest_start=excluded.earliest_start,latest_end=excluded.latest_end,updated_by=excluded.updated_by,updated_at=now();
 return true;
end;$$;
create function public.itqan_school_set_stage_dates(
 p_school uuid,p_year uuid,p_stage text,p_start date,p_end date,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_min date;v_max date;v_previous jsonb;
begin
 if v_actor is null or not itqan_private.has_school_permission(p_school,'school.manage_reviews') then
 raise exception 'Forbidden' using errcode='42501';end if;
 if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then
 raise exception 'Reason required' using errcode='22023';end if;
 select earliest_start,latest_end into v_min,v_max from public.performance_stage_defaults
  where academic_year_id=p_year and stage=p_stage for share;
 if not found or p_start<v_min or p_end>v_max or p_start>p_end then
 raise exception 'School dates outside allowed stage window' using errcode='22023';end if;
 select to_jsonb(o) into v_previous from public.school_stage_overrides o
  where school_id=p_school and academic_year_id=p_year and stage=p_stage;
 insert into public.school_stage_overrides(school_id,academic_year_id,stage,starts_on,ends_on,reason,changed_by)
 values(p_school,p_year,p_stage,p_start,p_end,btrim(p_reason),v_actor)
 on conflict(school_id,academic_year_id,stage) do update set starts_on=excluded.starts_on,
 ends_on=excluded.ends_on,reason=excluded.reason,changed_by=excluded.changed_by,changed_at=now();
 insert into public.school_stage_change_log(school_id,academic_year_id,stage,changed_by,old_dates,new_dates,reason)
 values(p_school,p_year,p_stage,v_actor,v_previous,jsonb_build_object('starts_on',p_start,'ends_on',p_end),btrim(p_reason));
 return true;
end;$$;
create function public.itqan_employee_acknowledge_framework(p_school uuid,p_framework uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();
begin
 if v_actor is null or not itqan_private.has_school_permission(p_school,'school.view') then
  raise exception 'Forbidden' using errcode='42501';end if;
 if not exists(select 1 from public.evaluation_frameworks where id=p_framework and status='active') then
  raise exception 'Only published frameworks can be acknowledged' using errcode='22023';end if;
 insert into public.framework_acknowledgements(school_id,user_id,framework_id)
 values(p_school,v_actor,p_framework) on conflict do nothing;
 return true;
end;$$;

-- #15: personal evidence is independent from any former school; attachments require later storage policies.
create table public.personal_evidence (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.users(id) on delete restrict,
 title text not null check(length(btrim(title)) between 2 and 250),
 description text,
 link_url text,
 status text not null default 'draft' check(status in ('draft','ready')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index personal_evidence_user_idx on public.personal_evidence(user_id,created_at desc);
create table public.personal_evidence_criteria (
 evidence_id uuid not null references public.personal_evidence(id) on delete cascade,
 criterion_id uuid not null references public.evaluation_criteria(id) on delete restrict,
 created_at timestamptz not null default now(),
 primary key(evidence_id,criterion_id)
);
create table public.school_review_delegations (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete restrict,
 granted_by uuid not null references public.users(id) on delete restrict,
 delegate_user_id uuid not null references public.users(id) on delete restrict,
 subject_user_id uuid not null references public.users(id) on delete restrict,
 scope text not null check(scope in ('evidence_review','performance_scoring')),
 starts_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 created_at timestamptz not null default now(),
 check(granted_by<>delegate_user_id and delegate_user_id<>subject_user_id and expires_at>starts_at)
);
create index school_delegations_active_idx on public.school_review_delegations(school_id,delegate_user_id,expires_at)
 where revoked_at is null;
alter table public.personal_evidence enable row level security;
alter table public.personal_evidence_criteria enable row level security;
alter table public.school_review_delegations enable row level security;
revoke all on public.personal_evidence,public.personal_evidence_criteria,public.school_review_delegations from public,anon,authenticated;
grant select,insert,update,delete on public.personal_evidence,public.personal_evidence_criteria to authenticated;
grant select on public.school_review_delegations to authenticated;
create policy personal_evidence_read on public.personal_evidence for select to authenticated
 using(user_id=(select auth.uid()));
create policy personal_evidence_create on public.personal_evidence for insert to authenticated
 with check(user_id=(select auth.uid()));
create policy personal_evidence_edit on public.personal_evidence for update to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy personal_evidence_delete on public.personal_evidence for delete to authenticated
 using(user_id=(select auth.uid()));
create policy personal_evidence_criterion_read on public.personal_evidence_criteria for select to authenticated using(
 exists(select 1 from public.personal_evidence e where e.id=evidence_id and e.user_id=(select auth.uid())));
create policy personal_evidence_criterion_add on public.personal_evidence_criteria for insert to authenticated with check(
 exists(select 1 from public.personal_evidence e where e.id=evidence_id and e.user_id=(select auth.uid())));
create policy personal_evidence_criterion_remove on public.personal_evidence_criteria for delete to authenticated using(
 exists(select 1 from public.personal_evidence e where e.id=evidence_id and e.user_id=(select auth.uid())));
create policy delegations_read on public.school_review_delegations for select to authenticated using(
 delegate_user_id=(select auth.uid()) or granted_by=(select auth.uid()) or
 (select itqan_private.has_school_permission(school_id,'school.manage_members')));

create function public.itqan_school_grant_review_delegation(
 p_school uuid,p_delegate uuid,p_subject uuid,p_scope text,p_expiry timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_id uuid;
begin
 if v_actor is null or not itqan_private.has_school_permission(p_school,'school.manage_members') then
  raise exception 'Forbidden' using errcode='42501';end if;
 if p_scope not in ('evidence_review','performance_scoring') or
    p_delegate=v_actor or p_delegate=p_subject or p_subject=v_actor or
    p_expiry<=now() or p_expiry>now()+interval '60 days' then
  raise exception 'Invalid delegated review' using errcode='22023';end if;
 if not exists(select 1 from public.school_memberships where school_id=p_school and user_id=p_delegate and status='active')
 or not exists(select 1 from public.school_memberships where school_id=p_school and user_id=p_subject and status='active') then
   raise exception 'Delegation must be inside current school' using errcode='22023';end if;
 insert into public.school_review_delegations(school_id,granted_by,delegate_user_id,subject_user_id,scope,expires_at)
 values(p_school,v_actor,p_delegate,p_subject,p_scope,p_expiry) returning id into v_id;
 return v_id;
end;$$;
create function public.itqan_school_revoke_review_delegation(p_delegation uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_school uuid;v_grantor uuid;
begin
 select school_id,granted_by into v_school,v_grantor from public.school_review_delegations where id=p_delegation;
 if v_school is null or v_actor is null or (v_actor<>v_grantor and
  not itqan_private.has_school_permission(v_school,'school.manage_members')) then
   raise exception 'Forbidden' using errcode='42501';end if;
 update public.school_review_delegations set revoked_at=now() where id=p_delegation and revoked_at is null;
 return true;
end;$$;

-- #16: qualitative midpoint review and history-preserving freeze when a membership ends.
create table public.midyear_feedback (
 id uuid primary key default gen_random_uuid(),
 school_id uuid not null references public.schools(id) on delete restrict,
 academic_year_id uuid not null references public.academic_years(id) on delete restrict,
 subject_user_id uuid not null references public.users(id) on delete restrict,
 reviewer_user_id uuid not null references public.users(id) on delete restrict,
 strengths text,
 improvements text,
 development_actions text,
 employee_comment text,
 status text not null default 'draft' check(status in ('draft','published','acknowledged')),
 published_at timestamptz,
 acknowledged_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(school_id,academic_year_id,subject_user_id),
 check(subject_user_id<>reviewer_user_id)
);
alter table public.midyear_feedback enable row level security;
revoke all on public.midyear_feedback from public,anon,authenticated;
grant select,insert on public.midyear_feedback to authenticated;
grant update(strengths,improvements,development_actions,employee_comment,status,published_at,updated_at)
 on public.midyear_feedback to authenticated;
create policy midyear_read on public.midyear_feedback for select to authenticated using(
 (subject_user_id=(select auth.uid()) and status<>'draft') or
 (select itqan_private.has_school_permission(school_id,'school.manage_reviews')));
create policy midyear_create on public.midyear_feedback for insert to authenticated with check(
 reviewer_user_id=(select auth.uid()) and status='draft' and
 (select itqan_private.has_school_permission(school_id,'school.manage_reviews')) and
 exists(select 1 from public.school_memberships m where m.user_id=subject_user_id and m.school_id=midyear_feedback.school_id and m.status='active'));
create policy midyear_update on public.midyear_feedback for update to authenticated using(
 reviewer_user_id=(select auth.uid()) and status='draft' and
 (select itqan_private.has_school_permission(school_id,'school.manage_reviews')))
 with check(reviewer_user_id=(select auth.uid()) and status in ('draft','published') and
 (select itqan_private.has_school_permission(school_id,'school.manage_reviews')));
create function public.itqan_employee_ack_midyear(p_feedback uuid,p_comment text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();
begin
 if v_actor is null then raise exception 'Forbidden' using errcode='42501';end if;
 update public.midyear_feedback set status='acknowledged',acknowledged_at=now(),
  employee_comment=left(coalesce(p_comment,''),2000),updated_at=now()
 where id=p_feedback and subject_user_id=v_actor and status='published';
 if not found then raise exception 'No published feedback for employee' using errcode='22023';end if;
 return true;
end;$$;

alter table public.performance_reviews drop constraint performance_reviews_status_check;
alter table public.performance_reviews add constraint performance_reviews_status_check
 check(status in ('draft','submitted','approved','frozen'));
create function itqan_private.freeze_school_reviews_and_delegations()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='active' and new.status='inactive' then
  update public.performance_reviews set status='frozen',updated_at=now()
   where school_id=old.school_id and subject_user_id=old.user_id and status in ('draft','submitted');
  update public.school_review_delegations set revoked_at=now()
   where school_id=old.school_id and revoked_at is null and
   (delegate_user_id=old.user_id or subject_user_id=old.user_id);
 end if;
 return new;
end;$$;
create trigger freeze_on_membership_end after update of status on public.school_memberships
for each row execute function itqan_private.freeze_school_reviews_and_delegations();

create function itqan_private.prevent_frozen_review_change()
returns trigger language plpgsql set search_path='' as $$
begin
 if old.status='frozen' then
  raise exception 'Frozen reviews require an authorized exceptional process' using errcode='42501';
 end if;
 return new;
end;$$;
create trigger prevent_frozen_review_change before update on public.performance_reviews
for each row execute function itqan_private.prevent_frozen_review_change();

create table public.review_exception_requests (
 id uuid primary key default gen_random_uuid(),
 review_id uuid not null references public.performance_reviews(id) on delete restrict,
 school_id uuid not null references public.schools(id) on delete restrict,
 requested_by uuid not null references public.users(id) on delete restrict,
 approved_by uuid references public.users(id) on delete restrict,
 reason text not null,
 starts_at timestamptz,
 expires_at timestamptz,
 revoked_at timestamptz,
 status text not null default 'pending' check(status in ('pending','approved','rejected','expired')),
 created_at timestamptz not null default now(),
 check(expires_at is null or starts_at is null or expires_at>starts_at)
);
alter table public.review_exception_requests enable row level security;
revoke all on public.review_exception_requests from public,anon,authenticated;
grant select on public.review_exception_requests to authenticated;
create policy review_exception_read on public.review_exception_requests for select to authenticated using(
 requested_by=(select auth.uid()) or approved_by=(select auth.uid()) or
 (select itqan_private.has_school_permission(school_id,'school.manage_reviews')));
-- Deliberately no mutation grants: legal approval routing and exception reopening require a separately tested workflow.

revoke all on function public.itqan_admin_set_stage_default(uuid,text,date,date,date,date) from public,anon;
revoke all on function public.itqan_school_set_stage_dates(uuid,uuid,text,date,date,text) from public,anon;
revoke all on function public.itqan_employee_acknowledge_framework(uuid,uuid) from public,anon;
revoke all on function public.itqan_school_grant_review_delegation(uuid,uuid,uuid,text,timestamptz) from public,anon;
revoke all on function public.itqan_school_revoke_review_delegation(uuid) from public,anon;
revoke all on function public.itqan_employee_ack_midyear(uuid,text) from public,anon;
grant execute on function public.itqan_admin_set_stage_default(uuid,text,date,date,date,date) to authenticated;
grant execute on function public.itqan_school_set_stage_dates(uuid,uuid,text,date,date,text) to authenticated;
grant execute on function public.itqan_employee_acknowledge_framework(uuid,uuid) to authenticated;
grant execute on function public.itqan_school_grant_review_delegation(uuid,uuid,uuid,text,timestamptz) to authenticated;
grant execute on function public.itqan_school_revoke_review_delegation(uuid) to authenticated;
grant execute on function public.itqan_employee_ack_midyear(uuid,text) to authenticated;
