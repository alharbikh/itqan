import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const origin='https://itqan.example';
const userId='4c4d5000-0000-4000-8000-000000000001';
const school='4c4d5000-0000-4000-8000-000000000002';
const schoolPayload={
 name:'مدرسة الاختبار',ministry_number:'123456',education_stage:'ابتدائي',
 gender:'male',education_department:'جدة'
};
function scope(role='member',options={}){
 const originals=globalThis.fetch, calls=[], assets=[];
 const env={
  SUPABASE_URL:'https://itqan-test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_mock',
  ASSETS:{fetch:async request=>{assets.push(new URL(request.url).pathname);
   return new Response(new URL(request.url).pathname==='/access.html'
    ?'<html><body data-access-state="default">Access denied</body></html>'
    :'<html lang="ar">protected</html>',{status:200,headers:{'content-type':'text/html'}});}
  }
 };
 globalThis.fetch=async (url,init={})=>{
  const path=new URL(url).pathname;
  calls.push({path,method:init.method,headers:init.headers,body:init.body});
  const ok=data=>Response.json(data);
  if(path==='/auth/v1/user')return ok({id:userId,email:'employee@example.invalid'});
  if(path==='/rest/v1/users')return ok([{id:userId,full_name:'مستخدم اختباري',status:'active'}]);
  if(path==='/rest/v1/user_roles')
   return ok(role==='site_admin'?[{role_code:'site_admin'}]:[]);
  if(path==='/rest/v1/school_memberships')
   return ok(role==='site_admin'?[]:[{school_id:school,status:'active',access_role:'employee',job_role:'teacher'}]);
  if(path==='/auth/v1/signup')
   return options.signupResponse||ok({user:{id:userId}});
  if(path==='/rest/v1/schools'){
   if(init.method==='POST')return options.schoolResponse||
     ok([{id:school,...schoolPayload,status:'active'}]);
   return ok([]);
  }
  throw Error('Unmocked Supabase request '+path);
 };
 return {env,assets,calls,restore:()=>{globalThis.fetch=originals;}};
}
function req(path,authenticated=false,method='GET',body){
 return new Request(origin+path,{
  method,headers:{
   ...(authenticated?{cookie:'__Host-itqan_at=valid-test-token'}:{}),
   ...(method==='POST'?{origin,'content-type':'application/json'}:{})
  },
  ...(body!==undefined?{body:JSON.stringify(body)}:{})
 });
}
test('short public aliases never expose protected administrator HTML to anonymous users',async()=>{
 const m=scope();
 try{
  for(const path of ['/admin','/admin/','/admin.html','/frameworks','/frameworks/','/frameworks.html']){
   const r=await worker.fetch(req(path),m.env);
   assert.equal(r.status,401,path);
   assert.equal(r.headers.get('location'),null);
   assert.match(await r.text(),/data-access-state="login"/);
  }
  assert.deepEqual(m.assets,Array(6).fill('/access.html'));
 }finally{m.restore();}
});
test('non-admin session is blocked from both administrator aliases before asset resolution',async()=>{
 const m=scope('member');
 try{
  for(const path of ['/admin','/admin.html','/frameworks','/frameworks.html']){
   const r=await worker.fetch(req(path,true),m.env);
   assert.equal(r.status,403);
   assert.equal(r.headers.get('location'),null);
   assert.match(await r.text(),/data-access-state="forbidden"/);
  }
  assert.deepEqual(m.assets,Array(4).fill('/access.html'));
  const mutation=await worker.fetch(req('/api/admin/schools',true,'POST',schoolPayload),m.env);
  assert.equal(mutation.status,403);
  assert.equal(m.calls.some(c=>c.path==='/rest/v1/schools'),false);
 }finally{m.restore();}
});
test('site admin can open both URL forms; asset loader uses protected html only',async()=>{
 const m=scope('site_admin');
 try{
  for(const path of ['/admin','/admin.html','/frameworks','/frameworks.html']){
   const r=await worker.fetch(req(path,true),m.env);
   assert.equal(r.status,200);
   assert.match(r.headers.get('cache-control'),/no-store/);
  }
  assert.deepEqual(m.assets,['/admin.html','/admin.html','/frameworks.html','/frameworks.html']);
 }finally{m.restore();}
});
test('school input errors identify field and no database write is attempted',async()=>{
 const m=scope('site_admin');
 try{
  for(const [payload,field] of [
   [{...schoolPayload,name:'x'},'name'],
   [{...schoolPayload,gender:'unknown'},'gender'],
   [{...schoolPayload,ministry_number:'12A'},'ministry_number'],
  ]){
   const r=await worker.fetch(req('/api/admin/schools',true,'POST',payload),m.env);
   assert.equal(r.status,400);
   assert.equal((await r.json()).field,field);
  }
  assert.equal(m.calls.some(c=>c.path==='/rest/v1/schools'),false);
 }finally{m.restore();}
});
test('duplicate ministry number returns an actionable field-specific conflict',async()=>{
 const upstream=Response.json({code:'23505',message:'duplicate key value violates unique constraint schools_ministry_number_key'},
   {status:409});
 const m=scope('site_admin',{schoolResponse:upstream});
 try{
  const res=await worker.fetch(req('/api/admin/schools',true,'POST',schoolPayload),m.env);
  assert.equal(res.status,409);
  const payload=await res.json();
  assert.equal(payload.field,'ministry_number');
  assert.match(payload.error,/الرقم الوزاري/);
 }finally{m.restore();}
});
test('four-character registration reaches Supabase but does not grant any privileges',async()=>{
 const m=scope('member');
 try{
  const r=await worker.fetch(req('/api/register',false,'POST',
   {name:'مستخدم تجريبي',email:'new@example.invalid',password:'abc4',role:'site_admin'}),m.env);
  assert.equal(r.status,202);
  const sent=JSON.parse(m.calls.find(c=>c.path==='/auth/v1/signup').body);
  assert.equal(sent.password,'abc4');
  assert.equal(sent.role,undefined);
 }finally{m.restore();}
});
test('Supabase strong-password restriction gets explicit error without claiming registration',async()=>{
 const m=scope('member',{signupResponse:Response.json(
  {error_code:'weak_password',message:'Password should be at least 6 characters'},{status:422})});
 try{
  const r=await worker.fetch(req('/api/register',false,'POST',
   {name:'مستخدم تجريبي',email:'new@example.invalid',password:'abc4'}),m.env);
  assert.equal(r.status,422);
  const data=await r.json();
  assert.equal(data.code,'AUTH_PASSWORD_POLICY');
  assert.equal(data.field,'password');
  assert.match(data.error,/Supabase Auth/);
 }finally{m.restore();}
});

