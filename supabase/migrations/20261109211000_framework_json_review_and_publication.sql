-- #13: staged framework import from structured JSON; principal cannot modify the official catalog.
create table public.framework_import_batches (
 id uuid primary key default gen_random_uuid(),
 payload jsonb not null,
 framework_id uuid references public.evaluation_frameworks(id) on delete restrict,
 status text not null default 'draft' check(status in ('draft','approved','published','rejected')),
 created_by uuid not null references public.users(id) on delete restrict,
 reviewed_by uuid references public.users(id) on delete restrict,
 review_note text,
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 check (jsonb_typeof(payload)='object')
);
create index framework_import_batches_status_idx on public.framework_import_batches(status,created_at desc);
alter table public.framework_import_batches enable row level security;
revoke all on public.framework_import_batches from public,anon,authenticated;
grant select on public.framework_import_batches to authenticated;
create policy framework_import_batches_admin_read on public.framework_import_batches
 for select to authenticated using((select itqan_private.has_system_permission('system.manage_roles')));

-- Version-specific interpretations. Base criterion code/title remain reusable.
create table public.evaluation_criterion_interpretations (
 framework_id uuid not null,
 job_title_id uuid not null,
 criterion_id uuid not null,
 title_ar text not null,
 interpretation text,
 source_page text,
 primary key(framework_id,job_title_id,criterion_id),
 foreign key(framework_id,job_title_id,criterion_id)
  references public.evaluation_framework_criteria(framework_id,job_title_id,criterion_id) on delete cascade
);
create trigger framework_interpretations_immutable
before insert or update or delete on public.evaluation_criterion_interpretations
for each row execute function itqan_private.lock_published_framework_contents();
alter table public.evaluation_criterion_interpretations enable row level security;
revoke all on public.evaluation_criterion_interpretations from public,anon,authenticated;
grant select on public.evaluation_criterion_interpretations to authenticated;
create policy framework_interpretations_published_read on public.evaluation_criterion_interpretations
for select to authenticated using(exists(select 1 from public.evaluation_frameworks f
 where f.id=framework_id and f.status='active'));

