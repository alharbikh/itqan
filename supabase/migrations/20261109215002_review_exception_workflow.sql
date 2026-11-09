-- #16: an exceptional and time-bounded path for finishing frozen reviews.
-- Requester must be the historic evaluator; a different, currently authorized approver must permit it.
create unique index review_exception_one_open_per_review
on public.review_exception_requests(review_id) where status in ('pending','approved');
create table public.review_exception_events (
 id bigint generated always as identity primary key,
 request_id uuid not null references public.review_exception_requests(id) on delete restrict,
 school_id uuid not null references public.schools(id) on delete restrict,
 actor_user_id uuid not null references public.users(id) on delete restrict,
 action text not null check(action in ('requested','approved','rejected','score_changed','submitted')),
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
alter table public.review_exception_events enable row level security;
revoke all on public.review_exception_events from public,anon,authenticated;
grant select on public.review_exception_events to authenticated;
create policy review_exception_events_read on public.review_exception_events for select to authenticated
using(exists(select 1 from public.review_exception_requests r where r.id=request_id
 and (r.requested_by=(select auth.uid()) or
 (select itqan_private.has_school_permission(r.school_id,'school.manage_reviews')))));

create function public.itqan_school_request_review_exception(p_review uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_review public.performance_reviews%rowtype;v_request uuid;
begin
 select * into v_review from public.performance_reviews where id=p_review;
 if not found or v_actor is null or v_review.reviewer_user_id<>v_actor or
 v_review.subject_user_id=v_actor or v_review.status<>'frozen' then
  raise exception 'Only the historic evaluator can request continuation' using errcode='42501';end if;
 if length(btrim(coalesce(p_reason,''))) not between 10 and 1000 then
  raise exception 'Reason must be documented' using errcode='22023';end if;
 insert into public.review_exception_requests(review_id,school_id,requested_by,reason)
 values(p_review,v_review.school_id,v_actor,btrim(p_reason)) returning id into v_request;
 insert into public.review_exception_events(request_id,school_id,actor_user_id,action)
 values(v_request,v_review.school_id,v_actor,'requested');
 return v_request;
end;$$;

create function public.itqan_school_decide_review_exception(
 p_request uuid,p_approve boolean,p_expiry timestamptz default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_r public.review_exception_requests%rowtype;v_subject uuid;
begin
 select * into v_r from public.review_exception_requests where id=p_request for update;
 if not found or v_actor is null or v_r.requested_by=v_actor or v_r.status<>'pending' or
 not itqan_private.has_school_permission(v_r.school_id,'school.publish_reviews') then
  raise exception 'A separate authorized approver is required' using errcode='42501';end if;
 select subject_user_id into v_subject from public.performance_reviews where id=v_r.review_id;
 if v_subject=v_actor or p_approve is null then raise exception 'Invalid approver' using errcode='42501';end if;
 if p_approve and (p_expiry is null or p_expiry<=now() or
   p_expiry>now()+interval '14 days') then
  raise exception 'An expiry within 14 days is required' using errcode='22023';end if;
 update public.review_exception_requests set status=case when p_approve then 'approved' else 'rejected' end,
  approved_by=v_actor,starts_at=case when p_approve then now() else null end,
  expires_at=case when p_approve then p_expiry else null end,
  revoked_at=case when p_approve then null else now() end where id=p_request;
 insert into public.review_exception_events(request_id,school_id,actor_user_id,action,details)
 values(p_request,v_r.school_id,v_actor,case when p_approve then 'approved' else 'rejected' end,
 jsonb_build_object('expires_at',p_expiry));
 return true;
end;$$;

-- Retain the weight and parent checks, allowing a frozen score only during an approved exception.
create or replace function itqan_private.validate_evaluation_score_detail()
returns trigger language plpgsql set search_path='' as $$
declare v_framework uuid;v_job uuid;v_weight numeric(6,3);v_status text;
begin
 if new.self_evaluation_id is not null then
  select e.framework_id,e.job_title_id,e.status into v_framework,v_job,v_status
  from public.self_evaluations e where e.id=new.self_evaluation_id;
 else
  select e.framework_id,e.job_title_id,e.status into v_framework,v_job,v_status
  from public.performance_reviews e where e.id=new.performance_review_id;
 end if;
 if v_framework is distinct from new.framework_id or v_job is distinct from new.job_title_id then
  raise exception 'Evaluation score does not match its parent job/framework';end if;
 if v_status <> 'draft' and not (v_status='frozen' and new.performance_review_id is not null
  and exists(select 1 from public.review_exception_requests r
   where r.review_id=new.performance_review_id and r.requested_by=auth.uid()
   and r.status='approved' and r.revoked_at is null
   and now() between r.starts_at and r.expires_at)) then
   raise exception 'Evaluation score cannot be edited without valid exception';end if;
 select weight into v_weight from public.evaluation_framework_criteria c
 where c.framework_id=new.framework_id and c.job_title_id=new.job_title_id
 and c.criterion_id=new.criterion_id and c.is_required;
 if v_weight is null or v_weight<>new.weight_snapshot then
  raise exception 'Evaluation score weight does not match its framework criterion';end if;
 return new;
end;$$;

create or replace function itqan_private.prevent_frozen_review_change()
returns trigger language plpgsql set search_path='' as $$
begin
 if old.status='frozen' and not exists(
  select 1 from public.review_exception_requests r
  where r.review_id=old.id and r.requested_by=auth.uid() and r.status='approved'
   and r.revoked_at is null and now() between r.starts_at and r.expires_at) then
  raise exception 'Frozen reviews require an authorized exceptional process' using errcode='42501';
 end if;
 return new;
end;$$;

create function public.itqan_school_exception_score(
 p_request uuid,p_criterion uuid,p_level smallint,p_note text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_r public.review_exception_requests%rowtype;
 v_review public.performance_reviews%rowtype;v_weight numeric;
begin
 select * into v_r from public.review_exception_requests where id=p_request for update;
 if not found or v_actor is null or v_r.requested_by<>v_actor or v_r.status<>'approved'
 or v_r.revoked_at is not null or now() not between v_r.starts_at and v_r.expires_at then
  raise exception 'No active exception' using errcode='42501';end if;
 select * into v_review from public.performance_reviews where id=v_r.review_id for update;
 if v_review.status<>'frozen' or v_review.reviewer_user_id<>v_actor or
  v_review.subject_user_id=v_actor then raise exception 'Review is not eligible' using errcode='42501';end if;
 if p_level not between 1 and 5 or length(coalesce(p_note,''))>2000 then
  raise exception 'Invalid score' using errcode='22023';end if;
 select weight into v_weight from public.evaluation_framework_criteria
 where framework_id=v_review.framework_id and job_title_id=v_review.job_title_id
 and criterion_id=p_criterion and is_required;
 if v_weight is null then raise exception 'Unknown criterion' using errcode='22023';end if;
 insert into public.evaluation_score_details(
  performance_review_id,framework_id,job_title_id,criterion_id,score_level,weight_snapshot,evaluator_notes)
 values(v_review.id,v_review.framework_id,v_review.job_title_id,p_criterion,p_level,v_weight,left(coalesce(p_note,''),2000))
 on conflict(performance_review_id,criterion_id) where performance_review_id is not null
 do update set score_level=excluded.score_level,evaluator_notes=excluded.evaluator_notes;
 insert into public.review_exception_events(request_id,school_id,actor_user_id,action,details)
 values(p_request,v_r.school_id,v_actor,'score_changed',
  jsonb_build_object('criterion_id',p_criterion,'level',p_level));
 return true;
end;$$;

create function public.itqan_school_exception_submit(p_request uuid)
returns numeric language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_r public.review_exception_requests%rowtype;
 v_review public.performance_reviews%rowtype;v_expected integer;v_actual integer;v_score numeric;
begin
 select * into v_r from public.review_exception_requests where id=p_request for update;
 if not found or v_actor is null or v_r.requested_by<>v_actor or v_r.status<>'approved'
 or v_r.revoked_at is not null or now() not between v_r.starts_at and v_r.expires_at then
  raise exception 'No active exception' using errcode='42501';end if;
 select * into v_review from public.performance_reviews where id=v_r.review_id for update;
 if v_review.status<>'frozen' or v_review.reviewer_user_id<>v_actor then
  raise exception 'Review is not eligible' using errcode='42501';end if;
 select count(*) into v_expected from public.evaluation_framework_criteria
 where framework_id=v_review.framework_id and job_title_id=v_review.job_title_id and is_required;
 select count(*),coalesce(sum(weighted_score),0) into v_actual,v_score
 from public.evaluation_score_details where performance_review_id=v_review.id;
 if v_expected=0 or v_actual<>v_expected then
  raise exception 'Criterion scores incomplete' using errcode='22023';end if;
 update public.performance_reviews set status='submitted',final_score_100=v_score,updated_at=now()
 where id=v_review.id;
 update public.review_exception_requests set status='expired',revoked_at=now() where id=p_request;
 insert into public.review_exception_events(request_id,school_id,actor_user_id,action,details)
 values(p_request,v_r.school_id,v_actor,'submitted',jsonb_build_object('weighted_score',v_score));
 return v_score;
end;$$;

revoke all on function public.itqan_school_request_review_exception(uuid,text) from public,anon;
revoke all on function public.itqan_school_decide_review_exception(uuid,boolean,timestamptz) from public,anon;
revoke all on function public.itqan_school_exception_score(uuid,uuid,smallint,text) from public,anon;
revoke all on function public.itqan_school_exception_submit(uuid) from public,anon;
grant execute on function public.itqan_school_request_review_exception(uuid,text) to authenticated;
grant execute on function public.itqan_school_decide_review_exception(uuid,boolean,timestamptz) to authenticated;
grant execute on function public.itqan_school_exception_score(uuid,uuid,smallint,text) to authenticated;
grant execute on function public.itqan_school_exception_submit(uuid) to authenticated;
