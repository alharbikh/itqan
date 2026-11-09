-- Track normal school create/edit operations, including operations from the site admin UI.
alter table public.site_admin_audit
  drop constraint site_admin_audit_operation_check;
alter table public.site_admin_audit
  add constraint site_admin_audit_operation_check
  check(operation in ('school.create','school.update','school.delete','school.status','membership.upsert','user.status'));

create function itqan_private.audit_school_writes()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_actor uuid := auth.uid();
begin
  -- Maintenance SQL executed by postgres has no end-user JWT; do not block it.
  if v_actor is null then return new; end if;
  if TG_OP='INSERT' then
    insert into public.site_admin_audit(actor_user_id,operation,target_type,target_id,details)
    values(v_actor,'school.create','school',new.id,jsonb_build_object('name',new.name));
  elsif TG_OP='UPDATE' and (old.name,old.education_stage,old.gender,old.ministry_number,old.education_department)
    is distinct from (new.name,new.education_stage,new.gender,new.ministry_number,new.education_department) then
    insert into public.site_admin_audit(actor_user_id,operation,target_type,target_id,details)
    values(v_actor,'school.update','school',new.id,
      jsonb_build_object('name_before',old.name,'name_after',new.name));
  end if;
  return new;
end $$;

revoke all on function itqan_private.audit_school_writes() from public,anon,authenticated;
create trigger audit_school_create_edit
after insert or update on public.schools
for each row execute function itqan_private.audit_school_writes();
