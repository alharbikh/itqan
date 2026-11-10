// Itqan Smart Pro — privileged password operations hosted inside Supabase.
// The function validates user access tokens itself; no browser ever receives the secret key.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')?.replace(/\/+$/, '');
const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
const publishableKeys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
function keyFrom(value) {
  try { return JSON.parse(value || '{}').default || ''; } catch { return ''; }
}
const ADMIN_KEY = keyFrom(secretKeys) || legacyKey || '';
const PUBLIC_KEY = keyFrom(publishableKeys) || Deno.env.get('SUPABASE_ANON_KEY') || '';
const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const emailValid = x => typeof x === 'string' && x.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x);
const passwordValid = x => typeof x === 'string' && x.length >= 8 && x.length <= 1024;
const json = (data, status=200) => Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function call(path, method='GET', body, key=ADMIN_KEY,
                    bearer=key.startsWith('sb_')?null:key) {
  // Opaque sb_secret_* and sb_publishable_* keys are API keys, never JWTs.
  const r=await fetch(SUPABASE_URL+path,{method,headers:{apikey:key,
    ...(bearer?{authorization:'Bearer '+bearer}:{}),
    'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let data=null;try{data=await r.json()}catch{}
  return {ok:r.ok,status:r.status,data};
}
function temporaryPassword() {
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
  return [...bytes].map(b=>alphabet[b%alphabet.length]).join('');
}
async function handler(req) {
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  if(!SUPABASE_URL || !ADMIN_KEY || !PUBLIC_KEY)return json({error:'Recovery service not configured'},503);
  let body;
  try{body=await req.json()}catch{return json({error:'Invalid JSON'},400)}
  if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Invalid request'},400);
  if(body.action==='complete_recovery'){
    if(!emailValid(body.email)||typeof body.code!=='string'||!/^[0-9]{6,8}$/.test(body.code)||
      !passwordValid(body.password)||Object.keys(body).some(k=>!['action','email','code','password'].includes(k)))
      return json({error:'Invalid recovery request'},400);
    const verified=await call('/auth/v1/verify','POST',
      {type:'recovery',email:body.email.trim(),token:body.code},PUBLIC_KEY,null);
    if(!verified.ok||!verified.data?.access_token||!verified.data?.refresh_token)
      return json({error:'Invalid or expired recovery code'},400);
    const user=await call('/auth/v1/user','GET',undefined,PUBLIC_KEY,verified.data.access_token);
    if(!user.ok||!uuid(user.data?.id))return json({error:'Invalid recovery account'},403);
    const profile=await call('/rest/v1/users?select=id,status&id=eq.'+encodeURIComponent(user.data.id));
    if(!profile.ok||profile.data?.length!==1||profile.data[0].status!=='active')
      return json({error:'Account not active'},403);
    const identity=await call('/auth/v1/admin/users/'+encodeURIComponent(user.data.id));
    const account=identity.data?.user||identity.data;
    if(!identity.ok||account?.id!==user.data.id)return json({error:'Account unavailable'},502);
    const app={...(account.app_metadata||{})};
    delete app.itqan_force_password_change;
    delete app.itqan_temp_password_expires_at;
    const changed=await call('/auth/v1/admin/users/'+encodeURIComponent(user.data.id),'PUT',
      {password:body.password,app_metadata:app});
    if(!changed.ok)return json({error:'Password rejected'},422);
    return json({ok:true,access_token:verified.data.access_token,
      refresh_token:verified.data.refresh_token,expires_in:verified.data.expires_in});
  }
  const bearer=req.headers.get('authorization')||'';
  if(!/^Bearer \S+$/.test(bearer))return json({error:'Unauthorized'},401);
  const token=bearer.slice(7);
  const auth=await call('/auth/v1/user','GET',undefined,PUBLIC_KEY,token);
  if(!auth.ok||!uuid(auth.data?.id))return json({error:'Unauthorized'},401);
  const actor=auth.data.id;
  const profile=await call('/rest/v1/users?select=id,status&id=eq.'+encodeURIComponent(actor));
  if(!profile.ok||profile.data?.length!==1||profile.data[0].status!=='active')
    return json({error:'Unauthorized'},401);
  if(body.action==='change_forced'){
    if(!passwordValid(body.password)||typeof body.current_password!=='string'||!body.current_password||
      body.password===body.current_password||
      Object.keys(body).some(k=>!['action','password','current_password'].includes(k)))
      return json({error:'Invalid password change'},400);
    const forced=auth.data.app_metadata?.itqan_force_password_change===true;
    if(!forced)return json({error:'Not a temporary-password account'},403);
    const expiry=Date.parse(auth.data.app_metadata?.itqan_temp_password_expires_at||'');
    if(Number.isFinite(expiry)&&Date.now()>expiry)
      return json({error:'Temporary password expired',code:'TEMP_PASSWORD_EXPIRED'},403);
    if(!emailValid(auth.data.email))return json({error:'Email unavailable'},422);
    const verified=await call('/auth/v1/token?grant_type=password','POST',
      {email:auth.data.email,password:body.current_password},PUBLIC_KEY,null);
    if(!verified.ok)return json({error:'Invalid current password'},403);
    const changed=await call('/auth/v1/user','PUT',{password:body.password},PUBLIC_KEY,token);
    if(!changed.ok)return json({error:'Password rejected'},422);
    const app={...auth.data.app_metadata};
    delete app.itqan_force_password_change;
    delete app.itqan_temp_password_expires_at;
    const cleared=await call('/auth/v1/admin/users/'+encodeURIComponent(actor),'PUT',{app_metadata:app});
    if(!cleared.ok)return json({error:'Could not complete account unlock'},502);
    return json({ok:true});
  }
  if(body.action!=='admin_recover')return json({error:'Unknown action'},400);
  const roles=await call('/rest/v1/user_roles?select=role_code&user_id=eq.'+encodeURIComponent(actor));
  if(!roles.ok||!Array.isArray(roles.data)||!roles.data.some(r=>r.role_code==='site_admin'))
    return json({error:'Forbidden'},403);
  if(!uuid(body.user_id)||actor===body.user_id||
    !['temporary','email'].includes(body.mode)||typeof body.reason!=='string'||
    body.reason.trim().length<10||body.reason.length>500||
    Object.keys(body).some(k=>!['action','user_id','reason','mode'].includes(k)))
    return json({error:'Invalid administrative request'},400);
  const target=await call('/rest/v1/users?select=id,status&id=eq.'+encodeURIComponent(body.user_id));
  if(!target.ok||target.data?.length!==1||target.data[0].status!=='active')
    return json({error:'Target not active'},404);
  const identity=await call('/auth/v1/admin/users/'+encodeURIComponent(body.user_id));
  const account=identity.data?.user||identity.data;
  if(!identity.ok||account?.id!==body.user_id)return json({error:'Auth account unavailable'},502);
  if(body.mode==='email'&&!emailValid(account.email))return json({error:'Target email unavailable'},422);
  const audit=await call('/rest/v1/site_admin_audit','POST',{
    actor_user_id:actor,operation:body.mode==='email'?'user.password.recovery_email':'user.password.temporary_attempt',
    target_type:'user',target_id:body.user_id,
    details:{method:body.mode==='email'?'recovery_email':'temporary_password',reason:body.reason.trim()}
  });
  if(!audit.ok)return json({error:'Audit unavailable; no recovery performed'},502);
  if(body.mode==='email'){
    const sent=await call('/auth/v1/recover','POST',{email:account.email},PUBLIC_KEY,null);
    if(!sent.ok)return json({error:'Recovery email unavailable'},sent.status===429?429:502);
    return json({ok:true,message:'تم طلب إرسال رمز الاستعادة إلى البريد المسجل.'});
  }
  const password=temporaryPassword();
  const app={...(account.app_metadata||{}),itqan_force_password_change:true,
    itqan_temp_password_expires_at:new Date(Date.now()+24*60*60*1000).toISOString()};
  const updated=await call('/auth/v1/admin/users/'+encodeURIComponent(body.user_id),'PUT',
    {password,app_metadata:app});
  if(!updated.ok)return json({error:'Temporary password could not be assigned'},502);
  return json({ok:true,temporary_password:password});
}
Deno.serve(async req=>{
  try{return await handler(req)}
  catch{return json({error:'Recovery service unavailable'},503)}
});
