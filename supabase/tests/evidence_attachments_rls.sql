-- #17: security checks for the private Storage bucket. Run only on disposable DB.
begin;
do $$
begin
 if not exists(select 1 from storage.buckets b where b.id='itqan-personal-evidence'
   and b.public=false and b.file_size_limit=5242880) then
  raise exception 'Personal evidence bucket must be private and capped at 5 MB';
 end if;
 if not exists(select 1 from pg_policies p where p.schemaname='storage'
  and p.tablename='objects' and p.policyname='itqan_evidence_storage_insert') then
  raise exception 'Owner-scoped storage upload RLS missing';
 end if;
 if not exists(select 1 from pg_policies p where p.schemaname='storage'
  and p.tablename='objects' and p.policyname='itqan_evidence_storage_read') then
  raise exception 'Private file read policy missing';
 end if;
end $$;
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)
values
 ('81111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','storage-owner@itqan.invalid',now(),now(),now()),
 ('82222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','storage-outsider@itqan.invalid',now(),now(),now());
insert into public.personal_evidence(id,user_id,title)
values('83333333-3333-4333-8333-333333333333','81111111-1111-4111-8111-111111111111','Private sample');
set local role authenticated;
do $$
declare blocked boolean:=false;
begin
 perform set_config('request.jwt.claim.sub','81111111-1111-4111-8111-111111111111',true);
 if itqan_private.may_read_evidence_attachment(
  '81111111-1111-4111-8111-111111111111/83333333-3333-4333-8333-333333333333/84444444-4444-4444-8444-444444444444.pdf') then
  raise exception 'Unregistered file was readable';
 end if;
 begin
  insert into public.personal_evidence_attachments
  (id,evidence_id,user_id,object_name,original_filename,mime_type,byte_size)
  values('84444444-4444-4444-8444-444444444444',
   '83333333-3333-4333-8333-333333333333',
   '81111111-1111-4111-8111-111111111111',
   '81111111-1111-4111-8111-111111111111/83333333-3333-4333-8333-333333333333/84444444-4444-4444-8444-444444444444.pdf',
   'sample.pdf','application/pdf',100);
 exception when insufficient_privilege then blocked:=true;
 end;
 if not blocked then raise exception 'Allowed metadata without a real Storage object';end if;
 perform set_config('request.jwt.claim.sub','82222222-2222-4222-8222-222222222222',true);
 if exists(select 1 from public.personal_evidence_attachments
  where user_id='81111111-1111-4111-8111-111111111111') then
  raise exception 'Cross-account metadata leak';
 end if;
end $$;
rollback;
