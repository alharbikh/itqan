// Production smoke: anonymous read-only GETs for public immutable UI assets.
// No cookies, credentials, POST/PUT/DELETE, user data, or browser actions.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const base=process.env.ITQAN_PUBLIC_BASE_URL||'https://itqan.khmobgm.workers.dev';
const files=['app.css','app.js','school.js','admin.js','performance.js','frameworks.js','link.js',
 'school-invitations.js','invitations.js','school-registration.js','personal.js',
 'personnel-import-ui.js','personnel-import-csv.js'];

function sha256(bytes){return createHash('sha256').update(bytes).digest('hex')}

export async function verifyPublicAssets({origin=base,assets=files,fetcher=fetch,reader=readFile}={}) {
 const results=[];
 const target=new URL(origin);
 if(target.protocol!=='https:')throw new Error('Read-only verification requires HTTPS');
 for(const name of assets) {
   if(!/^[a-z0-9_-]+\.(js|css)$/.test(name))
     throw new Error('Unexpected asset path: '+name);
   const expected=await reader(new URL('../public/'+name,import.meta.url));
   const uri=new URL('/'+name,target);
   uri.searchParams.set('itqan_verify',sha256(expected).slice(0,12));
   const response=await fetcher(uri,{method:'GET',headers:{Accept:'text/css, application/javascript, */*'}});
   if(response.status!==200)throw new Error(name+' returned HTTP '+response.status);
   const type=response.headers.get('content-type')||'';
   if(!/(javascript|css|text\/plain)/i.test(type))
     throw new Error(name+' was served with unexpected content type: '+type);
   const actual=Buffer.from(await response.arrayBuffer());
   if(sha256(actual)!==sha256(expected))throw new Error(
     name+' differs from repository: expected '+sha256(expected)+', deployed '+sha256(actual));
   results.push({asset:name,bytes:expected.length,sha256:sha256(expected)});
 }
 return results;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
 verifyPublicAssets().then(results=>{
   console.log(JSON.stringify({base,verified:results.length,assets:results},null,2));
 }).catch(err=>{console.error(err.message);process.exitCode=1;});
}
