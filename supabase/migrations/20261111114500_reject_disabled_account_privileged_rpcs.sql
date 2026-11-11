-- Security hardening for direct Supabase RPC access from still-valid access tokens.
-- The Cloudflare Worker checks disabled accounts, but authenticated users can
-- call database RPCs directly while their JWT has not yet expired.
-- Keep function signatures, ownership, grants and permission checks unchanged.
-- Every body below is the existing deployed function definition with only a
-- leading active-account check inserted; no application data is modified.
-- Includes historic evaluation exception endpoints with owner-based access.

-- Enforce active user state: itqan_employee_ack_midyear
CREATE OR REPLACE FUNCTION public.itqan_employee_ack_midyear(p_feedback uuid, p_comment text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();
begin

 if v_actor is null or not exists (
  select 1 from public.users u where u.id=v_actor and u.status='active'
 ) then raise exception 'Active account required' using errcode='42501'; end if;
 if v_actor is null then raise exception 'Forbidden' using errcode='42501';end if;
 update public.midyear_feedback set status='acknowledged',acknowledged_at=now(),
  employee_comment=left(coalesce(p_comment,''),2000),updated_at=now()
 where id=p_feedback and subject_user_id=v_actor and status='published';
 if not found then raise exception 'No published feedback for employee' using errcode='22023';end if;
 return true;
end;$function$;



-- Enforce active user state: itqan_personnel_my_profiles
CREATE OR REPLACE FUNCTION public.itqan_personnel_my_profiles()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_profiles jsonb;
begin

 if v_actor is null or not exists (
  select 1 from public.users u where u.id=v_actor and u.status='active'
 ) then raise exception 'Active account required' using errcode='42501'; end if;
 if v_actor is null then raise exception 'Forbidden' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'school_id',p.school_id,
  'school_name',s.name,'employee_number',p.employee_number,'status',p.status)
 order by p.created_at desc),'[]'::jsonb) into v_profiles
 from public.school_personnel_profiles p join public.schools s on s.id=p.school_id
 join public.employees e on e.id=p.employee_id where e.user_id=v_actor;
 return v_profiles;
end;$function$;



-- Enforce active user state: itqan_personnel_my_requests
CREATE OR REPLACE FUNCTION public.itqan_personnel_my_requests()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid(); v_result jsonb;
begin

 if v_actor is null or not exists (
  select 1 from public.users u where u.id=v_actor and u.status='active'
 ) then raise exception 'Active account required' using errcode='42501'; end if;
 if v_actor is null then raise exception 'Forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'school_id',q.school_id,
  'school_name',s.name,'status',q.status,'created_at',q.created_at,
  'updated_at',q.updated_at,'decision_note',q.decision_note,
  'full_name',q.submitted_data->>'full_name') order by q.created_at desc),'[]'::jsonb)
 into v_result from public.school_personnel_requests q
 join public.schools s on s.id=q.school_id where q.user_id=v_actor;
 return v_result;
end;$function$;



-- Enforce active user state: itqan_school_score_criterion
CREATE OR REPLACE FUNCTION public.itqan_school_score_criterion(p_review uuid, p_criterion uuid, p_level smallint, p_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_review public.performance_reviews%rowtype;v_weight numeric;
begin

 if v_actor is null or not exists (
  select 1 from public.users u where u.id=v_actor and u.status='active'
 ) then raise exception 'Active account required' using errcode='42501'; end if;
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
end;$function$;



-- Enforce active user state: itqan_school_submit_review
CREATE OR REPLACE FUNCTION public.itqan_school_submit_review(p_review uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_review public.performance_reviews%rowtype;
 v_expected integer;v_actual integer;v_result numeric;
begin

 if v_actor is null or not exists (
  select 1 from public.users u where u.id=v_actor and u.status='active'
 ) then raise exception 'Active account required' using errcode='42501'; end if;
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
end;$function$;



-- Enforce active user state: itqan_school_exception_criteria
CREATE OR REPLACE FUNCTION public.itqan_school_exception_criteria(p_request uuid)
 RETURNS TABLE(criterion_id uuid, title_ar text, weight numeric, score_level smallint, interpretation text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_review uuid;v_author uuid;v_valid boolean;
begin
 if v_actor is null or not exists (
  select 1 from public.users u where u.id=v_actor and u.status='active'
 ) then raise exception 'Active account required' using errcode='42501'; end if;
 select r.review_id,r.requested_by,
  (r.status='approved' and r.revoked_at is null and now() between r.starts_at and r.expires_at)
 into v_review,v_author,v_valid from public.review_exception_requests r where r.id=p_request;
 if v_actor is null or v_author is distinct from v_actor or not coalesce(v_valid,false) then
  raise exception 'No active exceptional access' using errcode='42501';end if;
 return query
 select c.criterion_id,coalesce(i.title_ar,ec.title_ar),c.weight,
  s.score_level,i.interpretation
 from public.performance_reviews pr
 join public.evaluation_framework_criteria c
   on c.framework_id=pr.framework_id and c.job_title_id=pr.job_title_id and c.is_required
 join public.evaluation_criteria ec on ec.id=c.criterion_id
 left join public.evaluation_criterion_interpretations i
   on i.framework_id=c.framework_id and i.job_title_id=c.job_title_id
   and i.criterion_id=c.criterion_id
 left join public.evaluation_score_details s
   on s.performance_review_id=pr.id and s.criterion_id=c.criterion_id
 where pr.id=v_review order by c.sort_order;
end;$function$;


-- Enforce active user state: itqan_school_exception_score
CREATE OR REPLACE FUNCTION public.itqan_school_exception_score(p_request uuid, p_criterion uuid, p_level smallint, p_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_r public.review_exception_requests%rowtype;
 v_review public.performance_reviews%rowtype;v_weight numeric;
begin
 if v_actor is null or not exists (
  select 1 from public.users u where u.id=v_actor and u.status='active'
 ) then raise exception 'Active account required' using errcode='42501'; end if;
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
end;$function$;


-- Enforce active user state: itqan_school_exception_submit
CREATE OR REPLACE FUNCTION public.itqan_school_exception_submit(p_request uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_r public.review_exception_requests%rowtype;
 v_review public.performance_reviews%rowtype;v_expected integer;v_actual integer;v_score numeric;
begin
 if v_actor is null or not exists (
  select 1 from public.users u where u.id=v_actor and u.status='active'
 ) then raise exception 'Active account required' using errcode='42501'; end if;
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
end;$function$;


-- Enforce active user state: itqan_school_request_review_exception
CREATE OR REPLACE FUNCTION public.itqan_school_request_review_exception(p_review uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_review public.performance_reviews%rowtype;v_request uuid;
begin
 if v_actor is null or not exists (
  select 1 from public.users u where u.id=v_actor and u.status='active'
 ) then raise exception 'Active account required' using errcode='42501'; end if;
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
end;$function$;

