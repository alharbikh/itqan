import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

const SOURCE=readFileSync(new URL('../supabase/functions/itqan-account-recovery/index.ts',import.meta.url),'utf8');
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const invoke=(handler,body)=>handler(new Request('https://itqan-test.supabase.co/functions/v1/itqan-account-recovery',{
  method:'POST',headers:{authorization:'Bearer user-session','content-type':'application/json'},
  body:JSON.stringify(body)}));
function setup({admin=false,forced=false,invalidToken=false,auditFailure=false,badCurrent=false}={}){
  const calls=[];let handler;
  const fetchMock=async (url,init={})=>{
    const u=new URL(url),path=u.pathname,method=init.method||'GET';
    const body=init.body?JSON.parse(init.body):null;
    const event={path,method,body,headers:init.headers};calls.push(event);
    const ok=data=>Response.json(data),error=(status=403)=>Response.json({error:'denied'},{status});
    if(path==='/auth/v1/user'){
      if(invalidToken)return error(401);
      if(method==='PUT')return ok({id:ID});
      return ok({id:ID,email:'staff@example.test',
        app_metadata:forced?{provider:'email',itqan_force_password_change:true}:{}});
    }
    if(path==='/rest/v1/users'){
      return ok([{id:u.searchParams.get('id')?.endsWith(OTHER)?OTHER:ID,status:'active'}]);
    }
    if(path==='/rest/v1/user_roles')return ok(admin?[{role_code:'site_admin'}]:[]);
    if(path==='/rest/v1/site_admin_audit')return auditFailure?error(500):ok({});
    if(path==='/auth/v1/admin/users/'+OTHER){
      return method==='PUT'?ok({id:OTHER}):
        ok({id:OTHER,email:'target@example.test',app_metadata:{provider:'email'}});
    }
    if(path==='/auth/v1/admin/users/'+ID)return ok({id:ID});
    if(path==='/auth/v1/recover')return ok({});
    if(path==='/auth/v1/token')return badCurrent?error(400):ok({access_token:'new-token'});
    throw Error('Unexpected '+path);
  };
  const secrets={SUPABASE_URL:'https://itqan-test.supabase.co',
    SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_secret_local_test_never_real'}),
    SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:'sb_publishable_local_test'})};
  runInNewContext(SOURCE,{Deno:{env:{get:key=>secrets[key]},serve:fn=>{handler=fn}},
    Response,Request,fetch:fetchMock,crypto:webcrypto,Date,URL,JSON,Uint8Array,encodeURIComponent,
  });
  assert.equal(typeof handler,'function');
  return {handler,calls};
}
test('Edge rejects requests without valid Supabase authentication',async()=>{
  const m=setup({invalidToken:true});
  const r=await invoke(m.handler,{action:'admin_recover',user_id:OTHER,mode:'temporary',reason:'admin checked identity'});
  assert.equal(r.status,401);
  assert.equal(m.calls.some(c=>c.path==='/auth/v1/admin/users/'+OTHER),false);
});
test('Edge independently denies ordinary users even when bypassing Cloudflare Worker',async()=>{
  const m=setup();
  const r=await invoke(m.handler,{action:'admin_recover',user_id:OTHER,mode:'temporary',reason:'admin checked identity'});
  assert.equal(r.status,403);
  assert.equal(m.calls.some(c=>c.path==='/rest/v1/site_admin_audit'),false);
});
test('Edge requires audit before changing target credentials',async()=>{
  const m=setup({admin:true,auditFailure:true});
  const r=await invoke(m.handler,{action:'admin_recover',user_id:OTHER,mode:'temporary',reason:'admin checked identity'});
  assert.equal(r.status,502);
  assert.equal(m.calls.some(c=>c.path==='/auth/v1/admin/users/'+OTHER&&c.method==='PUT'),false);
});
test('Edge grants random temporary password and preserves role metadata',async()=>{
  const m=setup({admin:true});
  const r=await invoke(m.handler,{action:'admin_recover',user_id:OTHER,mode:'temporary',reason:'admin checked identity'});
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(data.temporary_password.length,32);
  const audit=m.calls.find(c=>c.path==='/rest/v1/site_admin_audit');
  const update=m.calls.find(c=>c.path==='/auth/v1/admin/users/'+OTHER&&c.method==='PUT');
  assert.ok(audit&&update);
  assert.ok(m.calls.indexOf(audit)<m.calls.indexOf(update));
  assert.equal(update.body.app_metadata.provider,'email');
  assert.equal(update.body.app_metadata.itqan_force_password_change,true);
  assert.equal(JSON.stringify(audit).includes(data.temporary_password),false);
});
test('Edge sends recovery email without changing target password',async()=>{
  const m=setup({admin:true});
  const r=await invoke(m.handler,{action:'admin_recover',user_id:OTHER,mode:'email',reason:'admin checked identity'});
  assert.equal(r.status,200);
  assert.ok(m.calls.some(c=>c.path==='/auth/v1/recover'));
  assert.equal(m.calls.some(c=>c.path==='/auth/v1/admin/users/'+OTHER&&c.method==='PUT'),false);
});
test('Edge rejects incorrect temporary password before updating credentials',async()=>{
  const m=setup({forced:true,badCurrent:true});
  const r=await invoke(m.handler,{action:'change_forced',password:'long-new-password',current_password:'wrong-secret'});
  assert.equal(r.status,403);
  assert.equal(m.calls.some(c=>c.path==='/auth/v1/user'&&c.method==='PUT'),false);
});
test('Edge removes only its own forced-password metadata after verified change',async()=>{
  const m=setup({forced:true});
  const r=await invoke(m.handler,{action:'change_forced',password:'long-new-password',current_password:'old-temporary'});
  assert.equal(r.status,200);
  const change=m.calls.find(c=>c.path==='/auth/v1/user'&&c.method==='PUT');
  const clear=m.calls.find(c=>c.path==='/auth/v1/admin/users/'+ID&&c.method==='PUT');
  assert.ok(change&&clear);
  assert.equal(clear.body.app_metadata.provider,'email');
  assert.equal(clear.body.app_metadata.itqan_force_password_change,undefined);
});
