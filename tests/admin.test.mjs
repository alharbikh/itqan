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
    if(p==='/rest/v1/school_memberships'){
      const member=role==='principal'||role==='employee' ?
        [{school_id:schoolId,access_role:role==='principal'?'school_principal':'employee',
          job_role:role==='principal'?'principal':'teacher',user_id:userId,status:'active'}] : [];
      return Response.json(member);
    }
    if (p.startsWith('/rest/v1/rpc/')) {
      writes.push({method:init.method,body:init.body,headers:init.headers,url:String(url)});
      return Response.json(true);
    }
    if (p==='/rest/v1/site_admin_audit') return Response.json([]);
    if (p==='/rest/v1/role_permissions') return Response.json([{role_code:'employee',permission_code:'school.view'}]);
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

test('non-admin cannot execute privileged RPC actions',async()=>{
  const m=mockSupabase('member');
  try {
    for(const action of [
      {action:'school.delete',school_id:schoolId},
      {action:'membership.upsert',school_id:schoolId,user_id:userId,access_role:'school_principal',job_role:'principal',status:'active'},
      {action:'user.status',user_id:userId,status:'inactive'},
      {action:'user.role',user_id:userId,enabled:true},
    ]) {
      const r=await worker.fetch(request('/api/admin/actions','POST',action),env);
      assert.equal(r.status,403);
    }
    assert.equal(m.writes.length,0);
  }finally{m.close();}
});
test('admin school deletion is only possible via scoped RPC and authenticated token',async()=>{
  const m=mockSupabase();
  try {
    const r=await worker.fetch(request('/api/admin/actions','POST',{action:'school.delete',school_id:schoolId}),env);
    assert.equal(r.status,200);
    const write=m.writes.find(x=>x.url.endsWith('/rpc/itqan_admin_delete_empty_school'));
    assert.deepEqual(JSON.parse(write.body),{p_school:schoolId});
    assert.equal(write.headers.authorization,'Bearer mock-access');
  }finally{m.close();}
});
test('administrator membership changes cannot accept site_admin or extra fields',async()=>{
  const m=mockSupabase();
  try {
    const baseBody={action:'membership.upsert',school_id:schoolId,user_id:userId,
      access_role:'employee',job_role:'teacher',status:'active'};
    for(const input of [
      {...baseBody,access_role:'site_admin'}, {...baseBody,role_code:'site_admin'},
      {...baseBody,access_role:'school_principal',job_role:'teacher'},
      {...baseBody,status:'deleted'},
    ]) {
      const r=await worker.fetch(request('/api/admin/actions','POST',input),env);
      assert.equal(r.status,400);
    }
    assert.equal(m.writes.length,0);
    const valid=await worker.fetch(request('/api/admin/actions','POST',baseBody),env);
    assert.equal(valid.status,200);
    const write=m.writes.find(x=>x.url.endsWith('/rpc/itqan_admin_manage_membership'));
    assert.equal(JSON.parse(write.body).p_access_role,'employee');
  }finally{m.close();}
});
test('admin actions require same-origin and valid UUIDs',async()=>{
  const m=mockSupabase();
  try {
    assert.equal((await worker.fetch(request('/api/admin/actions','POST',
      {action:'school.delete',school_id:schoolId},{origin:'https://evil.invalid'}),env)).status,403);
    assert.equal((await worker.fetch(request('/api/admin/actions','POST',
      {action:'school.delete',school_id:'invalid'}),env)).status,400);
    assert.equal(m.writes.length,0);
  }finally{m.close();}
});
test('admin role matrix, memberships and audit logs use authenticated reads',async()=>{
  const m=mockSupabase();
  try {
    for(const path of ['/api/admin/memberships','/api/admin/audit','/api/admin/roles']){
      const r=await worker.fetch(request(path),env);
      assert.equal(r.status,200);
    }
    const a=await worker.fetch(request('/api/admin/roles'),env);
    assert.equal((await a.json()).permissions[0].role_code,'employee');
  }finally{m.close();}
});

test('site admin role delegation is only a guarded boolean RPC',async()=>{
  const m=mockSupabase();
  try{
    const a=await worker.fetch(request('/api/admin/actions','POST',
      {action:'user.role',user_id:userId,enabled:true}),env);
    assert.equal(a.status,200);
    const write=m.writes.find(x=>x.url.endsWith('/rpc/itqan_admin_manage_site_role'));
    assert.equal(write.headers.authorization,'Bearer mock-access');
    assert.deepEqual(JSON.parse(write.body),{p_user:userId,p_enabled:true});
    for(const invalid of [
      {action:'user.role',user_id:userId,enabled:'true'},
      {action:'user.role',user_id:userId,enabled:true,role_code:'site_admin'},
      {action:'user.role',user_id:'other',enabled:false},
    ]){
      const r=await worker.fetch(request('/api/admin/actions','POST',invalid),env);
      assert.equal(r.status,400);
    }
  }finally{m.close();}
});

test('account suspension uses the existing disabled enum, not membership inactive',async()=>{
  const m=mockSupabase();
  try{
    const valid=await worker.fetch(request('/api/admin/actions','POST',{
      action:'user.status',user_id:userId,status:'disabled'
    }),env);
    assert.equal(valid.status,200);
    const write=m.writes.find(x=>x.url.endsWith('/rpc/itqan_admin_set_user_status'));
    assert.deepEqual(JSON.parse(write.body),{p_user:userId,p_status:'disabled'});
    const invalid=await worker.fetch(request('/api/admin/actions','POST',{
      action:'user.status',user_id:userId,status:'inactive'
    }),env);
    assert.equal(invalid.status,400);
  } finally {m.close();}
});

test('school principal may read member directory for their own school',async()=>{
  const m=mockSupabase('principal');
  try{
    const r=await worker.fetch(request('/api/school/members?school_id='+schoolId),env);
    assert.equal(r.status,200);
    const data=await r.json();
    assert.equal(data.members.length,1);
    assert.equal(data.members[0].full_name,'Owner');
    assert.equal(data.members[0].access_role,'school_principal');
  }finally{m.close();}
});
test('employee cannot read school member directory even if they belong to it',async()=>{
  const m=mockSupabase('employee');
  try{
    const r=await worker.fetch(request('/api/school/members?school_id='+schoolId),env);
    assert.equal(r.status,403);
  }finally{m.close();}
});
test('principal cannot read directory of a different school',async()=>{
  const m=mockSupabase('principal');
  try{
    const unrelated='7cf9750c-ed10-479f-bf48-0cb84332ece8';
    const r=await worker.fetch(request('/api/school/members?school_id='+unrelated),env);
    assert.equal(r.status,403);
  }finally{m.close();}
});
test('school member directory denies anonymous and invalid identifiers',async()=>{
  const m=mockSupabase('principal');
  try{
    const anon=await worker.fetch(new Request(base+'/api/school/members?school_id='+schoolId),env);
    assert.equal(anon.status,401);
    const invalid=await worker.fetch(request('/api/school/members?school_id=not-a-uuid'),env);
    assert.equal(invalid.status,400);
  }finally{m.close();}
});
