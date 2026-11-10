import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const origin='https://itqan.example';
const env={SUPABASE_URL:'https://itqan-test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test_only',
 ASSETS:{fetch:async()=>new Response('page')}};
const owner='11111111-1111-4111-8111-111111111111';
const someoneElse='22222222-2222-4222-8222-222222222222';
const evidence='33333333-3333-4333-8333-333333333333';
const attachment='44444444-4444-4444-8444-444444444444';
const token='test-token';
const memberHeaders={cookie:'__Host-itqan_at='+token};
const pdf=Buffer.from('%PDF-1.7\none-page\n');
const storedKey=owner+'/'+evidence+'/'+attachment+'.pdf';

function fakeNetwork(){
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options={})=>{
  const route=new URL(url),path=route.pathname;
  calls.push({path,method:options.method||'GET'});
  const ok=v=>Response.json(v);
  if(path==='/auth/v1/user')return ok({id:owner,email:'owner@example.invalid'});
  if(path==='/rest/v1/users')return ok([{id:owner,full_name:'موظف',status:'active'}]);
  if(path==='/rest/v1/user_roles')return ok([]);
  if(path==='/rest/v1/school_memberships')return ok([{school_id:'school-a',access_role:'employee',status:'active'}]);
  if(path==='/rest/v1/personal_evidence')return ok([{id:evidence}]);
  if(path==='/rest/v1/personal_evidence_attachments'){
   if(options.method==='POST')return ok([{id:attachment,evidence_id:evidence,
      original_filename:'report.pdf',mime_type:'application/pdf',byte_size:pdf.length}]);
   if(options.method==='DELETE')return ok([]);
   if(route.searchParams.get('select')==='id')return ok([]);
   return ok([{id:attachment,evidence_id:evidence,user_id:owner,
     object_name:storedKey,original_filename:'report.pdf',
     mime_type:'application/pdf',byte_size:pdf.length}]);
  }
  if(path.startsWith('/storage/v1/object/authenticated/'))return new Response(pdf,{status:200});
  if(path.startsWith('/storage/v1/object/'))return ok({Key:storedKey});
  throw Error('Unexpected upstream: '+path);
 };
 return {calls,restore(){globalThis.fetch=original;}};
}
function request(path,method='GET',body,headers={}){
 return new Request(origin+path,{method,headers:{...memberHeaders,...headers},...(body?{body}:{})});
}
test('rejects unauthenticated attachment reads without touching Storage',async()=>{
 const stub=fakeNetwork();
 try{const r=await worker.fetch(new Request(origin+'/api/evidence/attachments?evidence_id='+evidence),env);
  assert.equal(r.status,401);assert.equal(stub.calls.filter(x=>x.path.startsWith('/storage/')).length,0);
 }finally{stub.restore();}
});
test('uploads PDF to private Storage with employee JWT and no browser token',async()=>{
 const stub=fakeNetwork();
 try{
  const form=new FormData();form.append('evidence_id',evidence);
  form.append('file',new Blob([pdf],{type:'application/pdf'}),'report.pdf');
  const res=await worker.fetch(request('/api/evidence/attachments','POST',form,{origin}),env);
  assert.equal(res.status,201,await res.text().catch(()=>'')); // Response.json body was consumed by assertion only on error
  assert.equal(stub.calls.some(x=>x.method==='POST'&&x.path.startsWith('/storage/v1/object/itqan-personal-evidence/')),true);
  assert.equal(stub.calls.some(x=>x.method==='POST'&&x.path==='/rest/v1/personal_evidence_attachments'),true);
 }finally{stub.restore();}
});
test('rejects oversized files and files with mismatched magic bytes before storage',async()=>{
 const stub=fakeNetwork();
 try{
  for(const [bytes,status] of [[Buffer.alloc(5*1024*1024+1),413],[Buffer.from('not a pdf'),415]]){
   const form=new FormData();form.append('evidence_id',evidence);
   form.append('file',new Blob([bytes],{type:'application/pdf'}),'report.pdf');
   const res=await worker.fetch(request('/api/evidence/attachments','POST',form,{origin}),env);
   assert.equal(res.status,status);
  }
  assert.equal(stub.calls.some(x=>x.path.startsWith('/storage/v1/object/')),false);
 }finally{stub.restore();}
});
test('only logged-in owner downloads file as attachment, not inline',async()=>{
 const stub=fakeNetwork();
 try{
  const res=await worker.fetch(request('/api/evidence/attachments/'+attachment+'/download'),env);
  assert.equal(res.status,200);
  assert.match(res.headers.get('content-disposition'),/attachment;/);
  assert.equal(res.headers.get('cache-control'),'no-store');
  assert.equal(Buffer.compare(Buffer.from(await res.arrayBuffer()),pdf),0);
 }finally{stub.restore();}
});
test('rejects access when school_id is supplied by a non-principal',async()=>{
 const stub=fakeNetwork();
 try{
  const res=await worker.fetch(request('/api/evidence/attachments?evidence_id='+evidence+'&school_id=another-school'),env);
  assert.equal(res.status,403);
  assert.equal(stub.calls.some(x=>x.path==='/rest/v1/personal_evidence_attachments'),false);
 }finally{stub.restore();}
});
