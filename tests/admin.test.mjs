import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const base='https://itqan.example';
const schoolId='d02929fd-df65-4d24-980a-b94f3d3eeb6e';
const userId='5f98a482-f8ba-4056-9b33-8de5b7edc42e';
const env={SUPABASE_URL:'https://itqan-test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY:'sb_publishable_mock',
  ASSETS:{fetch:async()=>new Response('<html>Protected</html>')}};
function request(path,method='GET',body,headers={}) {
  return new Request(base+path,{method,headers:{
    ...(method==='GET'?{}:{origin:base,'content-type':'application/json'}),
    cookie:'__Host-itqan_at=mock-access',
    ...headers,
  },...(body===undefined?{}:{body:JSON.stringify(body)})});
}
function mockSupabase(role='site_admin') {
  const original=globalThis.fetch;
  const writes=[];
  globalThis.fetch=async(url,init={})=>{
    const p=new URL(url).pathname;
    if(p==='/auth/v1/user')return Response.json({id:userId,email:'admin@example.invalid'});
    if(p==='/rest/v1/users')return Response.json([{id:userId,full_name:'Owner',status:'active',created_at:'2026-11-09T00:00:00Z'}]);
    if(p==='/rest/v1/user_roles')return Response.json(role==='site_admin'?[{role_code:'site_admin'}]:[]);
    if(p==='/rest/v1/school_memberships')return Response.json([]);
    if(p==='/rest/v1/schools') {
      writes.push({method:init.method,body:init.body,headers:init.headers,url:String(url)});
      if(init.method==='POST'||init.method==='PATCH')return Response.json([{id:schoolId,name:'مدرسة الاختبار',status:'active'}]);
      return Response.json([{id:schoolId,name:'مدرسة الاختبار',status:'active'}]);
    }
    throw new Error('Unmocked route '+p);
  };
  return {writes,close:()=>{globalThis.fetch=original;}};
}
const valid={name:'مدرسة الاختبار',ministry_number:'123',education_stage:'ابتدائي',gender:'male',education_department:'الرياض'};
test('only site admin may list schools or users',async()=>{
  const m=mockSupabase('member');
  try {
    assert.equal((await worker.fetch(request('/api/admin/schools'),env)).status,403);
    assert.equal((await worker.fetch(request('/api/admin/users'),env)).status,403);
    assert.equal(m.writes.length,0);
  }finally{m.close();}
});
test('anonymous user cannot create a school',async()=>{
  const m=mockSupabase();
  try {
    const response=await worker.fetch(new Request(base+'/api/admin/schools',{method:'POST',
      headers:{origin:base,'content-type':'application/json'},body:JSON.stringify(valid)}),env);
    assert.equal(response.status,401);
    assert.equal(m.writes.length,0);
  }finally{m.close();}
});
test('site admin can create a school using own JWT subject to PostgreSQL RLS',async()=>{
  const m=mockSupabase();
  try {
    const response=await worker.fetch(request('/api/admin/schools','POST',valid),env);
    assert.equal(response.status,201);
    assert.equal((await response.json()).school.name,'مدرسة الاختبار');
    const query=m.writes.find(x=>x.method==='POST');
    assert.equal(query.headers.authorization,'Bearer mock-access');
    assert.equal(query.headers.Prefer,'return=representation');
    assert.deepEqual(Object.keys(JSON.parse(query.body)).sort(),Object.keys(valid).sort());
    assert.equal(query.headers.apikey,env.SUPABASE_PUBLISHABLE_KEY);
  }finally{m.close();}
});
test('school mutation input forbids setting status, identities and roles',async()=>{
  const m=mockSupabase();
  try {
    for(const invalid of [{...valid,status:'active'},{...valid,user_id:userId},{...valid,gender:'invalid'},
      {...valid,name:'x'}]) {
      const r=await worker.fetch(request('/api/admin/schools','POST',invalid),env);
      assert.equal(r.status,400);
    }
    assert.equal(m.writes.length,0);
  }finally{m.close();}
});
test('cross-origin requests cannot create or change a school',async()=>{
  const m=mockSupabase();
  try {
    const r=await worker.fetch(request('/api/admin/schools','POST',valid,{origin:'https://malicious.example'}),env);
    assert.equal(r.status,403);
    assert.equal(m.writes.length,0);
  }finally{m.close();}
});
test('school edits send PATCH with a scoped ID and do not expose unrestricted writes',async()=>{
  const m=mockSupabase();
  try {
    const r=await worker.fetch(request('/api/admin/schools/'+schoolId,'PATCH',valid),env);
    assert.equal(r.status,200);
    const write=m.writes.find(x=>x.method==='PATCH');
    assert.ok(write.url.includes('id=eq.'+schoolId));
    assert.equal(write.headers.authorization,'Bearer mock-access');
    assert.equal(write.headers.Prefer,'return=representation');
  }finally{m.close();}
});
test('admin users list is read-only and derives from RLS',async()=>{
  const m=mockSupabase();
  try {
    const r=await worker.fetch(request('/api/admin/users'),env);
    assert.equal(r.status,200);
    const result=await r.json();
    assert.equal(result.users[0].full_name,'Owner');
    assert.equal((await worker.fetch(request('/api/admin/users','POST',valid),env)).status,405);
  }finally{m.close();}
});

test('visual preview shows UI assets but never exposes Supabase APIs',async()=>{
  const spy=mockSupabase();
  try {
    const previewEnv={...env,PREVIEW_ONLY:'true'};
    const page=await worker.fetch(request('/admin-preview.html'),previewEnv);
    assert.equal(page.status,200);
    for(const path of ['/api/session','/api/admin/schools','/admin.html','/school.html']) {
      const res=await worker.fetch(request(path),previewEnv);
      assert.equal(res.status,403);
    }
    assert.equal(spy.writes.length,0);
    const prodPage=await worker.fetch(request('/admin-preview.html'),env);
    assert.equal(prodPage.status,404);
  } finally {spy.close();}
});