create function public.itqan_admin_stage_framework(p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_id uuid;
begin
 if v_actor is null or not itqan_private.has_system_permission('system.manage_roles') then
  raise exception 'Forbidden' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or
    jsonb_typeof(p_payload->'jobs') is distinct from 'array' or
    jsonb_array_length(p_payload->'jobs')=0 or
    length(p_payload::text)>300000 then
  raise exception 'Invalid framework import payload' using errcode='22023';end if;
 insert into public.framework_import_batches(payload,created_by)
 values(p_payload,v_actor) returning id into v_id;
 return v_id;
end;$$;

create function public.itqan_admin_replace_framework_draft(p_batch uuid,p_payload jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();
begin
 if v_actor is null or not itqan_private.has_system_permission('system.manage_roles') then
  raise exception 'Forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or
    jsonb_typeof(p_payload->'jobs') is distinct from 'array' or
    jsonb_array_length(p_payload->'jobs')=0 or length(p_payload::text)>300000 then
  raise exception 'Invalid framework import payload' using errcode='22023';end if;
 update public.framework_import_batches set payload=p_payload where id=p_batch and status='draft';
 if not found then raise exception 'Draft not found' using errcode='22023';end if;
 return true;
end;$$;

-- Review / apply creates a NEW draft framework. Publication is a separate decision.
create function public.itqan_admin_approve_framework(p_batch uuid,p_note text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=auth.uid();b public.framework_import_batches%rowtype;
 p jsonb; j jsonb; c jsonb; d jsonb;
 v_framework uuid;v_job uuid;v_criterion uuid;v_total numeric;
 v_code text;v_title text;v_weight numeric;v_level int;
begin
 if v_actor is null or not itqan_private.has_system_permission('system.manage_roles') then
  raise exception 'Forbidden' using errcode='42501';end if;
 select * into b from public.framework_import_batches where id=p_batch for update;
 if not found or b.status<>'draft' then raise exception 'Draft batch not found' using errcode='22023';end if;
 p:=b.payload;
 if nullif(btrim(p->>'code'),'') is null or nullif(btrim(p->>'title_ar'),'') is null or
    coalesce(p->>'version_no','') !~ '^[1-9][0-9]*$' or
    jsonb_typeof(p->'jobs') is distinct from 'array' or
    jsonb_array_length(p->'jobs')=0 then
  raise exception 'Invalid framework metadata' using errcode='22023';end if;
 insert into public.evaluation_frameworks(code,version_no,title_ar,academic_year,source_reference,status,created_by)
 values(p->>'code',(p->>'version_no')::int,p->>'title_ar',p->>'academic_year',p->>'source_reference','draft',v_actor)
 returning id into v_framework;
 for j in select value from jsonb_array_elements(p->'jobs') loop
  v_code:=nullif(btrim(j->>'code'),'');v_title:=nullif(btrim(j->>'title_ar'),'');
  if v_code is null or v_title is null or jsonb_typeof(j->'criteria') is distinct from 'array'
    or jsonb_array_length(j->'criteria')=0 then
    raise exception 'Invalid job in framework' using errcode='22023';end if;
  insert into public.job_titles(code,title_ar,category)
  values(v_code,v_title,'employee') on conflict(code) do nothing;
  select id into v_job from public.job_titles where code=v_code;
  insert into public.evaluation_framework_jobs(framework_id,job_title_id) values(v_framework,v_job);
  v_total:=0;
  for c in select value from jsonb_array_elements(j->'criteria') loop
   v_code:=nullif(btrim(c->>'code'),'');v_title:=nullif(btrim(c->>'title_ar'),'');
   if v_code is null or v_title is null or coalesce(c->>'weight','') !~ '^[0-9]+(\.[0-9]{1,3})?$' then
     raise exception 'Invalid criterion' using errcode='22023';end if;
   v_weight:=(c->>'weight')::numeric;
   if v_weight>100 then raise exception 'Weight exceeds 100' using errcode='22023';end if;
   v_total:=v_total+v_weight;
   insert into public.evaluation_criteria(code,title_ar,is_common,category)
   values(v_code,v_title,coalesce((c->>'is_common')::boolean,false),c->>'category')
   on conflict(code) do nothing;
   select id into v_criterion from public.evaluation_criteria where code=v_code;
   insert into public.evaluation_framework_criteria(framework_id,job_title_id,criterion_id,weight,sort_order,is_required)
   values(v_framework,v_job,v_criterion,v_weight,(select count(*)+1 from public.evaluation_framework_criteria
      where framework_id=v_framework and job_title_id=v_job),true);
   insert into public.evaluation_criterion_interpretations(framework_id,job_title_id,criterion_id,title_ar,interpretation,source_page)
   values(v_framework,v_job,v_criterion,v_title,c->>'interpretation',c->>'source_page');
   if jsonb_typeof(c->'descriptors')='array' then
    for d in select value from jsonb_array_elements(c->'descriptors') loop
     if coalesce(d->>'level','') !~ '^[1-5]$' or nullif(btrim(d->>'text'),'') is null then
      raise exception 'Invalid rating descriptor' using errcode='22023';end if;
     v_level:=(d->>'level')::int;
     insert into public.criterion_rating_descriptors(framework_id,job_title_id,criterion_id,score_level,descriptor)
     values(v_framework,v_job,v_criterion,v_level,d->>'text');
    end loop;
   end if;
  end loop;
  if v_total<>100 then raise exception 'Job weights must total 100 percent' using errcode='22023';end if;
 end loop;
 update public.framework_import_batches set status='approved',framework_id=v_framework,
  reviewed_by=v_actor,reviewed_at=now(),review_note=left(coalesce(p_note,''),2000) where id=p_batch;
 return v_framework;
end;$$;

create function public.itqan_admin_publish_framework(p_batch uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_framework uuid;
begin
 if v_actor is null or not itqan_private.has_system_permission('system.manage_roles') then
  raise exception 'Forbidden' using errcode='42501';end if;
 select framework_id into v_framework from public.framework_import_batches
 where id=p_batch and status='approved' for update;
 if v_framework is null then raise exception 'Approved framework not found' using errcode='22023';end if;
 update public.evaluation_frameworks set status='active',published_at=now()
 where id=v_framework and status='draft';
 if not found then raise exception 'Framework is not a draft' using errcode='22023';end if;
 update public.framework_import_batches set status='published' where id=p_batch;
 return v_framework;
end;$$;

revoke all on function public.itqan_admin_stage_framework(jsonb) from public,anon;
revoke all on function public.itqan_admin_replace_framework_draft(uuid,jsonb) from public,anon;
revoke all on function public.itqan_admin_approve_framework(uuid,text) from public,anon;
revoke all on function public.itqan_admin_publish_framework(uuid) from public,anon;
grant execute on function public.itqan_admin_stage_framework(jsonb) to authenticated;
grant execute on function public.itqan_admin_replace_framework_draft(uuid,jsonb) to authenticated;
grant execute on function public.itqan_admin_approve_framework(uuid,text) to authenticated;
grant execute on function public.itqan_admin_publish_framework(uuid) to authenticated;
