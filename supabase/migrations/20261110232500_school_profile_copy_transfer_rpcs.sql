-- ITQAN #12: consent-controlled school personnel copy and transfer.
alter table public.school_profile_operations
 add column target_employee_number text;
alter table public.school_profile_operations
 add constraint school_profile_operations_target_number_valid
 check (target_employee_number is null or
  (length(target_employee_number) between 1 and 80
   and target_employee_number=btrim(target_employee_number)));

create or replace function public.itqan_profile_operation_start(
 p_source uuid,p_target_school uuid,p_operation text,p_employee_number text,p_fields jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_source public.school_personnel_profiles%rowtype;v_id uuid;
begin
 if v_actor is null or
 not itqan_private.has_school_permission(p_target_school,'school.manage_members') then
  raise exception 'Forbidden' using errcode='42501';end if;
 if p_operation not in ('copy','transfer') or
 length(btrim(coalesce(p_employee_number,''))) not between 1 and 80 then
  raise exception 'Invalid operation' using errcode='22023';end if;
 if p_fields is null or jsonb_typeof(p_fields)<>'array'
  or jsonb_array_length(p_fields) not between 1 and 5
  or not (p_fields ? 'full_name_snapshot')
  or (select count(*) from jsonb_array_elements_text(p_fields) f
      where f not in ('full_name_snapshot','specialization','job_title_id','started_on'))>0
  or (select count(distinct f) from jsonb_array_elements_text(p_fields) f)
    <>jsonb_array_length(p_fields) then
  raise exception 'Invalid field selection' using errcode='22023';end if;
 select * into v_source from public.school_personnel_profiles where id=p_source;
 if v_source.id is null or v_source.school_id=p_target_school or
 not exists(select 1 from public.schools where id=p_target_school and status='active') then
  raise exception 'Invalid source or destination' using errcode='22023';end if;
 if exists(select 1 from public.school_personnel_profiles where
 school_id=p_target_school and employee_number=btrim(p_employee_number)) then
  raise exception 'Duplicate destination number' using errcode='23505';end if;
 insert into public.school_profile_operations(
 operation_type,source_profile_id,source_school_id,target_school_id,
 selected_fields,target_employee_number,requested_by)
 values(p_operation,p_source,v_source.school_id,p_target_school,
 p_fields,btrim(p_employee_number),v_actor) returning id into v_id;
 return v_id;
end;$$;

create or replace function public.itqan_profile_operation_list(p_school uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_result jsonb;
begin
 if v_actor is null then raise exception 'Forbidden' using errcode='42501';end if;
 if p_school is not null and not itqan_private.has_school_permission(p_school,'school.manage_members') then
  raise exception 'Forbidden' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',o.id,'operation_type',o.operation_type,'source_school_id',o.source_school_id,
  'source_school_name',ss.name,'target_school_id',o.target_school_id,
  'target_school_name',ts.name,'status',o.status,'selected_fields',o.selected_fields,
  'target_employee_number',o.target_employee_number,'created_at',o.created_at,
  'subject_approved',exists(select 1 from public.school_profile_operation_approvals a
     where a.operation_id=o.id and a.approval_type='subject' and a.decision='approved'),
  'source_approved',exists(select 1 from public.school_profile_operation_approvals a
     where a.operation_id=o.id and a.approval_type='source_school_owner' and a.decision='approved')
 ) order by o.created_at desc),'[]'::jsonb) into v_result
 from public.school_profile_operations o
 join public.school_personnel_profiles p on p.id=o.source_profile_id
 join public.employees e on e.id=p.employee_id
 join public.schools ss on ss.id=o.source_school_id
 join public.schools ts on ts.id=o.target_school_id
 where (p_school is null and e.user_id=v_actor)
    or (p_school is not null and p_school in(o.source_school_id,o.target_school_id));
 return v_result;
end;$$;

