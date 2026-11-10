import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';

const ORIGIN='https://itqan.example';
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOKEN='mock-access', REFRESH='mock-refresh';
const ENV={SUPABASE_URL:'https://itqan-test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test_only',
  SUPABASE_SERVICE_ROLE_KEY:'test-service-role-key-keep-on-server-only',
  ASSETS:{fetch:async req=>new Response('<html><body>view</body></html>',
    {headers:{'content-type':'text/html'}})}};
const request=(path,body,cookies='')=>new Request(ORIGIN+path,{method:'POST',
  headers:{origin:ORIGIN,'content-type':'application/json',...(cookies?{cookie:cookies}:{})},
  body:JSON.stringify(body)});
const cookies='__Host-itqan_at='+TOKEN+'; __Host-itqan_rt='+REFRESH;
function mock({role='member',forced=false,recoveryValid=true,auditOk=true}={}){
  const previous=globalThis.fetch,events=[];
  globalThis.fetch=async (url,init={})=>{
    const u=new URL(url),path=u.pathname,method=init.method||'GET';
    const body=init.body?JSON.parse(init.body):null;
    events.push({path,method,body,headers:init.headers});
    const ok=x=>Response.json(x);
    const fail=(status=400)=>Response.json({error:'denied'},{status});
    if(path==='/auth/v1/recover')return ok({});
    if(path==='/auth/v1/verify')return recoveryValid?ok({access_token:TOKEN,refresh_token:REFRESH,expires_in:3600}):fail();
    if(path==='/auth/v1/token')return ok({access_token:TOKEN,refresh_token:REFRESH,expires_in:3600});
    if(path==='/auth/v1/user')return method==='PUT'?ok({}):
      ok({id:ID,email:'member@example.test',app_metadata:forced?{itqan_force_password_change:true}:{}});
    if(path==='/auth/v1/admin/users/'+OTHER)return method==='PUT'?ok({}):
      ok({id:OTHER,app_metadata:{provider:'email'}});
    if(path==='/auth/v1/admin/users/'+ID)return method==='PUT'?ok({}):
      ok({id:ID,app_metadata:{itqan_force_password_change:true,provider:'email'}});
    if(path==='/rest/v1/users')return ok(u.searchParams.has('id')?
      [{id:OTHER,status:'active'}]:[{id:ID,status:'active',full_name:'test'}]);
    if(path==='/rest/v1/user_roles')return ok(role==='site_admin'?[{role_code:'site_admin'}]:[]);
    if(path==='/rest/v1/school_memberships')return ok([]);
    if(path==='/rest/v1/site_admin_audit')return auditOk?ok({}):fail(500);
    throw Error('Unexpected '+path);
  };
  return {events,restore:()=>{globalThis.fetch=previous}};
}

