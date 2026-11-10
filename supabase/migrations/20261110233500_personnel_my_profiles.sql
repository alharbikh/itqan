-- Only the employee may discover their own approved school profile identifiers.
create or replace function public.itqan_personnel_my_profiles()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_profiles jsonb;
begin
 if v_actor is null then raise exception 'Forbidden' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'school_id',p.school_id,
  'school_name',s.name,'employee_number',p.employee_number,'status',p.status)
 order by p.created_at desc),'[]'::jsonb) into v_profiles
 from public.school_personnel_profiles p join public.schools s on s.id=p.school_id
 join public.employees e on e.id=p.employee_id where e.user_id=v_actor;
 return v_profiles;
end;$$;
revoke all on function public.itqan_personnel_my_profiles() from public,anon;
grant execute on function public.itqan_personnel_my_profiles() to authenticated;
