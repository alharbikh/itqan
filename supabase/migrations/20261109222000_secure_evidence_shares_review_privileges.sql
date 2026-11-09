-- #15: break the RLS dependency cycle between evidence owners and their share entries.
create function itqan_private.owns_personal_evidence(p_evidence uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.personal_evidence e
 where e.id=p_evidence and e.user_id=p_user); $$;
revoke all on function itqan_private.owns_personal_evidence(uuid,uuid) from public,anon,authenticated;
grant execute on function itqan_private.owns_personal_evidence(uuid,uuid) to authenticated;

drop policy personal_shares_insert on public.personal_evidence_shares;
create policy personal_shares_insert on public.personal_evidence_shares
for insert to authenticated with check (
 user_id=(select auth.uid()) and
 (select itqan_private.has_school_permission(school_id,'self.manage_portfolio')) and
 (select itqan_private.owns_personal_evidence(evidence_id,(select auth.uid())))
);

-- #16: no direct PostgREST UPDATE can bypass the criterion-based scoring and approval RPCs.
revoke update(criteria_scores,status,notes,visible_to_employee,published_at,updated_at)
 on public.performance_reviews from authenticated;
drop policy if exists review_update on public.performance_reviews;

-- #12: do not disclose old-school account linkage through a new school's staff directory.
create or replace function public.itqan_school_list_personnel(p_school uuid)
returns table(school_employee_id uuid,employee_name text,linked_user_id uuid,
 placement_status text,year_label text)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not itqan_private.has_school_permission(p_school,'school.manage_members') then
  raise exception 'Forbidden' using errcode='42501';end if;
 return query
 select se.id,e.full_name,
   case when exists(select 1 from public.school_memberships m where m.school_id=p_school
    and m.user_id=e.user_id and m.status='active') then e.user_id else null::uuid end,
   se.status,y.label
 from public.school_employees se join public.employees e on e.id=se.employee_id
 join public.academic_years y on y.id=se.academic_year_id
 where se.school_id=p_school order by se.created_at desc limit 500;
end;$$;
