-- Read-only year catalog and scoped school employee listing for the approved workflows.
grant select on public.academic_years to authenticated;
create policy academic_year_catalog_read on public.academic_years
 for select to authenticated using(true);

create function public.itqan_admin_create_academic_year(
 p_label text,p_start date,p_end date,p_current boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_year uuid;
begin
 if v_actor is null or not itqan_private.has_system_permission('system.manage_roles') then
  raise exception 'Forbidden' using errcode='42501';end if;
 if length(btrim(coalesce(p_label,''))) not between 4 and 100 or
  p_start is null or p_end is null or p_start>=p_end then
  raise exception 'Invalid academic year' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext('itqan:academic_year'));
 if p_current then update public.academic_years set is_current=false where is_current;end if;
 insert into public.academic_years(label,starts_on,ends_on,is_current)
 values(btrim(p_label),p_start,p_end,coalesce(p_current,false)) returning id into v_year;
 return v_year;
end;$$;
create function public.itqan_school_list_personnel(p_school uuid)
returns table(school_employee_id uuid,employee_name text,linked_user_id uuid,
 placement_status text,year_label text)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not itqan_private.has_school_permission(p_school,'school.manage_members') then
  raise exception 'Forbidden' using errcode='42501';end if;
 return query
 select se.id,e.full_name,e.user_id,se.status,y.label
 from public.school_employees se join public.employees e on e.id=se.employee_id
 join public.academic_years y on y.id=se.academic_year_id
 where se.school_id=p_school order by se.created_at desc limit 500;
end;$$;
revoke all on function public.itqan_admin_create_academic_year(text,date,date,boolean) from public,anon;
revoke all on function public.itqan_school_list_personnel(uuid) from public,anon;
grant execute on function public.itqan_admin_create_academic_year(text,date,date,boolean) to authenticated;
grant execute on function public.itqan_school_list_personnel(uuid) to authenticated;
