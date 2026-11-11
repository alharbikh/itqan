-- ITQAN privileged evidence review RPC — invalidate abandoned delegations.
-- A delegate's active token must not bypass disabled-account, inactive-school
-- or revoked school membership checks. Keep existing permission gates and
-- self-review ban. No existing evidence records are changed.
CREATE OR REPLACE FUNCTION public.itqan_school_review_evidence(p_evidence uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_school uuid;v_subject uuid;
begin
 select e.school_id,e.user_id into v_school,v_subject from public.evidence_records e where e.id=p_evidence;
 if v_actor is null or v_school is null or v_actor=v_subject
 or not exists(select 1 from public.users u
  where u.id=v_actor and u.status='active')
 or not exists(select 1 from public.schools s
  where s.id=v_school and s.status='active') then
  raise exception 'Forbidden' using errcode='42501';end if;
 if p_status not in ('approved','rejected','needs_changes') or length(coalesce(p_note,''))>2000 then
  raise exception 'Invalid evidence review' using errcode='22023';end if;
 if not itqan_private.has_school_permission(v_school,'school.manage_evidence_templates')
 and not exists(select 1 from public.school_review_delegations d where d.school_id=v_school
   and d.delegate_user_id=v_actor and d.subject_user_id=v_subject
   and d.scope='evidence_review' and d.revoked_at is null
   and now() between d.starts_at and d.expires_at
   and exists(select 1 from public.school_memberships m
    where m.school_id=v_school and m.user_id=v_actor and m.status='active')) then
  raise exception 'No review mandate' using errcode='42501';end if;
 update public.evidence_records set evidence_status=p_status,reviewed_by=v_actor,
   reviewed_at=now(),reviewer_notes=left(coalesce(p_note,''),2000) where id=p_evidence;
 return true;
end;$function$
;
