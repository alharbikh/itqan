-- #15: explicit employee consent to share a personal evidence item with a particular school.
create table public.personal_evidence_shares (
 evidence_id uuid not null references public.personal_evidence(id) on delete cascade,
 school_id uuid not null references public.schools(id) on delete restrict,
 user_id uuid not null references public.users(id) on delete restrict,
 shared_at timestamptz not null default now(),
 revoked_at timestamptz,
 primary key(evidence_id,school_id)
);
create index personal_evidence_shares_school on public.personal_evidence_shares(school_id,shared_at desc)
 where revoked_at is null;
alter table public.personal_evidence_shares enable row level security;
revoke all on public.personal_evidence_shares from public,anon,authenticated;
grant select,insert,delete on public.personal_evidence_shares to authenticated;
create policy personal_shares_read on public.personal_evidence_shares for select to authenticated using(
 user_id=(select auth.uid()) or
 (select itqan_private.has_school_permission(school_id,'school.view_portfolios')));
create policy personal_shares_insert on public.personal_evidence_shares for insert to authenticated with check(
 user_id=(select auth.uid()) and
 (select itqan_private.has_school_permission(school_id,'self.manage_portfolio')) and
 exists(select 1 from public.personal_evidence e where e.id=evidence_id and e.user_id=(select auth.uid())));
create policy personal_shares_delete on public.personal_evidence_shares for delete to authenticated using(
 user_id=(select auth.uid()));
create policy personal_evidence_shared_read on public.personal_evidence for select to authenticated using(
 exists(select 1 from public.personal_evidence_shares s where s.evidence_id=id
 and s.revoked_at is null and (select itqan_private.has_school_permission(s.school_id,'school.view_portfolios'))));