create or replace function public.itqan_profile_operation_decide(
 p_operation uuid,p_approval_type text,p_decision text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_op public.school_profile_operations%rowtype;
 v_subject uuid;v_fields jsonb;
begin
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
end;$$;

create or replace function public.itqan_profile_operation_execute(p_operation uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_op public.school_profile_operations%rowtype;
 v_src public.school_personnel_profiles%rowtype;v_target uuid;
begin
 select * into v_op from public.school_profile_operations where id=p_operation for update;
 if v_actor is null or v_op.id is null or v_op.status<>'approved' or
  not itqan_private.has_school_permission(v_op.target_school_id,'school.manage_members') then
  raise exception 'Operation unavailable' using errcode='42501';end if;
 if (select count(*) from public.school_profile_operation_approvals
  where operation_id=p_operation and decision='approved'
    and approved_fields=v_op.selected_fields)=2 is not true then
  raise exception 'Two matching consents required' using errcode='42501';end if;
 select * into v_src from public.school_personnel_profiles
  where id=v_op.source_profile_id for update;
 if v_src.id is null or v_src.school_id<>v_op.source_school_id then
  raise exception 'Source changed' using errcode='22023';end if;
 if v_op.operation_type='transfer' then
  if v_src.status<>'active' then raise exception 'Source not active' using errcode='22023';end if;
  if exists(select 1 from public.school_memberships m where
   m.school_id=v_src.school_id and m.status='active' and
   (m.personnel_profile_id=v_src.id or m.employee_id=v_src.employee_id)) then
   raise exception 'Unlink active membership before transfer' using errcode='23505';end if;
 end if;
 if exists(select 1 from public.school_personnel_profiles
  where school_id=v_op.target_school_id and employee_id=v_src.employee_id) then
  raise exception 'Destination already has personnel record' using errcode='23505';end if;
 insert into public.school_personnel_profiles(
  school_id,employee_id,employee_number,full_name_snapshot,job_title_id,
  specialization,started_on,source_profile_id,created_by,approved_by)
 values(v_op.target_school_id,v_src.employee_id,v_op.target_employee_number,
  v_src.full_name_snapshot,
  case when v_op.selected_fields ? 'job_title_id' then v_src.job_title_id else null end,
  case when v_op.selected_fields ? 'specialization' then v_src.specialization else null end,
  case when v_op.selected_fields ? 'started_on' then v_src.started_on else null end,
  v_src.id,v_actor,v_actor) returning id into v_target;
 if v_op.operation_type='transfer' then
  update public.school_personnel_profiles set status='historical',ended_on=current_date,updated_at=now()
   where id=v_src.id;
  update public.school_employees set status='transferred',ends_on=current_date
   where personnel_profile_id=v_src.id and status='active';
 end if;
 update public.school_profile_operations
  set status='completed',target_profile_id=v_target,executed_at=now(),updated_at=now()
  where id=p_operation;
 insert into public.site_admin_audit(actor_user_id,operation,target_type,target_id,details)
 values(v_actor,'personnel.operation.completed','personnel_operation',p_operation,
  jsonb_build_object('source_school',v_src.school_id,'target_school',v_op.target_school_id,
   'target_profile',v_target,'kind',v_op.operation_type));
 return v_target;
end;$$;

revoke all on function public.itqan_profile_operation_start(uuid,uuid,text,text,jsonb) from public,anon;
revoke all on function public.itqan_profile_operation_list(uuid) from public,anon;
revoke all on function public.itqan_profile_operation_decide(uuid,text,text) from public,anon;
revoke all on function public.itqan_profile_operation_execute(uuid) from public,anon;
grant execute on function public.itqan_profile_operation_start(uuid,uuid,text,text,jsonb) to authenticated;
grant execute on function public.itqan_profile_operation_list(uuid) to authenticated;
grant execute on function public.itqan_profile_operation_decide(uuid,text,text) to authenticated;
grant execute on function public.itqan_profile_operation_execute(uuid) to authenticated;
