
create function itqan_private.validate_framework_publish()
returns trigger language plpgsql set search_path=''
as $$
declare v_bad_count integer;
begin
 if new.status='active' and old.status is distinct from 'active' then
  select count(*) into v_bad_count
  from public.evaluation_framework_jobs j
  left join lateral (
   select coalesce(sum(c.weight),0) as weight_total,count(*) as criterion_count
   from public.evaluation_framework_criteria c
   where c.framework_id=j.framework_id and c.job_title_id=j.job_title_id and c.is_required
  ) c on true
  where j.framework_id=new.id and j.is_active
   and (c.criterion_count=0 or c.weight_total<>100);
  if v_bad_count>0 then
    raise exception 'Cannot activate a framework: every active job title requires criteria weights totaling exactly 100';
  end if;
  if not exists (select 1 from public.evaluation_framework_jobs j where j.framework_id=new.id and j.is_active) then
    raise exception 'Cannot activate a framework without job titles';
  end if;
 end if;
 if old.status='active' and
    (new.status<>'archived' or new.code<>old.code or new.version_no<>old.version_no
     or new.title_ar<>old.title_ar or new.academic_year is distinct from old.academic_year
     or new.effective_from is distinct from old.effective_from
     or new.effective_to is distinct from old.effective_to)
 then raise exception 'An active evaluation framework is immutable; create a new version';
 end if;
 return new;
end;
$$;
create trigger framework_publish_guard before update on public.evaluation_frameworks
for each row execute function itqan_private.validate_framework_publish();
create function itqan_private.lock_published_framework_contents()
returns trigger language plpgsql set search_path=''
as $$
declare v_id uuid;
begin
 v_id:=case when tg_op='DELETE' then old.framework_id else new.framework_id end;
 if exists (select 1 from public.evaluation_frameworks f where f.id=v_id and f.status in ('active','archived')) then
  raise exception 'Cannot change an active or archived framework: create a new version';
 end if;
 if tg_op='UPDATE' and old.framework_id is distinct from new.framework_id
    and exists(select 1 from public.evaluation_frameworks f where f.id=old.framework_id and f.status in ('active','archived')) then
  raise exception 'Cannot move content from published framework';
 end if;
 return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger framework_jobs_immutable before insert or update or delete
on public.evaluation_framework_jobs for each row
execute function itqan_private.lock_published_framework_contents();
create trigger framework_criteria_immutable before insert or update or delete
on public.evaluation_framework_criteria for each row
execute function itqan_private.lock_published_framework_contents();
create trigger framework_rubric_immutable before insert or update or delete
on public.criterion_rating_descriptors for each row
execute function itqan_private.lock_published_framework_contents();

-- Validate evaluation details against the exact job/framework and frozen weight.
create function itqan_private.validate_evaluation_score_detail()
returns trigger language plpgsql set search_path=''
as $$
declare v_framework uuid;v_job uuid;v_weight numeric(6,3);v_status text;
begin
 if new.self_evaluation_id is not null then
  select e.framework_id,e.job_title_id,e.status into v_framework,v_job,v_status
  from public.self_evaluations e where e.id=new.self_evaluation_id;
 else
  select e.framework_id,e.job_title_id,e.status into v_framework,v_job,v_status
  from public.performance_reviews e where e.id=new.performance_review_id;
 end if;
 if v_framework is distinct from new.framework_id or v_job is distinct from new.job_title_id then
  raise exception 'Evaluation score does not match its parent job/framework';
 end if;
 if v_status not in ('draft') then
  raise exception 'Evaluation score can only be edited while draft';
 end if;
 select weight into v_weight from public.evaluation_framework_criteria c
 where c.framework_id=new.framework_id and c.job_title_id=new.job_title_id
 and c.criterion_id=new.criterion_id and c.is_required;
 if v_weight is null or v_weight<>new.weight_snapshot then
  raise exception 'Evaluation score weight does not match its framework criterion';
 end if;
 return new;
end;
$$;
create trigger evaluation_score_guard before insert or update on public.evaluation_score_details
for each row execute function itqan_private.validate_evaluation_score_detail();

-- No client can invoke internal validation helpers over REST.
revoke all on all functions in schema itqan_private from public,anon,authenticated;
-- Restore only explicit permission-check helpers required by existing RLS.
grant execute on function itqan_private.has_system_permission(text) to authenticated;
grant execute on function itqan_private.has_school_permission(uuid,text) to authenticated;

create index on public.evaluation_frameworks(created_by);
create index on public.evaluation_framework_criteria(job_title_id);
create index on public.criterion_rating_descriptors(job_title_id);
create index on public.evaluation_score_details(criterion_id);
create index on public.evaluation_score_details(job_title_id);
create index on public.evaluation_periods(school_id);
