import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';

const ORIGIN='https://itqan.example';
const SCHOOL_A='a4444444-4444-4444-8444-444444444444';
const SCHOOL_B='a5555555-5555-4555-8555-555555555555';
const ADMIN='a1111111-1111-4111-8111-111111111111';
const PRINCIPAL='a2222222-2222-4222-8222-222222222222';
const ENV={
 SUPABASE_URL:'https://itqan-test.supabase.co',
 SUPABASE_PUBLISHABLE_KEY:'sb_publishable_unit_test_only',
 ASSETS:{fetch:async request=>new Response(
   '<main data-access-state="default">Access gate</main>',
   {status:200,headers:{'content-type':'text/html'}})},
};
const COOKIE={cookie:'__Host-itqan_at=access-test'};

async function withRole(role,memberships,fn){
 const previous=globalThis.fetch;
 const calls=[];
 globalThis.fetch=async (url,init={})=>{
  const path=new URL(url).pathname;calls.push({path,headers:init.headers});
  if(path==='/auth/v1/user')return Response.json({id:role==='site_admin'?ADMIN:PRINCIPAL,email:'test@itqan.invalid'});
  if(path==='/rest/v1/users')return Response.json([{id:role==='site_admin'?ADMIN:PRINCIPAL,full_name:'مستخدم الاختبار',status:'active'}]);
  if(path==='/rest/v1/user_roles')return Response.json(role==='site_admin'?[{role_code:'site_admin'}]:[]);
  if(path==='/rest/v1/school_memberships')return Response.json(memberships);
  if(path==='/rest/v1/schools')return Response.json([{id:SCHOOL_A,name:'A',status:'active'},{id:SCHOOL_B,name:'B',status:'active'}]);
  throw Error('Unexpected network request: '+path);
 };
 try{await fn(calls);}finally{globalThis.fetch=previous;}
}
async function get(path){return worker.fetch(new Request(ORIGIN+path,{headers:COOKIE}),ENV)}
const schoolMember=(id,access_role='school_principal')=>({school_id:id,access_role,job_role:access_role==='school_principal'?'principal':'teacher',status:'active'});

test('site manager without a school principal membership cannot open school operational tools',async()=>{
 await withRole('site_admin',[],async calls=>{
  assert.equal((await get('/api/session')).status,200);
  assert.equal((await get('/school.html')).status,403);
  assert.equal((await get('/api/school/members?school_id='+SCHOOL_A)).status,403);
  assert.equal((await get('/admin.html')).status,200);
  assert.equal(calls.filter(x=>x.path==='/rest/v1/school_memberships').length,4);
  assert.equal(calls.some(x=>x.path==='/rest/v1/schools'),false);
 });
});

test('dual-role site manager with a principal membership can manage only that school',async()=>{
 await withRole('site_admin',[schoolMember(SCHOOL_A)],async ()=>{
  assert.equal((await get('/admin.html')).status,200);
  assert.equal((await get('/school.html')).status,200);
  const own=await get('/api/school/members?school_id='+SCHOOL_A);
  assert.equal(own.status,200);
  assert.deepEqual((await own.json()).members,[]);
  assert.equal((await get('/api/school/members?school_id='+SCHOOL_B)).status,403);
 });
});

test('employee membership does not become principal because account also has site role',async()=>{
 await withRole('site_admin',[schoolMember(SCHOOL_A,'employee')],async ()=>{
  assert.equal((await get('/school.html')).status,200);
  assert.equal((await get('/api/school/members?school_id='+SCHOOL_A)).status,403);
  assert.equal((await get('/admin.html')).status,200);
 });
});

test('principal without site-admin privileges cannot enter system admin pages or another school',async()=>{
 await withRole('member',[schoolMember(SCHOOL_B)],async()=>{
  assert.equal((await get('/school.html')).status,200);
  assert.equal((await get('/admin.html')).status,403);
  assert.equal((await get('/api/school/members?school_id='+SCHOOL_A)).status,403);
 });
});

test('school dashboard has no central-site role bypasses',()=>{
 const dashboard=readFileSync(new URL('../public/school.js',import.meta.url),'utf8');
 assert.match(dashboard,/return m\?\.access_role==='school_principal'/);
 assert.doesNotMatch(dashboard,/state\.user\?\.role==='site_admin'\|\|/);
 assert.doesNotMatch(dashboard,/s=>state\.user\.role==='site_admin'\|\|granted\.has\(s\.id\)/);
});
