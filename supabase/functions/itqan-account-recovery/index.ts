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
const passwordValid = x => typeof x === 'string' && x.length >= 6 && x.length <= 1024;
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
    // GoTrue merges app_metadata, so omitting the old keys does not clear existing flags.
    // Persist explicit false/null values to unlock accounts after a verified password change.
    app.itqan_force_password_change = false;
    app.itqan_temp_password_expires_at = null;
    const changed=await call('/auth/v1/admin/users/'+encodeURIComponent(user.data.id),'PUT',
      {password:body.password,app_metadata:app});
    if(!changed.ok)return json({error:'Password rejected'},422);
    // Force a fresh login with the new password; recovery-session tokens never leave this service.
    return json({ok:true});
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
    // Update password and forced-change state together; never leave a half-unlocked account.
    const accountResponse=await call('/auth/v1/admin/users/'+encodeURIComponent(actor));
    const account=accountResponse.data?.user||accountResponse.data;
    if(!accountResponse.ok||account?.id!==actor)return json({error:'Account unavailable'},502);
    if(account.app_metadata?.itqan_force_password_change!==true)
      return json({error:'Temporary password already changed'},409);
    const app={...(account.app_metadata||{})};
    // GoTrue merges app_metadata, so omitting the old keys does not clear existing flags.
    // Persist explicit false/null values to unlock accounts after a verified password change.
    app.itqan_force_password_change = false;
    app.itqan_temp_password_expires_at = null;
    const changed=await call('/auth/v1/admin/users/'+encodeURIComponent(actor),'PUT',
      {password:body.password,app_metadata:app});
    if(!changed.ok)return json({error:'Password change rejected'},422);
    return json({ok:true});
  }
  if(body.action==='school_create_temporary_account'){
    // School principals may create a *new*, school-scoped login only after independent identity checks.
    if(!uuid(body.school_id)||!uuid(body.profile_id)||!emailValid(body.email)||
       typeof body.reason!=='string'||body.reason.trim().length<10||body.reason.length>500||
       Object.keys(body).some(k=>!['action','school_id','profile_id','email','reason'].includes(k)))
      return json({error:'Invalid school account request'},400);
    const school=body.school_id,mail=body.email.trim().toLowerCase();
    const [membership,schoolInfo,staff]=await Promise.all([
      call('/rest/v1/school_memberships?select=id&school_id=eq.'+encodeURIComponent(school)+
        '&user_id=eq.'+encodeURIComponent(actor)+'&access_role=eq.school_principal&status=eq.active&limit=1'),
      call('/rest/v1/schools?select=id&status=eq.active&id=eq.'+encodeURIComponent(school)+'&limit=1'),
      call('/rest/v1/school_personnel_profiles?select=id,full_name_snapshot&school_id=eq.'+
        encodeURIComponent(school)+'&id=eq.'+encodeURIComponent(body.profile_id)+
        '&status=eq.active&limit=1')
    ]);
    if(!membership.ok||membership.data?.length!==1||!schoolInfo.ok||
       schoolInfo.data?.length!==1||!staff.ok||staff.data?.length!==1)
      return json({error:'Forbidden'},403);
    // Exception-only: limit administrative issuance to 10 per school principal per hour.
    const since=new Date(Date.now()-60*60*1000).toISOString();
    const recent=await call('/rest/v1/school_temporary_account_events?select=id&actor_user_id=eq.'+
      encodeURIComponent(actor)+'&created_at=gte.'+encodeURIComponent(since)+'&limit=10');
    if(!recent.ok)return json({error:'Audit unavailable'},503);
    if(recent.data.length>=10)return json({error:'Too many temporary accounts'},429);
    const password=temporaryPassword();
    const expires_at=new Date(Date.now()+24*60*60*1000).toISOString();
    const created=await call('/auth/v1/admin/users','POST',{
      email:mail,password,email_confirm:true,
      user_metadata:{full_name:staff.data[0].full_name_snapshot},
      app_metadata:{
        itqan_force_password_change:true,
        itqan_temp_password_expires_at:expires_at,
        itqan_school_account:true
      }
    });
    const newUser=created.data?.user||created.data;
    if(!created.ok||!uuid(newUser?.id))
      return json({error:'تعذر إنشاء الحساب. تأكد أن البريد غير مستخدم سابقًا.'},
        [400,409,422,429].includes(created.status)?created.status:502);
    const provisioned=await call('/rest/v1/rpc/itqan_school_provision_temporary_account','POST',{
      p_school:school,p_profile:body.profile_id,p_actor:actor,p_user:newUser.id,
      p_email:mail,p_reason:body.reason.trim()
    });
    if(!provisioned.ok||provisioned.data!==true){
      // If the DB call had a deterministic rejection, remove the unused newly-created account.
      // For transport/5xx uncertainty, preserve it without releasing the password for reconciliation.
      if([400,403,409,422].includes(provisioned.status))
        await call('/auth/v1/admin/users/'+encodeURIComponent(newUser.id),'DELETE').catch(()=>null);
      return json({error:'تعذر ربط الحساب بالملف. لم تُسلّم بيانات الدخول.'},502);
    }
    // Never log or persist the temporary credential; return it exactly once over HTTPS.
    return json({ok:true,temporary_password:password,expires_at,email:mail});
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
