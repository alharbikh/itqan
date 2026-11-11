import test from 'node:test';
import assert from 'node:assert/strict';
import {makeVersionMetadata,validateDeployContext,runManualDeploy}
 from '../scripts/deploy-itqan-reviewed.mjs';

const sha='a'.repeat(40);
test('Wrangler version metadata includes immutable Git SHA',()=>{
 assert.deepEqual(makeVersionMetadata(sha),{
  tag:'git-'+sha.slice(0,12),message:'itqan main git:'+sha
 });
 assert.throws(()=>makeVersionMetadata('not-a-sha'),/40-character/);
});
test('production deployment requires explicit approval, clean main branch',()=>{
 for(const x of [
  {approved:'',branch:'main',dirty:false,sha},
  {approved:'yes',branch:'feature',dirty:false,sha},
  {approved:'yes',branch:'main',dirty:true,sha},
 ])assert.throws(()=>validateDeployContext(x));
 assert.equal(validateDeployContext({approved:'yes',branch:'main',dirty:false,sha}).tag,'git-'+sha.slice(0,12));
});
test('dry run never launches npx deployment',async()=>{
 let launches=0;
 const commands={
  'rev-parse HEAD':sha,
  'symbolic-ref --short HEAD':'main',
  'status --porcelain':''
 };
 const git=(...args)=>commands[args.join(' ')];
 const result=await runManualDeploy({
  git,env:{ITQAN_APPROVE_PRODUCTION_DEPLOY:'yes',ITQAN_DEPLOY_DRY_RUN:'yes'},
  spawn:()=>{launches++;throw Error('No deployment allowed in tests')}
 });
 assert.equal(result.dryRun,true);
 assert.equal(launches,0);
 assert.deepEqual(result.argv,[
  'wrangler','deploy','--tag','git-'+sha.slice(0,12),
  '--message','itqan main git:'+sha,'--strict'
 ]);
});
test('without owner approval neither dry run nor production can launch deploy',async()=>{
 let launches=0;
 await assert.rejects(()=>runManualDeploy({
  git:(...args)=>({
   'rev-parse HEAD':sha,
   'symbolic-ref --short HEAD':'main',
   'status --porcelain':''
  })[args.join(' ')],
  env:{},
  spawn:()=>{launches++}
 }),/requires ITQAN_APPROVE_PRODUCTION_DEPLOY/);
 assert.equal(launches,0);
});