test('static HTML handling is disabled to prevent asset-to-Worker redirect cycles',()=>{
 const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 assert.equal(config.assets.html_handling,'none');
 assert.equal(config.assets.run_worker_first,true);
});
test('public paths work without any URL state parameters',async()=>{
 const m=scope('member');
 try{
  for(const path of ['/','/index.html','/login','/login.html','/access','/access.html']){
   const r=await worker.fetch(req(path),m.env);
   assert.equal(r.status,200,path);
   assert.equal(r.headers.get('location'),null);
  }
  const legacy=await worker.fetch(req('/access?reason=login&section=admin'),m.env);
  assert.equal(legacy.status,302);
  assert.equal(legacy.headers.get('location'),'/access');
 }finally{m.restore();}
});
test('access errors render at requested URL with no query parameters or leaks',async()=>{
 const m=scope('member');
 try{
  const anonymous=await worker.fetch(req('/frameworks'),m.env);
  assert.equal(anonymous.status,401);
  assert.match(anonymous.headers.get('content-type'),/^text\/html/);
  assert.match(await anonymous.text(),/data-access-state="login"/);
  const forbidden=await worker.fetch(req('/frameworks',true),m.env);
  assert.equal(forbidden.status,403);
  const body=await forbidden.text();
  assert.match(body,/data-access-state="forbidden"/);
  assert.doesNotMatch(body,/reason=|section=/);
  assert.equal(forbidden.headers.get('location'),null);
 }finally{m.restore();}
});
