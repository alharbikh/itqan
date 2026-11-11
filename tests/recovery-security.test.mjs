import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const origin='https://itqan.example';
const userId='00000000-0000-4000-8000-000000000001';
const env={
  SUPABASE_URL:'https://itqan-test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY:'sb_publishable_unit_test_only',
};
const post=(path,payload,headers={})=>new Request(origin+path,{
  method:'POST',headers:{origin,'content-type':'application/json',...headers},
  body:JSON.stringify(payload),
});
const cookie={cookie:'__Host-itqan_at=opaque-access-token'};

test('self-service recovery never enumerates account existence or upstream delivery failures',async()=>{
  const previous=globalThis.fetch;
  const responses=[Response.json({ok:true}),Response.json({message:'not found'},{status:404}),
    Response.json({message:'SMTP failed'},{status:503})];
  let calls=0;
  globalThis.fetch=async(url)=>{assert.equal(new URL(url).pathname,'/auth/v1/recover');return responses[calls++];};
  try{
    const visible=[];
    for(let i=0;i<responses.length;i++){
      const r=await worker.fetch(post('/api/password/recovery/request',{email:'someone@example.invalid'}),env);
      assert.equal(r.status,202);
      visible.push(await r.json());
    }
    assert.equal(calls,3);
    assert.deepEqual(visible[0],visible[1]);
    assert.deepEqual(visible[1],visible[2]);
  }finally{globalThis.fetch=previous;}
});

test('invalid recovery inputs do not contact Supabase',async()=>{
  const previous=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('No network expected');};
  try{
    const invalid=[
      {email:'not-an-email',code:'123456',password:'goodpassword'},
      {email:'someone@example.invalid',code:'not-code',password:'goodpassword'},
      {email:'someone@example.invalid',code:'123456',password:'123'},
      {email:'someone@example.invalid',code:'123456',password:'goodpassword',role:'site_admin'},
    ];
    for(const item of invalid){
      const r=await worker.fetch(post('/api/password/recovery/complete',item),env);
      assert.equal(r.status,400);
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=previous;}
});

test('school employee is forbidden from administrative account recovery',async()=>{
  const previous=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url)=>{
    const path=new URL(url).pathname;calls.push(path);
    if(path==='/auth/v1/user')return Response.json({id:userId,email:'staff@example.invalid'});
    if(path==='/rest/v1/users')return Response.json([{id:userId,status:'active',full_name:'موظف'}]);
    if(path==='/rest/v1/user_roles')return Response.json([]);
    if(path==='/rest/v1/school_memberships')return Response.json([]);
    throw Error('Administrative recovery upstream must not be called: '+path);
  };
  try{
    const target='00000000-0000-4000-8000-000000000002';
    const r=await worker.fetch(post('/api/admin/users/password',{
      user_id:target,reason:'التحقق من هوية صاحب الحساب',mode:'temporary',
    },cookie),env);
    assert.equal(r.status,403);
    assert.equal(calls.some(x=>x.includes('functions/v1/itqan-account-recovery')),false);
  }finally{globalThis.fetch=previous;}
});
