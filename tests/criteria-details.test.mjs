import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';

const origin='https://itqan.example';
const account='00000000-0000-4000-8000-000000000001';
const framework='00000000-0000-4000-8000-000000000002';
const criterion='00000000-0000-4000-8000-000000000003';
const other='00000000-0000-4000-8000-000000000004';
const role='00000000-0000-4000-8000-000000000005';
const env={SUPABASE_URL:'https://itqan-test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY:'sb_publishable_unit_test_only'};

test('framework detail API returns only matching active guide evidence and source text',async()=>{
 const previous=globalThis.fetch;
 const requests=[];
 globalThis.fetch=async(url,init={})=>{
  const u=new URL(url);requests.push({path:u.pathname,query:u.search,auth:init.headers?.authorization});
  const ok=data=>Response.json(data);
  switch(u.pathname){
   case '/auth/v1/user':return ok({id:account,email:'employee@example.invalid'});
   case '/rest/v1/users':return ok([{id:account,full_name:'موظف',status:'active'}]);
   case '/rest/v1/user_roles':return ok([]);
   case '/rest/v1/school_memberships':return ok([]);
   case '/rest/v1/evaluation_framework_criteria':return ok([
     {framework_id:framework,criterion_id:criterion,job_title_id:role,weight:30}]);
   case '/rest/v1/evaluation_criterion_interpretations':return ok([
     {framework_id:framework,criterion_id:criterion,job_title_id:role,title_ar:'معيار اختبار',
      interpretation:'تفسير رسمي اختباري',source_page:19}]);
   case '/rest/v1/criterion_rating_descriptors':return ok([
     {criterion_id:criterion,job_title_id:role,score_level:3,descriptor:'وصف معتمد'}]);
   case '/rest/v1/criterion_evidence_suggestions':return ok([
     {criterion_id:criterion,title_ar:'مستند إرشادي',description:'اختيار الموظف',sort_order:1},
     {criterion_id:other,title_ar:'شاهد خارج الإطار',description:'لا يعرض',sort_order:2}]);
   default:throw Error('Unexpected upstream: '+u.pathname);
  }
 };
 try{
  const response=await worker.fetch(new Request(origin+'/api/framework-details?framework_id='+framework,
    {headers:{cookie:'__Host-itqan_at=access-test'}}),env);
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.criteria.length,1);
  assert.equal(data.criteria[0].source_page,19);
  assert.equal(data.criteria[0].descriptors[0].score_level,3);
  assert.deepEqual(data.criteria[0].suggestions.map(s=>s.title_ar),['مستند إرشادي']);
  const query=requests.find(r=>r.path==='/rest/v1/criterion_evidence_suggestions');
  assert.match(query.query,/active=eq.true/);
  assert.equal(requests.every(r=>r.auth==='Bearer access-test'),true);
 }finally{globalThis.fetch=previous;}
});

test('framework details need a valid session before any database lookup',async()=>{
 const previous=globalThis.fetch;
 let queries=0;
 globalThis.fetch=async()=>{queries++;throw Error('Unauthorized should not read data');};
 try{
  const response=await worker.fetch(new Request(origin+'/api/framework-details?framework_id='+framework),env);
  assert.equal(response.status,401);
  assert.equal(queries,0);
 }finally{globalThis.fetch=previous;}
});

test('criterion detail navigator contains all four accessible local panels',()=>{
 const source=readFileSync(new URL('../public/performance.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/performance.css',import.meta.url),'utf8');
 for(const title of ['التفسير','سلم التقدير','الشواهد','المرجع']){
  assert.ok(source.includes("['"+title+"',"),'missing criterion tab: '+title);
 }
 assert.match(source,/setAttribute\('role','tablist'\)/);
 assert.match(source,/setAttribute\('role','tabpanel'\)/);
 assert.match(source,/setAttribute\('aria-controls'/);
 assert.match(source,/setAttribute\('aria-selected'/);
 assert.match(source,/event\.key==='ArrowLeft'/);
 assert.match(source,/event\.key==='ArrowRight'/);
 assert.match(source,/panel\.className='perf-list criteria-collection'/);
 assert.match(css,/\.criterion-panel\[hidden\]/);
 assert.doesNotMatch(source,/\.style\.cssText\s*=/);
});