test('recovery request hides whether an account exists and never returns auth tokens',async()=>{
  const m=mock();try{
    const r=await worker.fetch(request('/api/password/recovery/request',{email:'member@example.test'}),ENV);
    assert.equal(r.status,202);
    assert.match((await r.json()).message,/البريد/);
    assert.equal(r.headers.get('set-cookie'),null);
    assert.equal(m.events[0].path,'/auth/v1/recover');
  }finally{m.restore()}
});
test('recovery rejects invalid input before contacting Supabase',async()=>{
  const m=mock();try{
    const r=await worker.fetch(request('/api/password/recovery/complete',
      {email:'member@example.test',code:'123456',password:'short'}),ENV);
    assert.equal(r.status,400);assert.equal(m.events.length,0);
  }finally{m.restore()}
});
test('correct recovery OTP changes password on Worker and stores tokens only in HttpOnly cookies',async()=>{
  const m=mock();try{
    const r=await worker.fetch(request('/api/password/recovery/complete',
      {email:'member@example.test',code:'123456',password:'very-long-new-secret'}),ENV);
    assert.equal(r.status,200);
    assert.equal((await r.json()).user.id,ID);
    assert.equal(r.headers.getSetCookie().length,2);
    assert.ok(r.headers.getSetCookie().every(x=>x.includes('HttpOnly')));
    assert.equal(m.events.find(x=>x.path==='/auth/v1/verify').body.type,'recovery');
    assert.equal(m.events.find(x=>x.path==='/auth/v1/user'&&x.method==='PUT').body.password,'very-long-new-secret');
  }finally{m.restore()}
});
test('incorrect code does not update credentials',async()=>{
  const m=mock({recoveryValid:false});try{
    const r=await worker.fetch(request('/api/password/recovery/complete',
      {email:'member@example.test',code:'111111',password:'very-long-new-secret'}),ENV);
    assert.equal(r.status,400);assert.equal(m.events.some(x=>x.method==='PUT'),false);
  }finally{m.restore()}
});
test('non-admin cannot issue temporary passwords',async()=>{
  const m=mock();try{
    const r=await worker.fetch(request('/api/admin/users/password',
      {user_id:OTHER,reason:'إعادة ضبط بطلب صاحب الحساب'},cookies),ENV);
    assert.equal(r.status,403);
    assert.equal(m.events.some(x=>x.path.startsWith('/auth/v1/admin/')),false);
  }finally{m.restore()}
});
test('admin reset audits first and returns a temporary password once without changing role metadata',async()=>{
  const m=mock({role:'site_admin'});try{
    const r=await worker.fetch(request('/api/admin/users/password',
      {user_id:OTHER,reason:'تم التحقق من هوية صاحب الحساب'},cookies),ENV);
    assert.equal(r.status,200);
    const result=await r.json();assert.equal(result.temporary_password.length,24);
    const audit=m.events.find(x=>x.path==='/rest/v1/site_admin_audit');
    const reset=m.events.find(x=>x.path==='/auth/v1/admin/users/'+OTHER && x.method==='PUT');
    assert.ok(audit&&reset);
    assert.ok(m.events.indexOf(audit)<m.events.indexOf(reset));
    assert.equal(audit.body.details.reason,'تم التحقق من هوية صاحب الحساب');
    assert.equal(JSON.stringify(audit.body).includes(result.temporary_password),false);
    assert.equal(reset.body.app_metadata.provider,'email');
    assert.equal(reset.body.app_metadata.itqan_force_password_change,true);
  }finally{m.restore()}
});
test('failed audit blocks administrative password change',async()=>{
  const m=mock({role:'site_admin',auditOk:false});try{
    const r=await worker.fetch(request('/api/admin/users/password',
      {user_id:OTHER,reason:'تم التحقق من هوية صاحب الحساب'},cookies),ENV);
    assert.equal(r.status,502);assert.equal(m.events.some(x=>x.path==='/auth/v1/admin/users/'+OTHER&&x.method==='PUT'),false);
  }finally{m.restore()}
});
test('temporary password prevents access until user changes it',async()=>{
  const m=mock({forced:true});try{
    const page=await worker.fetch(new Request(ORIGIN+'/school.html',{headers:{cookie:cookies}}),ENV);
    assert.equal(page.status,302);assert.equal(page.headers.get('location'),'/password.html');
    const protectedApi=await worker.fetch(new Request(ORIGIN+'/api/schools',{headers:{cookie:cookies}}),ENV);
    assert.equal(protectedApi.status,401);
    const session=await worker.fetch(new Request(ORIGIN+'/api/session',{headers:{cookie:cookies}}),ENV);
    assert.equal((await session.json()).user.mustChangePassword,true);
  }finally{m.restore()}
});
test('forced change updates password and clears only application forced-change metadata',async()=>{
  const m=mock({forced:true});try{
    const r=await worker.fetch(request('/api/password/change',{password:'some-new-secure-password'},cookies),ENV);
    assert.equal(r.status,200);
    const reset=m.events.find(x=>x.path==='/auth/v1/admin/users/'+ID && x.method==='PUT');
    assert.ok(reset);assert.equal(reset.body.app_metadata.itqan_force_password_change,undefined);
    assert.equal(reset.body.app_metadata.provider,'email');
  }finally{m.restore()}
});
test('ordinary password change requires current password validation',async()=>{
  const m=mock();try{
    const r=await worker.fetch(request('/api/password/change',{password:'some-new-secure-password'},cookies),ENV);
    assert.equal(r.status,400);assert.equal(m.events.some(x=>x.method==='PUT'),false);
  }finally{m.restore()}
});
test('public recovery and password screens are routed without authentication',async()=>{
  const m=mock();try{
    for(const path of ['/recover.html','/password.html']){
      const r=await worker.fetch(new Request(ORIGIN+path),ENV);assert.equal(r.status,200);
    }
  }finally{m.restore()}
});
test('new client code never uses browser alert, prompt or confirm dialogs',()=>{
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const recovery=readFileSync(new URL('../public/recover.html',import.meta.url),'utf8');
  const password=readFileSync(new URL('../public/password.html',import.meta.url),'utf8');
  for(const s of [app,recovery,password])assert.doesNotMatch(s,/window\.(alert|prompt|confirm)\s*\(/);
});
