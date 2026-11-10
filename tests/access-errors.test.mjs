import test from 'node:test';
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
   return new Response('<html lang="ar">protected</html>',{status:200,headers:{'content-type':'text/html'}});}
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
   assert.equal(r.status,302,path);
   assert.match(r.headers.get('location'),/\/access\.html\?reason=login&section=/);
  }
  assert.equal(m.assets.length,0);
 }finally{m.restore();}
});
test('non-admin session is blocked from both administrator aliases before asset resolution',async()=>{
 const m=scope('member');
 try{
  for(const path of ['/admin','/admin.html','/frameworks','/frameworks.html']){
   const r=await worker.fetch(req(path,true),m.env);
   assert.equal(r.status,302);
   assert.match(r.headers.get('location'),/reason=forbidden/);
  }
  assert.equal(m.assets.length,0);
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
