// Read-only verification of the original Worker source embedded in a
// Cloudflare /content/v2 multipart script export. No deployment or mutation.
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function gitBlobSha(source) {
  const body=Buffer.from(source,'utf8');
  return createHash('sha1').update(Buffer.from(`blob ${body.length}\0`)).update(body).digest('hex');
}

export function extractWorkerSource(multipart) {
  const raw=Buffer.isBuffer(multipart)?multipart.toString('utf8'):String(multipart);
  const part=/Content-Disposition: form-data; name="worker\.js\.map"; filename="worker\.js\.map"\r?\nContent-Type: application\/source-map\r?\n\r?\n/;
  const match=part.exec(raw);
  if(!match)throw new Error('Worker source map part missing in content/v2 response');
  const start=match.index+match[0].length;
  const end=raw.indexOf('\r\n--',start);
  if(end<0)throw new Error('Source map multipart boundary not found');
  const map=JSON.parse(raw.slice(start,end));
  const index=map.sources?.indexOf('src/worker.js')??-1;
  if(index<0||typeof map.sourcesContent?.[index]!=='string')
    throw new Error('Missing unmodified src/worker.js source content');
  return map.sourcesContent[index];
}

export async function verifyWorkerBundle(bundle,sourceText) {
  const deployed=extractWorkerSource(bundle);
  const expected=gitBlobSha(sourceText);
  const actual=gitBlobSha(deployed);
  if(actual!==expected)throw new Error(
    `Live Worker source mismatch: deployed ${actual}, repository ${expected}`);
  return {source:'src/worker.js',gitBlobSha:actual,bytes:Buffer.byteLength(deployed,'utf8')};
}

async function main() {
  const src=await readFile(resolve('src/worker.js'),'utf8');
  let bundle;
  const file=process.argv.indexOf('--bundle');
  if(file!==-1) {
    if(!process.argv[file+1])throw new Error('Pass the exported multipart filename');
    bundle=await readFile(resolve(process.argv[file+1]));
  }else{
    const token=process.env.CLOUDFLARE_API_TOKEN;
    const account=process.env.CLOUDFLARE_ACCOUNT_ID;
    if(!token||!account)throw new Error(
      'Use --bundle <file>, or provide CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID');
    const r=await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/scripts/itqan/content/v2`,
      {headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
    if(!r.ok)throw new Error(`Cloudflare export failed: HTTP ${r.status}`);
    bundle=Buffer.from(await r.arrayBuffer());
  }
  const result=await verifyWorkerBundle(bundle,src);
  process.stdout.write(JSON.stringify({...result,verified:true})+'\n');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  main().catch(err=>{console.error(err.message);process.exitCode=1});
}
