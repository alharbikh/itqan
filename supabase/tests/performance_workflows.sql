-- #13-#16 integration smoke tests in disposable Supabase; transaction rolls back.
begin;
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)
values
 ('71111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','frame-admin@itqan.invalid',now(),now(),now()),
 ('72222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','frame-principal@itqan.invalid',now(),now(),now()),
 ('73333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','frame-employee@itqan.invalid',now(),now(),now()),
 ('76666666-6666-4666-8666-666666666666','00000000-0000-0000-0000-000000000000','authenticated','authenticated','frame-approver@itqan.invalid',now(),now(),now());
insert into public.user_roles(user_id,role_code) values('71111111-1111-4111-8111-111111111111','site_admin');
insert into public.schools(id,name,status) values('74444444-4444-4444-8444-444444444444','Framework test school','active');
insert into public.academic_years(id,label,starts_on,ends_on)
values('75555555-5555-4555-8555-555555555555','Framework test year',current_date-10,current_date+100);
insert into public.school_memberships(school_id,user_id,access_role,job_role,status)
values
 ('74444444-4444-4444-8444-444444444444','72222222-2222-4222-8222-222222222222','school_principal','principal','active'),
 ('74444444-4444-4444-8444-444444444444','73333333-3333-4333-8333-333333333333','employee','teacher','active'),
 ('74444444-4444-4444-8444-444444444444','76666666-6666-4666-8666-666666666666','school_principal','principal','active');
set local role authenticated;
do $$
declare b uuid;f uuid;criterion uuid;v_job uuid;v_evidence_id uuid;feedback_id uuid;review_id uuid;v_standard uuid;v_second uuid;v_result numeric;denied boolean;
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
 if not exists(select 1 from public.framework_import_batches
  where id=b and framework_id=f and status='approved') then
  raise exception 'Framework approval was not recorded as an unpublished draft';end if;
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
 select id into v_job from public.job_titles where code='test_teacher';
 review_id:=public.itqan_school_create_review(
  '74444444-4444-4444-8444-444444444444',
  '73333333-3333-4333-8333-333333333333','test',f,v_job);
 -- A normal review uses only the Ministry official weighted five-point calculation.
 v_standard:=public.itqan_school_create_review(
   '74444444-4444-4444-8444-444444444444',
   '73333333-3333-4333-8333-333333333333','test-standard',f,v_job);
 select id into v_second from public.evaluation_criteria where code='local-criterion-b';
 perform public.itqan_school_score_criterion(v_standard,criterion,5::smallint,'Official criterion A');
 perform public.itqan_school_score_criterion(v_standard,v_second,4::smallint,'Official criterion B');
 v_result:=public.itqan_school_submit_review(v_standard);
 if v_result<>4.7 then raise exception 'Normal five-point weighted result incorrect %',v_result;end if;
 if not exists(
   select 1 from public.performance_reviews where id=v_standard and status='submitted'
   and final_score_5_exact=4.7 and final_rating_5=5 and final_score_100 is null
 ) then raise exception 'Normal review stored an invalid official result';end if;
 perform set_config('request.jwt.claim.sub','73333333-3333-4333-8333-333333333333',true);
 perform public.itqan_employee_acknowledge_framework('74444444-4444-4444-8444-444444444444',f);
 perform public.itqan_employee_ack_midyear(feedback_id,'Read and understood');
 if not exists(select 1 from public.midyear_feedback where id=feedback_id and status='acknowledged') then
  raise exception 'Midyear feedback acknowledgement failed';end if;
 insert into public.personal_evidence(user_id,title,description)
 values('73333333-3333-4333-8333-333333333333','Personal standalone item','No criteria yet')
 returning id into v_evidence_id;
 insert into public.personal_evidence_criteria(evidence_id,criterion_id) values(v_evidence_id,criterion);
 insert into public.personal_evidence_shares(evidence_id,school_id,user_id)
 values(v_evidence_id,'74444444-4444-4444-8444-444444444444',
 '73333333-3333-4333-8333-333333333333');
 if not exists(select 1 from public.personal_evidence_criteria where evidence_id=v_evidence_id and criterion_id=criterion) then
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
 if exists(select 1 from public.personal_evidence_shares where
  user_id='73333333-3333-4333-8333-333333333333' and
  school_id='74444444-4444-4444-8444-444444444444' and revoked_at is null) then
  raise exception 'Personal evidence remains shared after unlink';end if;
end $$;
set local role authenticated;
do $$
declare review_id uuid;request_id uuid;criterion_one uuid;criterion_two uuid;result numeric;
begin
 perform set_config('request.jwt.claim.sub','72222222-2222-4222-8222-222222222222',true);
 select id into review_id from public.performance_reviews
 where school_id='74444444-4444-4444-8444-444444444444'
 and subject_user_id='73333333-3333-4333-8333-333333333333'
 and academic_year='test';
 request_id:=public.itqan_school_request_review_exception(
  review_id,'Completing the documented outstanding criteria after transfer');
 perform set_config('request.jwt.claim.sub','76666666-6666-4666-8666-666666666666',true);
 perform public.itqan_school_decide_review_exception(request_id,true,now()+interval '2 days');
 perform set_config('request.jwt.claim.sub','72222222-2222-4222-8222-222222222222',true);
 select id into criterion_one from public.evaluation_criteria where code='local-criterion-a';
 select id into criterion_two from public.evaluation_criteria where code='local-criterion-b';
 perform public.itqan_school_exception_score(request_id,criterion_one,5::smallint,'Strong result');
 perform public.itqan_school_exception_score(request_id,criterion_two,4::smallint,'Above average');
 result:=public.itqan_school_exception_submit(request_id);
 if result<>4.7 then raise exception 'Official exceptional weighted mean incorrect %',result;end if;
 if not exists(select 1 from public.review_exception_requests where id=request_id
   and status='expired' and revoked_at is not null) then
  raise exception 'Exception remained active after submitting';end if;
 if not exists(select 1 from public.performance_reviews where id=review_id
   and status='submitted' and final_score_5_exact=4.7
   and final_rating_5=5 and final_score_100 is null) then
  raise exception 'Exceptional submitted review incorrect';end if;
end $$;
rollback;
