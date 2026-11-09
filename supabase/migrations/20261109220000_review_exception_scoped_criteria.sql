-- #16: review-specific criterion rubric for an approved, time-limited exception.
-- No general read access to the former school's records is restored.
create function public.itqan_school_exception_criteria(p_request uuid)
returns table(criterion_id uuid,title_ar text,weight numeric,score_level smallint,interpretation text)
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_review uuid;v_author uuid;v_valid boolean;
begin
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
end;$$;
revoke all on function public.itqan_school_exception_criteria(uuid) from public,anon;
grant execute on function public.itqan_school_exception_criteria(uuid) to authenticated;
