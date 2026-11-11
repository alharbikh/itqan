// Manual-only production deploy wrapper with auditable Git commit metadata.
// Does not run unless explicitly authorized. Never stores credentials or tokens.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function makeVersionMetadata(sha) {
 if (!/^[a-f0-9]{40}$/.test(sha))
  throw new Error('Expected full 40-character Git commit SHA');
 return {
  tag:'git-'+sha.slice(0,12),
  message:'itqan main git:'+sha,
 };
}
export function validateDeployContext({approved,branch,dirty,sha}) {
 if(approved!=='yes')
  throw new Error('Production deploy requires ITQAN_APPROVE_PRODUCTION_DEPLOY=yes');
 if(branch!=='main')
  throw new Error('Production deploy requires the main branch');
 if(dirty)
  throw new Error('Working tree must be clean before production deploy');
 return makeVersionMetadata(sha);
}

const execGit=(...args)=>{
 const r=spawnSync('git',args,{encoding:'utf8'});
 if(r.status!==0)throw new Error('Git command failed: '+args.join(' '));
 return r.stdout.trim();
};
export async function runManualDeploy({env=process.env,spawn=spawnSync,git=execGit}={}) {
 // No deployment happens until these checks pass.
 const sha=git('rev-parse','HEAD');
 const branch=git('symbolic-ref','--short','HEAD');
 const dirty=Boolean(git('status','--porcelain'));
 const version=validateDeployContext({
  approved:env.ITQAN_APPROVE_PRODUCTION_DEPLOY,
  sha,branch,dirty
 });
 const argv=['wrangler','deploy','--tag',version.tag,'--message',version.message,'--strict'];
 if(env.ITQAN_DEPLOY_DRY_RUN==='yes'){
  return {dryRun:true,argv,sha};
 }
 const r=spawn('npx',argv,{stdio:'inherit',shell:false,env});
 if(r.status!==0)throw new Error('Wrangler deployment failed (exit '+r.status+')');
 return {dryRun:false,sha,tag:version.tag};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 runManualDeploy().then(result=>console.log(JSON.stringify(result)))
 .catch(e=>{console.error(e.message);process.exitCode=1});
}
