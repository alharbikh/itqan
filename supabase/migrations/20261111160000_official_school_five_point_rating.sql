-- One official Ministry of Education weighted five-point method for school educational roles.
-- Page 10, 1446 simplified guide: sum(level * weight/100), then round once.
-- Keep final_score_100 as a legacy historical field; never silently convert past results.
-- No generic calculation-method registry, alternate formula or per-school selector.
ALTER TABLE public.performance_reviews
 ADD COLUMN final_score_5_exact numeric(8,5),
 ADD COLUMN final_rating_5 smallint
 CONSTRAINT performance_reviews_final_rating_five_range
 CHECK (final_rating_5 IS NULL OR final_rating_5 BETWEEN 1 AND 5);

COMMENT ON COLUMN public.performance_reviews.final_score_5_exact IS
 'Exact official weighted five-level mean before rounding (educational school roles).';
COMMENT ON COLUMN public.performance_reviews.final_rating_5 IS
 'Official integer 1-5 rating rounded once from final_score_5_exact.';
COMMENT ON COLUMN public.performance_reviews.final_score_100 IS
 'Legacy percentage-shaped score from earlier ITQAN releases. Not generated for new reviews.';

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
 select count(*),coalesce(sum(score_level::numeric * weight_snapshot / 100),0)
 into v_actual,v_score
 from public.evaluation_score_details where performance_review_id=v_review.id;
 if v_expected=0 or v_actual<>v_expected then
  raise exception 'Criterion scores incomplete' using errcode='22023';end if;
 if (select coalesce(sum(weight_snapshot),0) from public.evaluation_score_details
     where performance_review_id=v_review.id)<>100 then
  raise exception 'Weights must total 100' using errcode='22023';end if;
 update public.performance_reviews set status='submitted',
 final_score_5_exact=v_score,final_rating_5=round(v_score)::smallint,
 final_score_100=null,updated_at=now()
 where id=v_review.id;
 update public.review_exception_requests set status='expired',revoked_at=now() where id=p_request;
 insert into public.review_exception_events(request_id,school_id,actor_user_id,action,details)
 values(p_request,v_r.school_id,v_actor,'submitted',jsonb_build_object('weighted_score_5',v_score,'rating_5',round(v_score)::smallint));
 return v_score;
end;$function$
;

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
 select count(*),coalesce(sum(score_level::numeric * weight_snapshot / 100),0)
 into v_actual,v_result
 from public.evaluation_score_details where performance_review_id=p_review;
 if v_expected=0 or v_actual<>v_expected then raise exception 'Criteria scores incomplete' using errcode='22023';end if;
 if (select coalesce(sum(weight_snapshot),0) from public.evaluation_score_details
     where performance_review_id=p_review)<>100 then
  raise exception 'Weights must total 100' using errcode='22023';end if;
 update public.performance_reviews set final_score_5_exact=v_result,
 final_rating_5=round(v_result)::smallint,
 final_score_100=null,status='submitted',updated_at=now()
 where id=p_review;
 return v_result;
end;$function$
;

-- Previously submitted results remain unchanged; new official submissions use 5-point columns.
