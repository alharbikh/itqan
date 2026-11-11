import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyWorkerBundle,extractWorkerSource,gitBlobSha} from '../scripts/verify-deployed-worker.mjs';
import {verifyPublicAssets} from '../scripts/verify-public-assets.mjs';

const bundleFor=source=>{
 const map={version:3,file:'worker.js',sources:['src/worker.js'],sourcesContent:[source],names:[],mappings:''};
 return '--audit-boundary\r\nContent-Disposition: form-data; name="worker.js"; filename="worker.js"\r\nContent-Type: application/javascript\r\n\r\ncompiled\r\n--audit-boundary\r\nContent-Disposition: form-data; name="worker.js.map"; filename="worker.js.map"\r\nContent-Type: application/source-map\r\n\r\n'+JSON.stringify(map)+'\r\n--audit-boundary--\r\n';
};

test('production bundle provenance verifies byte-identical source from embedded map',async()=>{
 const source='export default {fetch() { return new Response("إتقان") }};\n';
 const result=await verifyWorkerBundle(bundleFor(source),source);
 assert.equal(result.gitBlobSha,gitBlobSha(source));
 assert.equal(result.bytes,Buffer.byteLength(source,'utf8'));
 assert.equal(extractWorkerSource(bundleFor(source)),source);
 await assert.rejects(()=>verifyWorkerBundle(bundleFor(source),'// another version'),/source mismatch/);
 assert.throws(()=>extractWorkerSource('unrelated response'),/source map part missing/);
});

test('public asset verifier compares content hashes without credentials or writes',async()=>{
 const calls=[];
 const fetcher=async(url,options)=>{
   calls.push({url,options});
   assert.equal(options.method,'GET');
   assert.equal(new URL(url).protocol,'https:');
   return new Response('asset-contents',{status:200,headers:{'content-type':'application/javascript'}});
 };
 const results=await verifyPublicAssets({
  origin:'https://example.invalid',
  assets:['sample.js'],
  reader:async()=>Buffer.from('asset-contents'),
  fetcher
 });
 assert.equal(results.length,1);
 assert.equal(calls.length,1);
 assert.equal(calls[0].url.pathname,'/sample.js');
 assert.ok(calls[0].url.searchParams.has('itqan_verify'));
 assert.equal(results[0].sha256,createHash('sha256').update('asset-contents').digest('hex'));
});

test('asset provenance fails closed for stale files or auth redirects',async()=>{
 const args={origin:'https://example.invalid',assets:['sample.js'],reader:async()=>Buffer.from('new version')};
 await assert.rejects(()=>verifyPublicAssets({...args,fetcher:async()=>new Response('old version',{status:200,headers:{'content-type':'application/javascript'}})}),/differs from repository/);
 await assert.rejects(()=>verifyPublicAssets({...args,fetcher:async()=>Response.redirect('https://example.invalid/login.html')}),/HTTP 302/);
 await assert.rejects(()=>verifyPublicAssets({...args,assets:['../unsafe.js']}),/Unexpected asset path/);
});
