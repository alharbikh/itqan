-- ITQAN: review scoring is authorized by current employment status, not
-- just a previously issued delegation or reviewer_user_id snapshot.
-- Preserve the active-account check from migration 20261111114500.
-- Existing reviews and scores are unchanged.
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
 if v_actor=v_review.reviewer_user_id then
   -- Original evaluator must retain their school's review permission.
   if not itqan_private.has_school_permission(v_review.school_id,'school.manage_reviews') then
     raise exception 'Review permission no longer available' using errcode='42501';
   end if;
 elsif not exists(
  select 1 from public.school_review_delegations d
  join public.school_memberships m on m.school_id=d.school_id and m.user_id=d.delegate_user_id
  join public.schools sc on sc.id=d.school_id
  where d.school_id=v_review.school_id
   and d.delegate_user_id=v_actor and d.subject_user_id=v_review.subject_user_id
   and d.scope='performance_scoring' and d.revoked_at is null
   and now() between d.starts_at and d.expires_at
   and m.status='active' and sc.status='active') then
   raise exception 'No active scoring mandate' using errcode='42501';
 end if;
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
end;$function$
;
