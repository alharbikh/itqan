-- Ensure privileged subject approvals and delegation controls respect
-- the current account status, not only the authenticated JWT subject.
-- The existing school permission, role and audit rules remain intact.
-- Based on the deployed RPC definitions at the audit date; no data is changed.
-- itqan_profile_operation_decide
CREATE OR REPLACE FUNCTION public.itqan_profile_operation_decide(p_operation uuid, p_approval_type text, p_decision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_op public.school_profile_operations%rowtype;
 v_subject uuid;v_fields jsonb;
begin
 if v_actor is null or not exists (
  select 1 from public.users u where u.id=v_actor and u.status='active'
 ) then raise exception 'Active account required' using errcode='42501';end if;
 select * into v_op from public.school_profile_operations where id=p_operation for update;
 if v_actor is null or v_op.id is null or v_op.status not in ('pending','approved') then
  raise exception 'Operation unavailable' using errcode='22023';end if;
 if p_approval_type not in ('subject','source_school_owner') or
   p_decision not in ('approved','rejected') then
  raise exception 'Invalid approval' using errcode='22023';end if;
 select e.user_id into v_subject from public.school_personnel_profiles p
 join public.employees e on e.id=p.employee_id where p.id=v_op.source_profile_id;
 if (p_approval_type='subject' and (v_subject is null or v_actor<>v_subject))
  or (p_approval_type='source_school_owner' and
    not itqan_private.has_school_permission(v_op.source_school_id,'school.manage_members')) then
  raise exception 'Forbidden' using errcode='42501';end if;
 if exists(select 1 from public.school_profile_operation_approvals a
   where a.operation_id=p_operation and a.approval_type=p_approval_type) then
  raise exception 'Approval already recorded' using errcode='22023';end if;
 v_fields:=v_op.selected_fields;
 insert into public.school_profile_operation_approvals(
   operation_id,approval_type,approver_user_id,decision,approved_fields)
 values(p_operation,p_approval_type,v_actor,p_decision,v_fields);
 if p_decision='rejected' then
  update public.school_profile_operations set status='rejected',updated_at=now() where id=p_operation;
 elsif (select count(*) from public.school_profile_operation_approvals
    where operation_id=p_operation and decision='approved')=2 then
  update public.school_profile_operations set status='approved',updated_at=now() where id=p_operation;
 end if;
 insert into public.site_admin_audit(actor_user_id,operation,target_type,target_id,details)
 values(v_actor,'personnel.operation.consent','personnel_operation',p_operation,
  jsonb_build_object('approval_type',p_approval_type,'decision',p_decision));
 return jsonb_build_object('status',p_decision);
end;$function$
;

-- itqan_school_grant_review_delegation
CREATE OR REPLACE FUNCTION public.itqan_school_grant_review_delegation(p_school uuid, p_delegate uuid, p_subject uuid, p_scope text, p_expiry timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_id uuid;
begin
 if v_actor is null or not itqan_private.has_school_permission(p_school,'school.manage_members') then
  raise exception 'Forbidden' using errcode='42501';end if;
 if p_scope not in ('evidence_review','performance_scoring') or
    p_delegate=v_actor or p_delegate=p_subject or p_subject=v_actor or
    p_expiry<=now() or p_expiry>now()+interval '60 days' then
  raise exception 'Invalid delegated review' using errcode='22023';end if;
 if not exists(select 1 from public.school_memberships m
  join public.users u on u.id=m.user_id and u.status='active'
  where m.school_id=p_school and m.user_id=p_delegate and m.status='active')
 or not exists(select 1 from public.school_memberships m
  join public.users u on u.id=m.user_id and u.status='active'
  where m.school_id=p_school and m.user_id=p_subject and m.status='active') then
   raise exception 'Delegation must be inside current school' using errcode='22023';end if;
 insert into public.school_review_delegations(school_id,granted_by,delegate_user_id,subject_user_id,scope,expires_at)
 values(p_school,v_actor,p_delegate,p_subject,p_scope,p_expiry) returning id into v_id;
 return v_id;
end;$function$
;

-- itqan_school_revoke_review_delegation
CREATE OR REPLACE FUNCTION public.itqan_school_revoke_review_delegation(p_delegation uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_school uuid;v_grantor uuid;
begin
 if v_actor is null or not exists (
  select 1 from public.users u where u.id=v_actor and u.status='active'
 ) then raise exception 'Active account required' using errcode='42501';end if;
 select school_id,granted_by into v_school,v_grantor from public.school_review_delegations where id=p_delegation;
 if v_school is null or v_actor is null or (v_actor<>v_grantor and
  not itqan_private.has_school_permission(v_school,'school.manage_members')) then
   raise exception 'Forbidden' using errcode='42501';end if;
 update public.school_review_delegations set revoked_at=now() where id=p_delegation and revoked_at is null;
 return true;
end;$function$
;
