-- #47: principal-owned atomic personnel import from a validated preview.
-- Each call handles at most 50 records. Existing records are never overwritten.
create or replace function public.itqan_school_import_profiles(
 p_school uuid, p_year uuid, p_rows jsonb
) returns jsonb
language plpgsql security definer
set search_path = ''
as $fn$
declare
 v_actor uuid:=auth.uid();
 v_row jsonb;
 v_number text;
 v_national text;
 v_name text;
 v_specialization text;
 v_job uuid;
 v_existing uuid;
 v_existing_national text;
 v_created integer:=0;
 v_skipped integer:=0;
 v_numbers text[]:=array[]::text[];
 v_nationals text[]:=array[]::text[];
begin
 if v_actor is null
   or not itqan_private.has_school_permission(p_school,'school.manage_members') then
   raise exception 'Forbidden' using errcode='42501';
 end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array'
   or jsonb_array_length(p_rows) not between 1 and 50 then
   raise exception 'Invalid import size' using errcode='22023';
 end if;
 for v_row in select value from jsonb_array_elements(p_rows) loop
   if jsonb_typeof(v_row)<>'object' or exists (
     select 1 from jsonb_object_keys(v_row) as k(key)
     where k.key not in ('full_name','employee_number','national_id','specialization','job_title_id')
   ) then
      raise exception 'Unsupported import columns' using errcode='22023';
   end if;
   v_name:=btrim(coalesce(v_row->>'full_name',''));
   v_number:=btrim(coalesce(v_row->>'employee_number',''));
   v_national:=btrim(coalesce(v_row->>'national_id',''));
   v_specialization:=nullif(btrim(coalesce(v_row->>'specialization','')),'');
   if length(v_name) not between 2 and 200 or
      length(v_number) not between 1 and 80 or
      v_national !~ '^[0-9]{10}$' or length(coalesce(v_specialization,''))>120 then
      raise exception 'Invalid import record' using errcode='22023';
   end if;
   if v_number=any(v_numbers) or v_national=any(v_nationals) then
      raise exception 'Duplicate record within import' using errcode='23505';
   end if;
   v_numbers:=array_append(v_numbers,v_number);
   v_nationals:=array_append(v_nationals,v_national);
   v_job:=nullif(v_row->>'job_title_id','')::uuid;
   select p.id,e.national_id into v_existing,v_existing_national
   from public.school_personnel_profiles p
   join public.employees e on e.id=p.employee_id
   where p.school_id=p_school and p.employee_number=v_number;
   if v_existing is not null then
     if v_existing_national is distinct from v_national then
       raise exception 'Employee number already assigned to another identity'
         using errcode='23505';
     end if;
     v_skipped:=v_skipped+1;
   else
     if exists (
       select 1 from public.school_personnel_profiles p
       join public.employees e on e.id=p.employee_id
       where p.school_id=p_school and e.national_id=v_national
     ) then
       raise exception 'Identity already has a profile in this school'
         using errcode='23505';
     end if;
     perform public.itqan_school_create_profile(
       p_school,p_year,v_name,v_national,v_number,v_job,v_specialization);
     v_created:=v_created+1;
   end if;
 end loop;
 return jsonb_build_object('created',v_created,'skipped',v_skipped);
end
$fn$;
revoke all on function public.itqan_school_import_profiles(uuid,uuid,jsonb) from public,anon;
grant execute on function public.itqan_school_import_profiles(uuid,uuid,jsonb) to authenticated;
