-- Authenticated users may choose an active school without learning its members.
create or replace function public.itqan_personnel_school_catalog()
returns table(id uuid,name text,education_stage text,education_department text)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists
  (select 1 from public.users where users.id=auth.uid() and status='active') then
  raise exception 'Forbidden' using errcode='42501';end if;
 return query select s.id,s.name,s.education_stage,s.education_department
 from public.schools s where s.status='active' order by s.name limit 500;
end;$$;
revoke all on function public.itqan_personnel_school_catalog() from public,anon;
grant execute on function public.itqan_personnel_school_catalog() to authenticated;
