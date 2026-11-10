-- #17 - private personal-evidence attachments, never published to anonymous users.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('itqan-personal-evidence','itqan-personal-evidence',false,5242880,
 ARRAY['application/pdf','image/png','image/jpeg','image/webp',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,
 allowed_mime_types=excluded.allowed_mime_types;

create table public.personal_evidence_attachments (
 id uuid primary key,
 evidence_id uuid not null references public.personal_evidence(id) on delete cascade,
 user_id uuid not null references public.users(id) on delete restrict,
 object_name text not null unique,
 original_filename text not null check (length(original_filename) between 1 and 200),
 mime_type text not null check (mime_type in ('application/pdf','image/png','image/jpeg','image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
 byte_size integer not null check (byte_size between 1 and 5242880),
 created_at timestamptz not null default now(),
 deleted_at timestamptz,
 constraint object_key_scoped_to_owner check (
  object_name like user_id::text || '/' || evidence_id::text || '/' || id::text || '.%')
);
create index personal_evidence_attachments_owner_idx on public.personal_evidence_attachments
 (user_id,evidence_id,created_at desc) where deleted_at is null;

-- RLS helpers avoid recursive evaluation between storage.objects and attachment metadata.
create function itqan_private.storage_evidence_exists(p_key text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from storage.objects o where o.bucket_id='itqan-personal-evidence'
   and o.name=p_key);
$$;
create function itqan_private.may_read_evidence_attachment(p_key text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.personal_evidence_attachments a
  where a.object_name=p_key and a.deleted_at is null
  and (
   a.user_id=(select auth.uid())
   or exists(
    select 1 from public.personal_evidence_shares s
    where s.evidence_id=a.evidence_id and s.revoked_at is null
      and (select itqan_private.has_school_permission(s.school_id,'school.view_portfolios'))
   )
  )
 );
$$;
revoke all on function itqan_private.storage_evidence_exists(text) from public,anon,authenticated;
revoke all on function itqan_private.may_read_evidence_attachment(text) from public,anon,authenticated;
grant execute on function itqan_private.storage_evidence_exists(text) to authenticated;
grant execute on function itqan_private.may_read_evidence_attachment(text) to authenticated;

alter table public.personal_evidence_attachments enable row level security;
revoke all on public.personal_evidence_attachments from public,anon,authenticated;
grant select,insert,delete on public.personal_evidence_attachments to authenticated;
create policy personal_attachment_read on public.personal_evidence_attachments
for select to authenticated using (
 user_id=(select auth.uid()) or
 exists(select 1 from public.personal_evidence_shares s
  where s.evidence_id=personal_evidence_attachments.evidence_id
   and s.revoked_at is null
   and (select itqan_private.has_school_permission(s.school_id,'school.view_portfolios')))
);
create policy personal_attachment_insert on public.personal_evidence_attachments
for insert to authenticated with check (
 user_id=(select auth.uid())
 and (select itqan_private.owns_personal_evidence(evidence_id,(select auth.uid())))
 and object_name like user_id::text || '/' || evidence_id::text || '/' || id::text || '.%'
 and (select itqan_private.storage_evidence_exists(object_name))
);
create policy personal_attachment_delete on public.personal_evidence_attachments
for delete to authenticated using (user_id=(select auth.uid()));

-- Storage allows only private user/evidence/uuid.extension paths. No upsert or overwrite rights.
create policy itqan_evidence_storage_insert on storage.objects for insert to authenticated
with check (
 bucket_id='itqan-personal-evidence'
 and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|webp|docx|xlsx)$'
 and (storage.foldername(name))[1]=(select auth.uid())::text
 and (select itqan_private.owns_personal_evidence(
   ((storage.foldername(name))[2])::uuid,(select auth.uid())))
);
create policy itqan_evidence_storage_read on storage.objects for select to authenticated
using(bucket_id='itqan-personal-evidence'
 and (select itqan_private.may_read_evidence_attachment(name)));
-- Only the uploader can physically delete their own private evidence object.
create policy itqan_evidence_storage_delete on storage.objects for delete to authenticated
using(bucket_id='itqan-personal-evidence'
 and (storage.foldername(name))[1]=(select auth.uid())::text);
