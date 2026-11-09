-- #13-#16 integration smoke tests in disposable Supabase; transaction rolls back.
begin;
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)
values
 ('71111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','frame-admin@itqan.invalid',now(),now(),now()),
 ('72222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','frame-principal@itqan.invalid',now(),now(),now()),
 ('73333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','frame-employee@itqan.invalid',now(),now(),now());
insert into public.user_roles(user_id,role_code) values('71111111-1111-4111-8111-111111111111','site_admin');
insert into public.schools(id,name,status) values('74444444-4444-4444-8444-444444444444','Framework test school','active');
insert into public.academic_years(id,label,starts_on,ends_on)
values('75555555-5555-4555-8555-555555555555','Framework test year',current_date-10,current_date+100);
insert into public.school_memberships(school_id,user_id,access_role,job_role,status)
values
 ('74444444-4444-4444-8444-444444444444','72222222-2222-4222-8222-222222222222','school_principal','principal','active'),
 ('74444444-4444-4444-8444-444444444444','73333333-3333-4333-8333-333333333333','employee','teacher','active');
set local role authenticated;
do $$
declare b uuid;f uuid;criterion uuid;evidence_id uuid;feedback_id uuid;review_id uuid;denied boolean;
begin
 perform set_config('request.jwt.claim.sub','71111111-1111-4111-8111-111111111111',true);
 b:=public.itqan_admin_stage_framework(
  '{"code":"LOCAL-TEST-FRAME","version_no":1,"title_ar":"اختبار الإطار","source_reference":"test only",
  "jobs":[{"code":"test_teacher","title_ar":"معلم تجريبي","criteria":[
   {"code":"local-criterion-a","title_ar":"المعيار الأول","weight":70,"is_common":true,
    "interpretation":"الوصف التوضيحي", "source_page":"18",
    "descriptors":[{"level":5,"text":"التقدير الأعلى"}]},
   {"code":"local-criterion-b","title_ar":"المعيار الثاني","weight":30}
  ]}]}'::jsonb);
 f:=public.itqan_admin_approve_framework(b,'Reviewed in test');
 if not exists(select 1 from public.evaluation_frameworks where id=f and status='draft') then
  raise exception 'Framework did not remain draft after approval';end if;
 perform public.itqan_admin_publish_framework(b);
 if not exists(select 1 from public.evaluation_frameworks where id=f and status='active') then
  raise exception 'Framework was not published';end if;
 select id into criterion from public.evaluation_criteria where code='local-criterion-a';
 if not exists(select 1 from public.evaluation_criterion_interpretations
    where framework_id=f and criterion_id=criterion and source_page='18') then
   raise exception 'Interpretation source missing';end if;
 perform public.itqan_admin_set_stage_default(
 '75555555-5555-4555-8555-555555555555','midyear',
 current_date+30,current_date+35,current_date+25,current_date+45);
 perform set_config('request.jwt.claim.sub','72222222-2222-4222-8222-222222222222',true);
 perform public.itqan_school_set_stage_dates(
 '74444444-4444-4444-8444-444444444444',
 '75555555-5555-4555-8555-555555555555','midyear',
 current_date+28,current_date+38,'Schedule update');
 denied:=false;
 begin
 perform public.itqan_school_set_stage_dates(
 '74444444-4444-4444-8444-444444444444',
 '75555555-5555-4555-8555-555555555555','midyear',
 current_date+20,current_date+38,'Beyond allowed bounds');
 exception when invalid_parameter_value then denied:=true;
 end;
 if not denied then raise exception 'Out-of-range stage override was accepted';end if;
 insert into public.midyear_feedback(school_id,academic_year_id,subject_user_id,reviewer_user_id,
 strengths,improvements,development_actions)
 values('74444444-4444-4444-8444-444444444444','75555555-5555-4555-8555-555555555555',
 '73333333-3333-4333-8333-333333333333','72222222-2222-4222-8222-222222222222',
 'Strong attendance','Develop planning','Coaching sessions') returning id into feedback_id;
 update public.midyear_feedback set status='published',published_at=now() where id=feedback_id;
 denied:=false;
 begin
 insert into public.performance_reviews(school_id,subject_user_id,reviewer_user_id,academic_year,status)
 values('74444444-4444-4444-8444-444444444444','72222222-2222-4222-8222-222222222222',
 '72222222-2222-4222-8222-222222222222','test','draft');
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Manager self-review was not prevented';end if;
 insert into public.performance_reviews(school_id,subject_user_id,reviewer_user_id,academic_year,status)
 values('74444444-4444-4444-8444-444444444444','73333333-3333-4333-8333-333333333333',
 '72222222-2222-4222-8222-222222222222','test','draft') returning id into review_id;
 perform set_config('request.jwt.claim.sub','73333333-3333-4333-8333-333333333333',true);
 perform public.itqan_employee_acknowledge_framework('74444444-4444-4444-8444-444444444444',f);
 perform public.itqan_employee_ack_midyear(feedback_id,'Read and understood');
 if not exists(select 1 from public.midyear_feedback where id=feedback_id and status='acknowledged') then
  raise exception 'Midyear feedback acknowledgement failed';end if;
 insert into public.personal_evidence(user_id,title,description)
 values('73333333-3333-4333-8333-333333333333','Personal standalone item','No criteria yet')
 returning id into evidence_id;
 insert into public.personal_evidence_criteria(evidence_id,criterion_id) values(evidence_id,criterion);
 if not exists(select 1 from public.personal_evidence_criteria where evidence_id=evidence_id and criterion_id=criterion) then
  raise exception 'Personal evidence cannot link to criterion';end if;
end $$;
reset role;
update public.school_memberships set status='inactive'
where school_id='74444444-4444-4444-8444-444444444444' and
user_id='73333333-3333-4333-8333-333333333333';
do $$
declare denied boolean:=false;
begin
 if not exists(select 1 from public.performance_reviews
  where subject_user_id='73333333-3333-4333-8333-333333333333' and status='frozen') then
   raise exception 'Unlink did not freeze unfinished performance review';end if;
 begin
  update public.performance_reviews set status='submitted'
   where subject_user_id='73333333-3333-4333-8333-333333333333' and status='frozen';
 exception when insufficient_privilege then denied:=true;
 end;
 if not denied then raise exception 'Frozen review was modified without exception';end if;
end $$;
rollback;