-- Evidence review never grants the authority to assign final performance scores.
create function public.itqan_school_review_evidence(p_evidence uuid,p_status text,p_note text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_school uuid;v_subject uuid;
begin
 select e.school_id,e.user_id into v_school,v_subject from public.evidence_records e where e.id=p_evidence;
 if v_actor is null or v_school is null or v_actor=v_subject then
  raise exception 'Forbidden' using errcode='42501';end if;
 if p_status not in ('approved','rejected','needs_changes') or length(coalesce(p_note,''))>2000 then
  raise exception 'Invalid evidence review' using errcode='22023';end if;
 if not itqan_private.has_school_permission(v_school,'school.manage_evidence_templates')
 and not exists(select 1 from public.school_review_delegations d where d.school_id=v_school
   and d.delegate_user_id=v_actor and d.subject_user_id=v_subject
   and d.scope='evidence_review' and d.revoked_at is null
   and now() between d.starts_at and d.expires_at) then
  raise exception 'No review mandate' using errcode='42501';end if;
 update public.evidence_records set evidence_status=p_status,reviewed_by=v_actor,
   reviewed_at=now(),reviewer_notes=left(coalesce(p_note,''),2000) where id=p_evidence;
 return true;
end;$$;

-- #16: internal final evaluation, with scored criteria and explicit approval.
create unique index performance_review_one_subject_year
on public.performance_reviews(school_id,subject_user_id,academic_year);

alter table public.performance_reviews
 add column approved_by uuid references public.users(id) on delete set null,
 add column approved_at timestamptz;

create function public.itqan_school_create_review(
 p_school uuid,p_subject uuid,p_year text,p_framework uuid,p_job uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_id uuid;
begin
 if v_actor is null or v_actor=p_subject or not itqan_private.has_school_permission(p_school,'school.manage_reviews') then
  raise exception 'Forbidden' using errcode='42501';end if;
 if length(btrim(coalesce(p_year,''))) not between 3 and 60
 or not exists(select 1 from public.school_memberships where school_id=p_school
   and user_id=p_subject and status='active')
 or not exists(select 1 from public.evaluation_frameworks f
   join public.evaluation_framework_jobs j on j.framework_id=f.id and j.job_title_id=p_job
   where f.id=p_framework and f.status='active' and j.is_active) then
   raise exception 'Invalid review subject or active framework' using errcode='22023';end if;
 insert into public.performance_reviews(school_id,subject_user_id,reviewer_user_id,
  academic_year,framework_id,job_title_id,status)
 values(p_school,p_subject,v_actor,btrim(p_year),p_framework,p_job,'draft')
 returning id into v_id;
 return v_id;
end;$$;

create function public.itqan_school_score_criterion(
 p_review uuid,p_criterion uuid,p_level smallint,p_note text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_review public.performance_reviews%rowtype;v_weight numeric;
begin
 select * into v_review from public.performance_reviews where id=p_review for update;
 if v_actor is null or not found or v_actor=v_review.subject_user_id or v_review.status<>'draft' then
  raise exception 'Review not editable' using errcode='42501';end if;
 if v_actor<>v_review.reviewer_user_id and not exists(
  select 1 from public.school_review_delegations d where d.school_id=v_review.school_id
   and d.delegate_user_id=v_actor and d.subject_user_id=v_review.subject_user_id
   and d.scope='performance_scoring' and d.revoked_at is null
   and now() between d.starts_at and d.expires_at)
 then raise exception 'No scoring mandate' using errcode='42501';end if;
 if p_level not between 1 and 5 or length(coalesce(p_note,''))>2000 then
  raise exception 'Invalid score' using errcode='22023';end if;
 select c.weight into v_weight from public.evaluation_framework_criteria c
 where c.framework_id=v_review.framework_id and c.job_title_id=v_review.job_title_id
 and c.criterion_id=p_criterion and c.is_required;
 if v_weight is null then raise exception 'Criterion not in review framework' using errcode='22023';end if;
 insert into public.evaluation_score_details(
  performance_review_id,framework_id,job_title_id,criterion_id,score_level,weight_snapshot,evaluator_notes)
 values(p_review,v_review.framework_id,v_review.job_title_id,p_criterion,p_level,v_weight,left(coalesce(p_note,''),2000))
 on conflict(performance_review_id,criterion_id) where performance_review_id is not null
 do update set score_level=excluded.score_level,evaluator_notes=excluded.evaluator_notes;
 return true;
end;$$;

create function public.itqan_school_submit_review(p_review uuid)
returns numeric language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_review public.performance_reviews%rowtype;
 v_expected integer;v_actual integer;v_result numeric;
begin
 select * into v_review from public.performance_reviews where id=p_review for update;
 if v_actor is null or not found or v_actor<>v_review.reviewer_user_id or
   v_actor=v_review.subject_user_id or v_review.status<>'draft' then
   raise exception 'Forbidden' using errcode='42501';end if;
 select count(*) into v_expected from public.evaluation_framework_criteria c where
 c.framework_id=v_review.framework_id and c.job_title_id=v_review.job_title_id and c.is_required;
 select count(*),coalesce(sum(weighted_score),0) into v_actual,v_result
 from public.evaluation_score_details where performance_review_id=p_review;
 if v_expected=0 or v_actual<>v_expected then raise exception 'Criteria scores incomplete' using errcode='22023';end if;
 update public.performance_reviews set final_score_100=v_result,status='submitted',updated_at=now()
 where id=p_review;
 return v_result;
end;$$;

create function public.itqan_school_approve_review(p_review uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_review public.performance_reviews%rowtype;
begin
 select * into v_review from public.performance_reviews where id=p_review for update;
 if v_actor is null or not found or v_actor=v_review.subject_user_id or
    v_review.status<>'submitted' or
    not itqan_private.has_school_permission(v_review.school_id,'school.publish_reviews') then
  raise exception 'Forbidden' using errcode='42501';end if;
 update public.performance_reviews set status='approved',visible_to_employee=true,
  approved_by=v_actor,approved_at=now(),published_at=now(),updated_at=now() where id=p_review;
 return true;
end;$$;

revoke all on function public.itqan_school_review_evidence(uuid,text,text) from public,anon;
revoke all on function public.itqan_school_create_review(uuid,uuid,text,uuid,uuid) from public,anon;
revoke all on function public.itqan_school_score_criterion(uuid,uuid,smallint,text) from public,anon;
revoke all on function public.itqan_school_submit_review(uuid) from public,anon;
revoke all on function public.itqan_school_approve_review(uuid) from public,anon;
grant execute on function public.itqan_school_review_evidence(uuid,text,text) to authenticated;
grant execute on function public.itqan_school_create_review(uuid,uuid,text,uuid,uuid) to authenticated;
grant execute on function public.itqan_school_score_criterion(uuid,uuid,smallint,text) to authenticated;
grant execute on function public.itqan_school_submit_review(uuid) to authenticated;
grant execute on function public.itqan_school_approve_review(uuid) to authenticated;
