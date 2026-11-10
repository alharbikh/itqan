// Itqan Smart Pro — Cloudflare Worker / Supabase BFF.
// Authentication cookies are HttpOnly; browser scripts receive no access or refresh tokens.
const ACCESS_COOKIE = '__Host-itqan_at';
const REFRESH_COOKIE = '__Host-itqan_rt';
const API_PREFIX = '/api/';
const PROTECTED_ROUTES = /^\/(admin|frameworks|school|performance|link)(?:\.html|\/)?$/;
function protectedRoute(path) {
  const match=path.match(PROTECTED_ROUTES);
  return match?{section:match[1],asset:'/'+match[1]+'.html'}:null;
}
const SESSION_MAX_AGE = 60 * 60;
const DEFAULT_PASSWORD_MIN_LENGTH = 4; // App-level preference; Supabase Auth may enforce a higher minimum.
function passwordMinLength(env) {
  const chosen=Number(env.PASSWORD_MIN_LENGTH ?? DEFAULT_PASSWORD_MIN_LENGTH);
  return Number.isInteger(chosen)&&chosen>=4&&chosen<=32?chosen:DEFAULT_PASSWORD_MIN_LENGTH;
}
const REFRESH_MAX_AGE = 60 * 60 * 24 * 14;
const RESET_MIN_LENGTH = 8;
const emailValid = value => typeof value==='string' && value.length<=254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
const validPassword = value => typeof value==='string' && value.length>=RESET_MIN_LENGTH && value.length<=1024;
const uuidValid = value => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function temporaryPassword(){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);
  return [...bytes].map(n=>alphabet[n%alphabet.length]).join('');
}


function headers(contentType = 'application/json; charset=utf-8') {
  return new Headers({
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'",
  });
}
function json(value, status = 200, cookies = []) {
  if(value&&typeof value==='object'&&value.error==='Unauthorized')
    value={...value,error:'يلزم تسجيل الدخول للمتابعة.',code:value.code||'AUTH_REQUIRED'};
  else if(value&&typeof value==='object'&&value.error==='Forbidden')
    value={...value,error:'لا تملك صلاحية تنفيذ هذا الإجراء.',code:value.code||'ACCESS_FORBIDDEN'};
  const response = new Response(JSON.stringify(value), { status, headers: headers() });
  for (const cookie of cookies) response.headers.append('set-cookie', cookie);
  return response;
}
function cookie(name, value, maxAge) {
  return name + '=' + encodeURIComponent(value) +
    '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + maxAge;
}
function tokensCookies(tokens) {
  return [
    cookie(ACCESS_COOKIE, tokens.access_token, Math.min(Number(tokens.expires_in) || SESSION_MAX_AGE, SESSION_MAX_AGE)),
    cookie(REFRESH_COOKIE, tokens.refresh_token, REFRESH_MAX_AGE),
  ];
}
function clearedCookies() {
  return [cookie(ACCESS_COOKIE, '', 0), cookie(REFRESH_COOKIE, '', 0)];
}
function readCookies(request) {
  const result = {};
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) {
      try { result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1)); }
      catch { /* Reject malformed cookie values by ignoring them. */ }
    }
  }
  return result;
}
function environment(env) {
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) ||
      !key || /^(sb_secret_|.*service_role)/.test(key)) {
    throw new Error('Supabase environment not configured securely');
  }
  return { base, key };
}
async function backend(env, path, method = 'GET', body, token, extraHeaders = {}) {
  const { base, key } = environment(env);
  const response = await fetch(base + path, {
    method,
    headers: {
      apikey: key,
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data;
  try { data = await response.json(); } catch { data = null; }
  return { ok: response.ok, status: response.status, data };
}
async function verifiedUser(env, accessToken) {
  if (!accessToken) return null;
  const auth = await backend(env, '/auth/v1/user', 'GET', undefined, accessToken);
  if (!auth.ok || !auth.data?.id) return null;
  const id = encodeURIComponent(auth.data.id);
  const [profile, roles, memberships] = await Promise.all([
    backend(env, '/rest/v1/users?select=id,full_name,status&id=eq.' + id, 'GET', undefined, accessToken),
    backend(env, '/rest/v1/user_roles?select=role_code&user_id=eq.' + id, 'GET', undefined, accessToken),
    backend(env, '/rest/v1/school_memberships?select=school_id,access_role,job_role,status&user_id=eq.' + id,
      'GET', undefined, accessToken),
  ]);
  if (![profile, roles, memberships].every(x => x.ok)) return null;
  const user = Array.isArray(profile.data) ? profile.data[0] : null;
  if (!user || user.id !== auth.data.id || user.status !== 'active') return null;
  return {
    id: user.id,
    name: user.full_name || auth.data.email || 'مستخدم',
    role: Array.isArray(roles.data) && roles.data.some(x => x.role_code === 'site_admin') ? 'site_admin' : 'member',
    mustChangePassword: auth.data.app_metadata?.itqan_force_password_change === true,
    temporaryExpiresAt: auth.data.app_metadata?.itqan_temp_password_expires_at || null,
    schoolMemberships: (Array.isArray(memberships.data) ? memberships.data : [])
      .filter(x => x.status === 'active').map(x => ({ school_id: x.school_id, access_role: x.access_role, job_role: x.job_role })),
  };
}
async function session(request, env, allowPasswordChange = false) {
  const stored = readCookies(request);
  const access = stored[ACCESS_COOKIE];
  const user = await verifiedUser(env, access);
  if (user) return { user: user.mustChangePassword && !allowPasswordChange ? null : user, token: access, cookies: [] };
  const refresh = stored[REFRESH_COOKIE];
  if (!refresh) return { user: null, cookies: clearedCookies() };
  const updated = await backend(env, '/auth/v1/token?grant_type=refresh_token', 'POST',
    { refresh_token: refresh });
  if (!updated.ok || !updated.data?.access_token || !updated.data?.refresh_token)
    return { user: null, cookies: clearedCookies() };
  const refreshedUser = await verifiedUser(env, updated.data.access_token);
  if (!refreshedUser) return { user: null, cookies: clearedCookies() };
  return { user: refreshedUser.mustChangePassword && !allowPasswordChange ? null : refreshedUser, token: updated.data.access_token, cookies: tokensCookies(updated.data) };
}
function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return origin === new URL(request.url).origin;
}
async function input(request, maxLength = 8192) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return null;
  if (Number(request.headers.get('content-length') || 0) > maxLength) return null;
  try {
    const text = await request.text();
    return text.length <= maxLength ? JSON.parse(text) : null;
  } catch { return null; }
}

function validateSchool(body) {
  const invalid=(field,error,code='INVALID_SCHOOL_FIELD')=>({field,error,code});
  if(!body||typeof body!=='object'||Array.isArray(body))
    return invalid(null,'لم تُرسل بيانات المدرسة بصورة صحيحة.');
  const allowed=['name','education_stage','gender','education_department','ministry_number'];
  const unexpected=Object.keys(body).find(key=>!allowed.includes(key));
  if(unexpected)return invalid(null,'يحتوي الطلب على حقول غير مسموحة.');
  if(typeof body.name!=='string'||body.name.trim().length<2||body.name.trim().length>160)
    return invalid('name','اسم المدرسة مطلوب ويجب أن يتكون من حرفين إلى 160 حرفًا.');
  const school={name:body.name.trim()};
  for(const key of allowed.slice(1)){
    const val=body[key];
    if(val===undefined||val===null||val===''){school[key]=null;continue;}
    if(typeof val!=='string'||val.trim().length>160)
      return invalid(key,'أدخل قيمة نصية صحيحة لا تتجاوز 160 حرفًا.');
    school[key]=val.trim()||null;
  }
  if(school.gender!==null&&!['male','female','mixed'].includes(school.gender))
    return invalid('gender','اختر فئة المدرسة من القائمة.');
  if(school.ministry_number!==null&&!/^[0-9]{1,20}$/.test(school.ministry_number))
    return invalid('ministry_number','الرقم الوزاري يجب أن يحتوي على أرقام فقط (بحد أقصى 20 رقمًا)، أو يُترك فارغًا.');
  return {school};
}
function schoolFailure(result,operation,cookies){
  const code=result.data?.code;
  if(result.status===401||result.status===403||code==='42501')
    return json({error:'لا يملك هذا الحساب صلاحية '+(operation==='create'?'إضافة':'تعديل')+
      ' المدارس. سجّل الدخول بحساب مدير الموقع المخوّل.',code:'SCHOOL_FORBIDDEN'},403,cookies);
  if(code==='23505')
    return json({error:'الرقم الوزاري مسجل لمدرسة أخرى. غيّر الرقم أو اتركه فارغًا.',
      field:'ministry_number',code:'SCHOOL_DUPLICATE_MINISTRY'},409,cookies);
  if(code==='23514')
    return json({error:'توجد قيمة غير معتمدة في بيانات المدرسة. راجع الفئة والمرحلة التعليمية.',
      field:'gender',code:'SCHOOL_CONSTRAINT'},422,cookies);
  if(code==='23502')
    return json({error:'اسم المدرسة حقل إلزامي.',field:'name',code:'SCHOOL_REQUIRED_NAME'},422,cookies);
  if(code==='22001')
    return json({error:'أحد الحقول أطول من الحد المسموح.',code:'SCHOOL_FIELD_TOO_LONG'},422,cookies);
  return json({error:'تعذّر حفظ المدرسة بسبب مشكلة في الخدمة. حاول لاحقًا أو أرسل رقم الخطأ للدعم.',
    code:'SCHOOL_WRITE_FAILED',reference:typeof code==='string'&&/^[A-Z0-9]{4,8}$/.test(code)?code:null},502,cookies);
}

async function api(request, env, pathname) {
  if (['POST','PATCH','PUT','DELETE'].includes(request.method) && !sameOrigin(request)) return json({ error: 'Forbidden' }, 403);
  if(pathname==='/api/password/recovery/request' && request.method==='POST'){
    const body=await input(request);
    if(!body || !emailValid(body.email) || Object.keys(body).some(k=>k!=='email'))
      return json({error:'أدخل بريدًا إلكترونيًا صحيحًا.',code:'INVALID_EMAIL'},400);
    const result=await backend(env,'/auth/v1/recover','POST',{email:body.email.trim()});
    if(result.status===429)return json({error:'تكررت المحاولات. حاول بعد قليل.',code:'RATE_LIMITED'},429);
    // Deliberately identical response for unknown accounts and delivery failures.
    return json({message:'إذا كان البريد مسجلًا فستصلك تعليمات الاستعادة.'},202);
  }
  if(pathname==='/api/password/recovery/complete' && request.method==='POST'){
    const body=await input(request);
    if(!body||!emailValid(body.email)||typeof body.code!=='string'||!/^[0-9]{6,8}$/.test(body.code)||
       !validPassword(body.password)||Object.keys(body).some(k=>!['email','code','password'].includes(k)))
      return json({error:'تحقق من البريد والرمز، واستخدم كلمة مرور من 8 أحرف على الأقل.',code:'INVALID_RESET'},400);
    const completed=await backend(env,'/functions/v1/itqan-account-recovery','POST',
      {action:'complete_recovery',email:body.email.trim(),code:body.code,password:body.password});
    if(!completed.ok||!completed.data?.access_token||!completed.data?.refresh_token)
      return json({error:completed.status===400?'رمز الاستعادة غير صحيح أو انتهت صلاحيته.':
        'تعذر استكمال الاستعادة. تحقق من كلمة المرور أو حاول لاحقًا.',
        code:completed.status===400?'INVALID_RECOVERY_CODE':'RECOVERY_FAILED'},
        completed.status===400?400:502);
    const user=await verifiedUser(env,completed.data.access_token);
    if(!user)return json({error:'تعذر تفعيل جلسة الحساب.',code:'ACCOUNT_INACTIVE'},403);
    return json({ok:true,user},200,tokensCookies(completed.data));
  }
  if(pathname==='/api/password/change' && request.method==='POST'){
    const current=await session(request,env,true);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const body=await input(request);
    if(!body||!validPassword(body.password)||Object.keys(body).some(k=>!['password','current_password'].includes(k)))
      return json({error:'استخدم كلمة مرور جديدة لا تقل عن 8 أحرف.',code:'INVALID_PASSWORD'},400,current.cookies);
    if(typeof body.current_password!=='string'||!body.current_password)
      return json({error:'أدخل كلمة المرور الحالية أو المؤقتة.',code:'CURRENT_PASSWORD_REQUIRED'},400,current.cookies);
    if(body.password===body.current_password)
      return json({error:'يجب أن تختلف كلمة المرور الجديدة عن الحالية.',code:'PASSWORD_REUSED'},400,current.cookies);
    if(current.user.mustChangePassword){
      const result=await backend(env,'/functions/v1/itqan-account-recovery','POST',
        {action:'change_forced',password:body.password,current_password:body.current_password},current.token);
      if(!result.ok)
        return json({error:result.data?.code==='TEMP_PASSWORD_EXPIRED'
          ?'انتهت صلاحية كلمة المرور المؤقتة. اطلب إعادة ضبط جديدة.'
          :result.status===403?'كلمة المرور المؤقتة غير صحيحة أو الحساب غير مؤهل.'
          :'تعذر إكمال تغيير كلمة المرور المؤقتة.',code:result.data?.code||'FORCED_PASSWORD_CHANGE_FAILED'},
          [400,401,403,422].includes(result.status)?result.status:502,current.cookies);
      return json({ok:true},200,current.cookies);
    }
    const identity=await backend(env,'/auth/v1/user','GET',undefined,current.token);
    if(!identity.ok||!emailValid(identity.data?.email))
      return json({error:'تعذر التحقق من الحساب.'},403,current.cookies);
    const checked=await backend(env,'/auth/v1/token?grant_type=password','POST',
      {email:identity.data.email,password:body.current_password});
    if(!checked.ok)return json({error:'كلمة المرور الحالية غير صحيحة.',code:'CURRENT_PASSWORD_INVALID'},403,current.cookies);
    const result=await backend(env,'/auth/v1/user','PUT',{password:body.password},current.token);
    return result.ok?json({ok:true},200,current.cookies):
      json({error:'لم تقبل خدمة المصادقة كلمة المرور الجديدة.',code:'PASSWORD_REJECTED'},422,current.cookies);
  }
  if(pathname==='/api/admin/users/password' && request.method==='POST'){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    if(current.user.role!=='site_admin')return json({error:'Forbidden'},403,current.cookies);
    const body=await input(request);
    if(!body||!uuidValid(body.user_id)||body.user_id===current.user.id||
       typeof body.reason!=='string'||body.reason.trim().length<10||body.reason.length>500||
       (body.mode!==undefined&&!['temporary','email'].includes(body.mode))||
       Object.keys(body).some(k=>!['user_id','reason','mode'].includes(k)))
      return json({error:'اختر حسابًا آخر واكتب سببًا إداريًا لا يقل عن 10 أحرف.',code:'INVALID_ADMIN_RESET'},400,current.cookies);
    const result=await backend(env,'/functions/v1/itqan-account-recovery','POST',
      {action:'admin_recover',user_id:body.user_id,reason:body.reason.trim(),
       mode:body.mode||'temporary'},current.token);
    if(!result.ok)return json({error:result.status===403?'لا تملك صلاحية إعادة ضبط الدخول.':
      'تعذر تنفيذ استعادة الحساب. تحقق من إعدادات خدمة المصادقة.',code:result.data?.code||'ADMIN_RECOVERY_FAILED'},
      [400,401,403,404,422,429].includes(result.status)?result.status:502,current.cookies);
    return json({ok:true,...result.data},200,current.cookies);
  }
  if (pathname === '/api/login' && request.method === 'POST') {
    const body = await input(request);
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string' ||
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email) ||
        !body.password || body.password.length > 1024) return json({ error: 'Invalid credentials' }, 400);
    const result = await backend(env, '/auth/v1/token?grant_type=password', 'POST',
      { email: body.email.trim(), password: body.password });
    if (!result.ok || !result.data?.access_token || !result.data?.refresh_token)
      return json({ error: 'Invalid credentials' }, 401);
    const user = await verifiedUser(env, result.data.access_token);
    if (!user) return json({ error: 'Account not active' }, 403);
    if(user.mustChangePassword){
      const expiry=Date.parse(result.data?.user?.app_metadata?.itqan_temp_password_expires_at||'');
      if(Number.isFinite(expiry)&&Date.now()>expiry)
        return json({error:'انتهت صلاحية كلمة المرور المؤقتة. تواصل مع مدير الموقع.',code:'TEMP_PASSWORD_EXPIRED'},403);
    }
    return json({ user }, 200, tokensCookies(result.data));
  }
  if (pathname === '/api/register' && request.method === 'POST') {
    const body = await input(request);
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string' ||
        typeof body.name !== 'string' || body.name.trim().length < 2 ||
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email))
      return json({error:'تحقق من الاسم والبريد الإلكتروني.',code:'INVALID_REGISTRATION'},400);
    if(body.password.length<passwordMinLength(env)||body.password.length>1024)
      return json({error:'كلمة المرور يجب أن تتكون من '+passwordMinLength(env)+' أحرف على الأقل.',
        code:'PASSWORD_TOO_SHORT',field:'password',min_length:passwordMinLength(env)},400);
    const response = await backend(env, '/auth/v1/signup', 'POST', {
      email: body.email.trim(), password: body.password,
      data: { full_name: body.name.trim().slice(0, 200) },
    });
    if (!response.ok) {
      const text=(response.data?.msg||response.data?.message||'').toLowerCase();
      const weak=response.data?.error_code==='weak_password'||/password.*(least|length|short|weak)/.test(text);
      const duplicate=/already registered|already exists|user already/.test(text);
      return json({error:weak
        ?'لم تقبل خدمة Supabase Auth طول كلمة المرور. إعداداتها الحالية قد تتطلب 6 أحرف أو أكثر، حتى لو كان الحد في إتقان 4 أحرف. استخدم كلمة أطول لحين مواءمة إعدادات المصادقة.'
        :duplicate?'هذا البريد مسجل مسبقًا. استخدم صفحة تسجيل الدخول.'
        :'تعذر إنشاء الحساب. تحقق من البريد الإلكتروني أو حاول مرة أخرى.',
        code:weak?'AUTH_PASSWORD_POLICY':duplicate?'EMAIL_ALREADY_REGISTERED':'REGISTRATION_FAILED',
        ...(weak?{field:'password'}:{})},weak?422:400);
    }
    return json({ message: 'Check your email and await school access approval.' }, 202);
  }
  if (pathname === '/api/logout' && request.method === 'POST') {
    const cookies = readCookies(request);
    if (cookies[ACCESS_COOKIE]) {
      try { await backend(env, '/auth/v1/logout', 'POST', {}, cookies[ACCESS_COOKIE]); }
      catch { /* Local cookie invalidation must never be skipped. */ }
    }
    return json({ ok: true }, 200, clearedCookies());
  }


  if (pathname === '/api/admin/memberships' || pathname === '/api/admin/audit' ||
      pathname === '/api/admin/roles' || pathname === '/api/admin/site-admins' || pathname === '/api/admin/actions') {
    const current = await session(request, env);
    if (!current.user) return json({ error: 'Unauthorized' }, 401, current.cookies);
    if (current.user.role !== 'site_admin') return json({ error: 'Forbidden' }, 403, current.cookies);
    if (request.method === 'GET') {
      const paths = {
        '/api/admin/memberships': '/rest/v1/school_memberships?select=id,school_id,user_id,access_role,job_role,status,created_at&order=created_at.desc&limit=500',
        '/api/admin/audit': '/rest/v1/site_admin_audit?select=id,actor_user_id,operation,target_type,target_id,details,created_at&order=created_at.desc&limit=100',
        '/api/admin/roles': '/rest/v1/role_permissions?select=role_code,permission_code&order=role_code.asc',
        '/api/admin/site-admins': '/rest/v1/user_roles?select=user_id,role_code&role_code=eq.site_admin',
      };
      if (!paths[pathname]) return json({ error: 'Method not allowed' }, 405, current.cookies);
      const result = await backend(env, paths[pathname], 'GET', undefined, current.token);
      if (!result.ok) return json({ error: 'Unable to read administration data' }, 502, current.cookies);
      const key = { '/api/admin/memberships': 'memberships',
        '/api/admin/audit': 'audit', '/api/admin/roles': 'permissions',
        '/api/admin/site-admins': 'site_admins' }[pathname];
      return json({ [key]: result.data }, 200, current.cookies);
    }
    if (pathname !== '/api/admin/actions' || request.method !== 'POST')
      return json({ error: 'Method not allowed' }, 405, current.cookies);
    const body = await input(request);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return json({ error: 'Invalid action' }, 400, current.cookies);
    const uuid = value => typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    let rpc, params, keys;
    switch (body.action) {
      case 'school.delete':
        rpc = 'itqan_admin_delete_empty_school';
        params = { p_school: body.school_id };
        keys = ['action','school_id'];
        if (!uuid(body.school_id)) return json({ error: 'Invalid school' }, 400, current.cookies);
        break;
      case 'school.status':
        rpc = 'itqan_admin_set_school_status';
        params = { p_school: body.school_id, p_status: body.status };
        keys = ['action','school_id','status'];
        if (!uuid(body.school_id) || !['active','inactive'].includes(body.status))
          return json({ error: 'Invalid school status' }, 400, current.cookies);
        break;
      case 'user.status':
        rpc = 'itqan_admin_set_user_status';
        params = { p_user: body.user_id, p_status: body.status };
        keys = ['action','user_id','status'];
        if (!uuid(body.user_id) || !['active','disabled'].includes(body.status))
          return json({ error: 'Invalid user status' }, 400, current.cookies);
        break;
      case 'user.role':
        rpc = 'itqan_admin_manage_site_role';
        params = { p_user: body.user_id, p_enabled: body.enabled };
        keys = ['action','user_id','enabled'];
        if (!uuid(body.user_id) || typeof body.enabled !== 'boolean')
          return json({ error: 'Invalid role request' }, 400, current.cookies);
        break;
      case 'membership.upsert':
        rpc = 'itqan_admin_manage_membership';
        params = { p_school: body.school_id, p_user: body.user_id,
          p_access_role: body.access_role, p_job_role: body.job_role, p_status: body.status };
        keys = ['action','school_id','user_id','access_role','job_role','status'];
        if (!uuid(body.school_id) || !uuid(body.user_id) ||
            !['school_principal','employee'].includes(body.access_role) ||
            !['principal','teacher','vice_principal','counselor','staff'].includes(body.job_role) ||
            !['active','inactive'].includes(body.status) ||
            (body.access_role === 'school_principal' && body.job_role !== 'principal'))
          return json({ error: 'Invalid membership' }, 400, current.cookies);
        break;
      default: return json({ error: 'Unknown action' }, 400, current.cookies);
    }
    if (Object.keys(body).some(key => !keys.includes(key)))
      return json({ error: 'Unexpected action fields' }, 400, current.cookies);
    const result = await backend(env, '/rest/v1/rpc/' + rpc, 'POST', params, current.token);
    if (!result.ok) {
      const pgCode = result.data?.code;
      if (body.action === 'school.delete' && pgCode === '23503')
        return json({ error: 'المدرسة مرتبطة بسجلات أو عضويات؛ عطّل المدرسة بدلًا من حذفها.' }, 409, current.cookies);
      return json({ error: pgCode === '42501' ? 'Forbidden' : 'Unable to perform administrative action' },
        pgCode === '42501' ? 403 : 422, current.cookies);
    }
    return json({ ok: true, result: result.data }, 200, current.cookies);
  }
  if (pathname === '/api/admin/schools' || pathname === '/api/admin/users' ||
      /^\/api\/admin\/schools\/[0-9a-f-]{36}$/.test(pathname)) {
    const current = await session(request, env);
    if (!current.user) return json({ error: 'Unauthorized' }, 401, current.cookies);
    if (current.user.role !== 'site_admin') return json({ error: 'Forbidden' }, 403, current.cookies);

    if (pathname === '/api/admin/users' && request.method === 'GET') {
      const result = await backend(env,
        '/rest/v1/users?select=id,full_name,status,created_at&order=created_at.desc&limit=200',
        'GET', undefined, current.token);
      return result.ok ? json({ users: result.data }, 200, current.cookies)
        : json({ error: 'Could not read users' }, 502, current.cookies);
    }

    if (pathname === '/api/admin/schools' && request.method === 'GET') {
      const result = await backend(env,
        '/rest/v1/schools?select=id,name,education_stage,gender,education_department,ministry_number,status,created_at&order=created_at.desc',
        'GET', undefined, current.token);
      return result.ok ? json({ schools: result.data }, 200, current.cookies)
        : json({ error: 'Could not read schools' }, 502, current.cookies);
    }

    if (pathname === '/api/admin/schools' && request.method === 'POST') {
      const body = await input(request);
      const checked=validateSchool(body);
      if (!checked.school) return json({error:checked.error,field:checked.field,code:checked.code},
        400,current.cookies);
      const school=checked.school;
      const result = await backend(env, '/rest/v1/schools?select=id,name,education_stage,gender,education_department,ministry_number,status,created_at',
        'POST', school, current.token, { Prefer: 'return=representation' });
      if (!result.ok) return schoolFailure(result,'create',current.cookies);
      return json({ school: result.data?.[0] }, 201, current.cookies);
    }

    if (request.method === 'PATCH' && pathname.startsWith('/api/admin/schools/')) {
      const schoolId = pathname.split('/').pop();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(schoolId))
        return json({ error: 'Invalid school' }, 400, current.cookies);
      const body = await input(request);
      const checked=validateSchool(body);
      if (!checked.school) return json({error:checked.error,field:checked.field,code:checked.code},
        400,current.cookies);
      const school=checked.school;
      const result = await backend(env,
        '/rest/v1/schools?id=eq.' + schoolId + '&select=id,name,education_stage,gender,education_department,ministry_number,status,created_at',
        'PATCH', school, current.token, { Prefer: 'return=representation' });
      if (!result.ok) return schoolFailure(result,'update',current.cookies);
      if (!Array.isArray(result.data) || !result.data.length)
        return json({ error: 'School not found' }, 404, current.cookies);
      return json({ school: result.data[0] }, 200, current.cookies);
    }
    return json({ error: 'Method not allowed' }, 405, current.cookies);
  }
  if(pathname==='/api/framework-details' && request.method==='GET'){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const id=new URL(request.url).searchParams.get('framework_id');
    if(!id||!/^[0-9a-f-]{36}$/i.test(id))return json({error:'Invalid framework'},400,current.cookies);
    const q=encodeURIComponent(id);
    const [rows,texts,rubrics]=await Promise.all([
      backend(env,'/rest/v1/evaluation_framework_criteria?select=framework_id,job_title_id,criterion_id,weight&framework_id=eq.'+q,'GET',undefined,current.token),
      backend(env,'/rest/v1/evaluation_criterion_interpretations?select=framework_id,job_title_id,criterion_id,title_ar,interpretation,source_page&framework_id=eq.'+q,'GET',undefined,current.token),
      backend(env,'/rest/v1/criterion_rating_descriptors?select=framework_id,job_title_id,criterion_id,score_level,descriptor&framework_id=eq.'+q,'GET',undefined,current.token)
    ]);
    if(!rows.ok||!texts.ok||!rubrics.ok)return json({error:'Unable to load framework details'},502,current.cookies);
    const key=r=>r.job_title_id+':'+r.criterion_id;
    const labels=new Map((texts.data||[]).map(x=>[key(x),x]));
    const criteria=(rows.data||[]).map(x=>({...x,...(labels.get(key(x))||{}),
      descriptors:(rubrics.data||[]).filter(d=>key(d)===key(x))}));
    return json({criteria},200,current.cookies);
  }
  if(pathname==='/api/catalog' && request.method==='GET'){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const endpoints={
      years:'/rest/v1/academic_years?select=id,label,starts_on,ends_on,is_current&order=starts_on.desc&limit=100',
      jobs:'/rest/v1/job_titles?select=id,code,title_ar&active=eq.true&order=title_ar.asc&limit=200',
      frameworks:'/rest/v1/evaluation_frameworks?select=id,code,title_ar,version_no,source_reference&status=eq.active&limit=100',
      criteria:'/rest/v1/evaluation_criteria?select=id,code,title_ar&active=eq.true&limit=500',
      stages:'/rest/v1/performance_stage_defaults?select=academic_year_id,stage,starts_on,ends_on,earliest_start,latest_end&limit=200',
    };
    const results=await Promise.all(Object.values(endpoints).map(p=>backend(env,p,'GET',undefined,current.token)));
    if(results.some(x=>!x.ok))return json({error:'Unable to load catalogs'},502,current.cookies);
    return json(Object.fromEntries(Object.keys(endpoints).map((key,i)=>[key,results[i].data])),200,current.cookies);
  }
  if(pathname==='/api/admin/academic-years' && request.method==='POST'){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    if(current.user.role!=='site_admin')return json({error:'Forbidden'},403,current.cookies);
    const b=await input(request);
    if(!b||typeof b.label!=='string'||b.label.length>100||
       !['starts_on','ends_on'].every(k=>typeof b[k]==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(b[k]))||
       (b.is_current!=null&&typeof b.is_current!=='boolean'))
       return json({error:'Invalid academic year'},400,current.cookies);
    const r=await backend(env,'/rest/v1/rpc/itqan_admin_create_academic_year','POST',
      {p_label:b.label,p_start:b.starts_on,p_end:b.ends_on,p_current:b.is_current===true},current.token);
    return r.ok?json({ok:true,year_id:r.data},201,current.cookies):
       json({error:'Unable to create academic year'},422,current.cookies);
  }
  if(pathname==='/api/school/personnel' && request.method==='GET'){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const schoolId=new URL(request.url).searchParams.get('school_id');
    if(!schoolId||!current.user.schoolMemberships.some(m=>m.school_id===schoolId&&m.access_role==='school_principal'))
      return json({error:'Forbidden'},403,current.cookies);
    const r=await backend(env,'/rest/v1/rpc/itqan_school_list_personnel','POST',
      {p_school:schoolId},current.token);
    return r.ok?json({personnel:r.data},200,current.cookies):
      json({error:'Unable to read personnel'},502,current.cookies);
  }
  if(pathname==='/api/school/stage-overrides' && request.method==='GET'){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const schoolId=new URL(request.url).searchParams.get('school_id');
    if(!schoolId||!current.user.schoolMemberships.some(m=>m.school_id===schoolId))
      return json({error:'Forbidden'},403,current.cookies);
    const r=await backend(env,'/rest/v1/school_stage_overrides?select=academic_year_id,stage,starts_on,ends_on,reason,changed_at&school_id=eq.'+
      encodeURIComponent(schoolId)+'&limit=100','GET',undefined,current.token);
    return r.ok?json({overrides:r.data},200,current.cookies):
      json({error:'Unable to read school stage overrides'},502,current.cookies);
  }
  // #13: stage / review official frameworks as JSON; only site administrators.
  if (pathname==='/api/admin/framework-batches' ||
      pathname==='/api/admin/framework-actions') {
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    if(current.user.role!=='site_admin')return json({error:'Forbidden'},403,current.cookies);
    if(pathname==='/api/admin/framework-batches' && request.method==='GET'){
      const data=await backend(env,
        '/rest/v1/framework_import_batches?select=id,payload,framework_id,status,created_at,reviewed_at,review_note&order=created_at.desc&limit=100',
        'GET',undefined,current.token);
      return data.ok?json({batches:data.data},200,current.cookies):json({error:'Unable to read imports'},502,current.cookies);
    }
    if(request.method!=='POST')return json({error:'Method not allowed'},405,current.cookies);
    const body=await input(request,320000);
    if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Invalid JSON'},400,current.cookies);
    let rpc,params;
    if(pathname==='/api/admin/framework-batches'){
      if(!body.payload||Object.keys(body).some(k=>k!=='payload'))
        return json({error:'Invalid framework batch'},400,current.cookies);
      rpc='itqan_admin_stage_framework';params={p_payload:body.payload};
    }else{
      if(typeof body.batch_id!=='string'||!/^[0-9a-f-]{36}$/i.test(body.batch_id))
        return json({error:'Invalid batch id'},400,current.cookies);
      switch(body.action){
        case 'replace':
          if(!body.payload||Object.keys(body).some(k=>!['action','batch_id','payload'].includes(k)))
            return json({error:'Invalid replacement'},400,current.cookies);
          rpc='itqan_admin_replace_framework_draft';
          params={p_batch:body.batch_id,p_payload:body.payload};break;
        case 'approve':
          if(body.note!=null&&(typeof body.note!=='string'||body.note.length>2000))
            return json({error:'Invalid review'},400,current.cookies);
          rpc='itqan_admin_approve_framework';
          params={p_batch:body.batch_id,p_note:body.note||null};break;
        case 'publish':
          rpc='itqan_admin_publish_framework';params={p_batch:body.batch_id};break;
        default:return json({error:'Unknown framework action'},400,current.cookies);
      }
    }
    const result=await backend(env,'/rest/v1/rpc/'+rpc,'POST',params,current.token);
    if(!result.ok)return json({error:result.data?.code==='42501'?'Forbidden':'Framework validation failed'},
      result.data?.code==='42501'?403:422,current.cookies);
    return json({ok:true,result:result.data},200,current.cookies);
  }
  // #14: stage window customization and employee framework acknowledgement.
  if (['/api/admin/stage-window','/api/school/stage-window','/api/school/framework-ack'].includes(pathname)
       && request.method==='POST') {
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const body=await input(request);
    if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Invalid request'},400,current.cookies);
    const uuid=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x);
    const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x);
    const stage=x=>['planning','midyear','final'].includes(x);
    let rpc,params;
    if(pathname==='/api/admin/stage-window'){
      if(current.user.role!=='site_admin')return json({error:'Forbidden'},403,current.cookies);
      if(!uuid(body.year_id)||!stage(body.stage)||!['starts_on','ends_on','earliest_start','latest_end'].every(k=>validDate(body[k])))
        return json({error:'Invalid central stage'},400,current.cookies);
      rpc='itqan_admin_set_stage_default';params={p_year:body.year_id,p_stage:body.stage,p_start:body.starts_on,
        p_end:body.ends_on,p_earliest:body.earliest_start,p_latest:body.latest_end};
    }else if(pathname==='/api/school/stage-window'){
      if(!uuid(body.school_id)||!uuid(body.year_id)||!stage(body.stage)||
         !validDate(body.starts_on)||!validDate(body.ends_on)||
         typeof body.reason!=='string'||body.reason.length>500||
         !current.user.schoolMemberships.some(m=>m.school_id===body.school_id&&m.access_role==='school_principal'))
        return json({error:'Invalid school stage or permission'},403,current.cookies);
      rpc='itqan_school_set_stage_dates';params={p_school:body.school_id,p_year:body.year_id,
        p_stage:body.stage,p_start:body.starts_on,p_end:body.ends_on,p_reason:body.reason};
    }else{
      if(!uuid(body.school_id)||!uuid(body.framework_id))return json({error:'Invalid acknowledgement'},400,current.cookies);
      rpc='itqan_employee_acknowledge_framework';params={p_school:body.school_id,p_framework:body.framework_id};
    }
    const result=await backend(env,'/rest/v1/rpc/'+rpc,'POST',params,current.token);
    if(!result.ok)return json({error:result.data?.code==='42501'?'Forbidden':'Unable to update performance schedule'},result.data?.code==='42501'?403:422,current.cookies);
    return json({ok:true,result:result.data},200,current.cookies);
  }
  // #15: personal evidence can exist without criterion links or a school membership.
  if(pathname==='/api/evidence/personal'||pathname==='/api/evidence/criterion-link'){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const uuid=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x);
    if(pathname==='/api/evidence/personal'&&request.method==='GET'){
      const r=await backend(env,'/rest/v1/personal_evidence?select=id,title,description,link_url,status,created_at&user_id=eq.'+
        encodeURIComponent(current.user.id)+'&order=created_at.desc&limit=200','GET',undefined,current.token);
      return r.ok?json({evidence:r.data},200,current.cookies):json({error:'Unable to read evidence'},502,current.cookies);
    }
    const body=await input(request);
    if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Invalid evidence request'},400,current.cookies);
    let url,method,params,extra={};
    if(pathname==='/api/evidence/personal'&&request.method==='POST'){
      if(typeof body.title!=='string'||body.title.trim().length<2||body.title.length>250||
         (body.description!=null&&(typeof body.description!=='string'||body.description.length>4000))||
         (body.link_url!=null&&(typeof body.link_url!=='string'||body.link_url.length>2000||
          (body.link_url!==''&&!/^https:\/\//.test(body.link_url)))))
        return json({error:'Invalid evidence data'},400,current.cookies);
      url='/rest/v1/personal_evidence?select=id,title,status,created_at';method='POST';
      params={user_id:current.user.id,title:body.title.trim(),description:body.description||null,
        link_url:body.link_url||null};
      extra={Prefer:'return=representation'};
    }else if(pathname==='/api/evidence/criterion-link'&&['POST','DELETE'].includes(request.method)){
      if(!uuid(body.evidence_id)||!uuid(body.criterion_id))return json({error:'Invalid evidence link'},400,current.cookies);
      method=request.method;
      if(method==='POST'){
        url='/rest/v1/personal_evidence_criteria';params={evidence_id:body.evidence_id,criterion_id:body.criterion_id};
      }else{
        url='/rest/v1/personal_evidence_criteria?evidence_id=eq.'+encodeURIComponent(body.evidence_id)+
          '&criterion_id=eq.'+encodeURIComponent(body.criterion_id);
      }
    }else{return json({error:'Method not allowed'},405,current.cookies);}
    const r=await backend(env,url,method,params,current.token,extra);
    if(!r.ok)return json({error:r.status===403?'Forbidden':'Unable to save evidence'},r.status===403?403:422,current.cookies);
    return json({ok:true,result:r.data},method==='POST'?201:200,current.cookies);
  }
  // #15: delegates are scoped to one subject, operation and expiry.
  if(pathname==='/api/school/review-delegations'&&request.method==='POST'){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const b=await input(request),uuid=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x);
    if(!b||!uuid(b.school_id)||!current.user.schoolMemberships.some(m=>
        m.school_id===b.school_id&&m.access_role==='school_principal'))
      return json({error:'Forbidden'},403,current.cookies);
    let rpc,params;
    if(b.action==='grant'){
      if(!uuid(b.delegate_user_id)||!uuid(b.subject_user_id)||
         !['evidence_review','performance_scoring'].includes(b.scope)||
         typeof b.expires_at!=='string')return json({error:'Invalid delegation'},400,current.cookies);
      rpc='itqan_school_grant_review_delegation';
      params={p_school:b.school_id,p_delegate:b.delegate_user_id,p_subject:b.subject_user_id,
        p_scope:b.scope,p_expiry:b.expires_at};
    }else if(b.action==='revoke'){
      if(!uuid(b.delegation_id))return json({error:'Invalid delegation id'},400,current.cookies);
      rpc='itqan_school_revoke_review_delegation';params={p_delegation:b.delegation_id};
    }else return json({error:'Unknown delegation action'},400,current.cookies);
    const r=await backend(env,'/rest/v1/rpc/'+rpc,'POST',params,current.token);
    return r.ok?json({ok:true,result:r.data},200,current.cookies):
      json({error:r.data?.code==='42501'?'Forbidden':'Unable to update delegation'},
        r.data?.code==='42501'?403:422,current.cookies);
  }
  // #16: midpoint feedback is descriptive and never writes final evaluation scores.
  if(pathname==='/api/school/midyear-feedback'||pathname==='/api/school/midyear-ack'){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const uuid=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x);
    if(pathname==='/api/school/midyear-feedback'&&request.method==='GET'){
      const schoolId=new URL(request.url).searchParams.get('school_id');
      if(!uuid(schoolId))return json({error:'Invalid school'},400,current.cookies);
      const p='/rest/v1/midyear_feedback?select=id,school_id,academic_year_id,subject_user_id,reviewer_user_id,strengths,improvements,development_actions,employee_comment,status,published_at,acknowledged_at&school_id=eq.'+
        encodeURIComponent(schoolId)+'&order=created_at.desc&limit=200';
      const r=await backend(env,p,'GET',undefined,current.token);
      return r.ok?json({feedback:r.data},200,current.cookies):json({error:'Unable to read feedback'},502,current.cookies);
    }
    if(pathname==='/api/school/midyear-feedback'&&request.method==='PATCH'){
      const b=await input(request);
      if(!b||!uuid(b.school_id)||!uuid(b.feedback_id)||b.action!=='publish'||
        !current.user.schoolMemberships.some(m=>m.school_id===b.school_id&&m.access_role==='school_principal'))
        return json({error:'Forbidden'},403,current.cookies);
      const path='/rest/v1/midyear_feedback?id=eq.'+encodeURIComponent(b.feedback_id)+
        '&school_id=eq.'+encodeURIComponent(b.school_id)+
        '&reviewer_user_id=eq.'+encodeURIComponent(current.user.id)+'&select=id,status';
      const r=await backend(env,path,'PATCH',{status:'published',published_at:new Date().toISOString()},
        current.token,{Prefer:'return=representation'});
      if(!r.ok)return json({error:'Unable to publish feedback'},422,current.cookies);
      if(!Array.isArray(r.data)||!r.data.length)return json({error:'Draft not found'},404,current.cookies);
      return json({ok:true},200,current.cookies);
    }
    if(request.method!=='POST')return json({error:'Method not allowed'},405,current.cookies);
    const b=await input(request);
    if(!b)return json({error:'Invalid review'},400,current.cookies);
    if(pathname==='/api/school/midyear-ack'){
      if(!uuid(b.feedback_id)||(b.comment!=null&&(typeof b.comment!=='string'||b.comment.length>2000)))
        return json({error:'Invalid acknowledgement'},400,current.cookies);
      const r=await backend(env,'/rest/v1/rpc/itqan_employee_ack_midyear','POST',
        {p_feedback:b.feedback_id,p_comment:b.comment||null},current.token);
      return r.ok?json({ok:true},200,current.cookies):json({error:'Unable to acknowledge'},422,current.cookies);
    }
    if(!uuid(b.school_id)||!uuid(b.year_id)||!uuid(b.subject_user_id)||
       !current.user.schoolMemberships.some(m=>m.school_id===b.school_id&&m.access_role==='school_principal')||
       b.subject_user_id===current.user.id||
       ['strengths','improvements','development_actions'].some(k=>typeof b[k]!=='string'||b[k].length>5000))
      return json({error:'Invalid review or permission'},403,current.cookies);
    const r=await backend(env,'/rest/v1/midyear_feedback?select=id,status,created_at','POST',
      {school_id:b.school_id,academic_year_id:b.year_id,subject_user_id:b.subject_user_id,
       reviewer_user_id:current.user.id,strengths:b.strengths,improvements:b.improvements,
       development_actions:b.development_actions},current.token,{Prefer:'return=representation'});
    return r.ok?json({ok:true,feedback:r.data?.[0]},201,current.cookies):
       json({error:'Unable to save midpoint feedback'},422,current.cookies);
  }
  // #17 Private evidence attachments: file bytes pass through the BFF, never through browser-held JWTs.
  if(pathname==='/api/evidence/attachments' ||
     /^\/api\/evidence\/attachments\/[0-9a-f-]{36}(?:\/download)?$/i.test(pathname)){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
    const bucket='itqan-personal-evidence';
    const {base,key}=environment(env);
    const authHeaders={apikey:key,authorization:'Bearer '+current.token};
    const userId=current.user.id;
    const url=new URL(request.url);
    const schoolId=url.searchParams.get('school_id');
    const isPrincipal=schoolId&&current.user.schoolMemberships.some(
      m=>m.school_id===schoolId&&m.access_role==='school_principal');
    const match=pathname.match(/^\/api\/evidence\/attachments\/([0-9a-f-]{36})(?:\/(download))?$/i);
    if(schoolId&&!isPrincipal)return json({error:'Forbidden'},403,current.cookies);
    const rowFor=async id=>{
      const r=await backend(env,'/rest/v1/personal_evidence_attachments?select=id,evidence_id,user_id,object_name,original_filename,mime_type,byte_size&deleted_at=is.null&id=eq.'+
        encodeURIComponent(id)+'&limit=1','GET',undefined,current.token);
      return r.ok?(r.data?.[0]||null):null;
    };
    if(!match&&request.method==='GET'){
      const evidenceId=url.searchParams.get('evidence_id');
      if(!uuid(evidenceId))return json({error:'Invalid evidence id'},400,current.cookies);
      const result=await backend(env,'/rest/v1/personal_evidence_attachments?select=id,evidence_id,user_id,original_filename,mime_type,byte_size,created_at&deleted_at=is.null&evidence_id=eq.'+
        encodeURIComponent(evidenceId)+'&order=created_at.desc&limit=50','GET',undefined,current.token);
      return result.ok?json({attachments:result.data},200,current.cookies):
        json({error:'Unable to read attachments'},502,current.cookies);
    }
    if(match&&match[2]==='download'&&request.method==='GET'){
      const record=await rowFor(match[1]);
      if(!record)return json({error:'Attachment not found'},404,current.cookies);
      if(record.user_id!==userId&&!isPrincipal)return json({error:'Forbidden'},403,current.cookies);
      const segments=record.object_name.split('/').map(encodeURIComponent).join('/');
      const upstream=await fetch(base+'/storage/v1/object/authenticated/'+bucket+'/'+segments,{
        method:'GET',headers:authHeaders
      });
      if(!upstream.ok)return json({error:'Attachment not available'},upstream.status===404?404:502,current.cookies);
      const responseHeaders=headers(record.mime_type);
      responseHeaders.set('content-disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(record.original_filename));
      responseHeaders.set('content-length',String(record.byte_size));
      const answer=new Response(upstream.body,{status:200,headers:responseHeaders});
      for(const cookie of current.cookies)answer.headers.append('set-cookie',cookie);
      return answer;
    }
    if(match&&!match[2]&&request.method==='DELETE'){
      const record=await rowFor(match[1]);
      if(!record)return json({error:'Attachment not found'},404,current.cookies);
      if(record.user_id!==userId)return json({error:'Forbidden'},403,current.cookies);
      const removed=await fetch(base+'/storage/v1/object/'+bucket,{
        method:'DELETE',headers:{...authHeaders,'content-type':'application/json'},
        body:JSON.stringify({prefixes:[record.object_name]})
      });
      if(!removed.ok)return json({error:'Unable to remove stored file'},502,current.cookies);
      const result=await backend(env,'/rest/v1/personal_evidence_attachments?id=eq.'+
        encodeURIComponent(record.id),'DELETE',undefined,current.token);
      return result.ok?json({ok:true},200,current.cookies):
        json({error:'File removed but metadata cleanup failed'},502,current.cookies);
    }
    if(!match&&request.method==='POST'){
      const max=5*1024*1024;
      const length=Number(request.headers.get('content-length')||0);
      if(length>max+100000)return json({error:'File exceeds the 5 MB limit'},413,current.cookies);
      if(!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data'))
        return json({error:'Expected a file upload'},415,current.cookies);
      let form;
      try{form=await request.formData();}catch{return json({error:'Invalid file upload'},400,current.cookies);}
      const evidenceId=form.get('evidence_id'),file=form.get('file');
      if(!uuid(evidenceId)||!(file instanceof File)||file.size===0||file.size>max)
        return json({error:'Invalid evidence or file size'},file instanceof File&&file.size>max?413:400,current.cookies);
      const original=String(file.name||'').replace(/[\\/\u0000-\u001f\u007f]/g,'').trim();
      if(!original||original.length>200)return json({error:'Invalid filename'},400,current.cookies);
      const extension=original.split('.').pop()?.toLowerCase();
      const types={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',
        webp:'image/webp',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
      const mime=types[extension];
      if(!mime||!['',mime,'application/octet-stream'].includes(file.type))
        return json({error:'Unsupported file format'},415,current.cookies);
      const head=new Uint8Array(await file.slice(0,16).arrayBuffer());
      const ascii=(start,end)=>String.fromCharCode(...head.slice(start,end));
      const valid=extension==='pdf'?ascii(0,5)==='%PDF-':
        extension==='png'?head[0]===137&&ascii(1,4)==='PNG':
        ['jpg','jpeg'].includes(extension)?head[0]===255&&head[1]===216&&head[2]===255:
        extension==='webp'?ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP':
        head[0]===80&&head[1]===75&&head[2]===3&&head[3]===4;
      if(!valid)return json({error:'File content does not match its type'},415,current.cookies);
      const own=await backend(env,'/rest/v1/personal_evidence?select=id&id=eq.'+
        encodeURIComponent(evidenceId)+'&user_id=eq.'+encodeURIComponent(userId)+'&limit=1',
        'GET',undefined,current.token);
      if(!own.ok||!own.data?.length)return json({error:'Evidence is not owned by your account'},403,current.cookies);
      const existing=await backend(env,'/rest/v1/personal_evidence_attachments?select=id&evidence_id=eq.'+
        encodeURIComponent(evidenceId)+'&deleted_at=is.null&limit=50','GET',undefined,current.token);
      if(!existing.ok)return json({error:'Unable to check evidence quota'},502,current.cookies);
      if(existing.data.length>=50)return json({error:'Maximum 50 attachments per evidence'},409,current.cookies);
      const id=crypto.randomUUID();
      const objectName=userId+'/'+evidenceId+'/'+id+'.'+(extension==='jpeg'?'jpg':extension);
      const objectUrl=base+'/storage/v1/object/'+bucket+'/'+objectName.split('/').map(encodeURIComponent).join('/');
      const uploaded=await fetch(objectUrl,{method:'POST',
        headers:{...authHeaders,'content-type':mime,'x-upsert':'false'},body:file});
      if(!uploaded.ok)return json({error:'Storage upload denied or unavailable'},uploaded.status===403?403:502,current.cookies);
      const saved=await backend(env,'/rest/v1/personal_evidence_attachments?select=id,evidence_id,original_filename,mime_type,byte_size,created_at',
        'POST',{id,evidence_id:evidenceId,user_id:userId,object_name:objectName,original_filename:original,
          mime_type:mime,byte_size:file.size},current.token,{Prefer:'return=representation'});
      if(!saved.ok||!saved.data?.length){
        try{await fetch(base+'/storage/v1/object/'+bucket,{method:'DELETE',
          headers:{...authHeaders,'content-type':'application/json'},body:JSON.stringify({prefixes:[objectName]})});}
        catch{/* orphan cleanup may require storage maintenance */}
        return json({error:'Unable to record attachment'},502,current.cookies);
      }
      return json({attachment:saved.data[0]},201,current.cookies);
    }
    return json({error:'Method not allowed'},405,current.cookies);
  }
  // #15: personal evidence is shared only after an explicit employee action.
  if(pathname==='/api/evidence/share'&&['POST','DELETE'].includes(request.method)){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const b=await input(request),uuid=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x);
    if(!b||!uuid(b.evidence_id)||!uuid(b.school_id))return json({error:'Invalid evidence share'},400,current.cookies);
    const isPost=request.method==='POST';
    const url='/rest/v1/personal_evidence_shares'+(isPost?'':('?evidence_id=eq.'+
      encodeURIComponent(b.evidence_id)+'&school_id=eq.'+encodeURIComponent(b.school_id)));
    const r=await backend(env,url,request.method,isPost?{
      evidence_id:b.evidence_id,school_id:b.school_id,user_id:current.user.id
    }:undefined,current.token);
    return r.ok?json({ok:true},200,current.cookies):json({error:'Unable to change evidence sharing'},422,current.cookies);
  }
  if(pathname==='/api/school/shared-evidence'&&request.method==='GET'){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const schoolId=new URL(request.url).searchParams.get('school_id');
    if(!schoolId||!current.user.schoolMemberships.some(m=>m.school_id===schoolId&&m.access_role==='school_principal'))
      return json({error:'Forbidden'},403,current.cookies);
    const shares=await backend(env,'/rest/v1/personal_evidence_shares?select=evidence_id,user_id,shared_at&school_id=eq.'+
      encodeURIComponent(schoolId)+'&revoked_at=is.null&limit=200','GET',undefined,current.token);
    if(!shares.ok)return json({error:'Unable to read shared items'},502,current.cookies);
    const rows=shares.data||[];
    if(!rows.length)return json({shares:[],evidence:[]},200,current.cookies);
    const ids=rows.map(x=>encodeURIComponent(x.evidence_id));
    const evidence=await backend(env,'/rest/v1/personal_evidence?select=id,title,description,link_url,user_id&' +
       'id=in.('+ids.join(',')+')','GET',undefined,current.token);
    return evidence.ok?json({shares:rows,evidence:evidence.data},200,current.cookies):
      json({error:'Unable to read shared evidence'},502,current.cookies);
  }
  if(pathname==='/api/school/evidence-review'&&request.method==='POST'){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const b=await input(request);
    if(!b||typeof b.evidence_id!=='string'||!/^[0-9a-f-]{36}$/i.test(b.evidence_id)||
      !['approved','rejected','needs_changes'].includes(b.status)||
      (b.note!=null&&(typeof b.note!=='string'||b.note.length>2000)))
      return json({error:'Invalid evidence review'},400,current.cookies);
    const r=await backend(env,'/rest/v1/rpc/itqan_school_review_evidence','POST',
      {p_evidence:b.evidence_id,p_status:b.status,p_note:b.note||null},current.token);
    return r.ok?json({ok:true},200,current.cookies):
      json({error:r.data?.code==='42501'?'Forbidden':'Review rejected'},r.data?.code==='42501'?403:422,current.cookies);
  }
  // #16: score an official framework criterion, submit the completed assessment and approve internally.
  if(pathname==='/api/school/reviews'){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    if(request.method==='GET'){
      const schoolId=new URL(request.url).searchParams.get('school_id');
      if(!schoolId||!/^[0-9a-f-]{36}$/i.test(schoolId))return json({error:'Invalid school'},400,current.cookies);
      const r=await backend(env,'/rest/v1/performance_reviews?select=id,school_id,subject_user_id,reviewer_user_id,academic_year,framework_id,job_title_id,status,final_score_100,visible_to_employee,approved_at&school_id=eq.'+
        encodeURIComponent(schoolId)+'&order=created_at.desc&limit=200','GET',undefined,current.token);
      return r.ok?json({reviews:r.data},200,current.cookies):
        json({error:'Unable to read school evaluations'},502,current.cookies);
    }
    if(request.method!=='POST')return json({error:'Method not allowed'},405,current.cookies);
    const b=await input(request);
    const uuid=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x);
    if(!b||!uuid(b.school_id)||!uuid(b.subject_user_id)||!uuid(b.framework_id)||!uuid(b.job_title_id)||
       typeof b.year!=='string'||b.year.length>60||
       !current.user.schoolMemberships.some(m=>m.school_id===b.school_id&&m.access_role==='school_principal'))
      return json({error:'Invalid review or permission'},403,current.cookies);
    const r=await backend(env,'/rest/v1/rpc/itqan_school_create_review','POST',
      {p_school:b.school_id,p_subject:b.subject_user_id,p_year:b.year,p_framework:b.framework_id,p_job:b.job_title_id},current.token);
    return r.ok?json({review_id:r.data},201,current.cookies):
      json({error:r.data?.code==='42501'?'Forbidden':'Unable to create review'},r.data?.code==='42501'?403:422,current.cookies);
  }
  if(pathname==='/api/school/review-actions'&&request.method==='POST'){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const b=await input(request);
    const uuid=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x);
    if(!b||!uuid(b.review_id))return json({error:'Invalid review'},400,current.cookies);
    let rpc,params;
    if(b.action==='score'){
      if(!uuid(b.criterion_id)||!Number.isInteger(b.score_level)||b.score_level<1||b.score_level>5||
       (b.note!=null&&(typeof b.note!=='string'||b.note.length>2000)))
       return json({error:'Invalid score'},400,current.cookies);
      rpc='itqan_school_score_criterion';
      params={p_review:b.review_id,p_criterion:b.criterion_id,p_level:b.score_level,p_note:b.note||null};
    }else if(b.action==='submit'){
      rpc='itqan_school_submit_review';params={p_review:b.review_id};
    }else if(b.action==='approve'){
      rpc='itqan_school_approve_review';params={p_review:b.review_id};
    }else return json({error:'Unknown review action'},400,current.cookies);
    const r=await backend(env,'/rest/v1/rpc/'+rpc,'POST',params,current.token);
    return r.ok?json({ok:true,result:r.data},200,current.cookies):
      json({error:r.data?.code==='42501'?'Forbidden':'Review criteria incomplete or invalid'},
        r.data?.code==='42501'?403:422,current.cookies);
  }
  if(pathname==='/api/school/exception-criteria'&&request.method==='GET'){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const id=new URL(request.url).searchParams.get('request_id');
    if(!id||!/^[0-9a-f-]{36}$/i.test(id))return json({error:'Invalid exception'},400,current.cookies);
    const r=await backend(env,'/rest/v1/rpc/itqan_school_exception_criteria','POST',
      {p_request:id},current.token);
    return r.ok?json({criteria:r.data},200,current.cookies):
      json({error:r.data?.code==='42501'?'Forbidden':'Unable to read exceptional criteria'},
        r.data?.code==='42501'?403:422,current.cookies);
  }
  // #16: independently approved, time-boxed continuation of frozen evaluations.
  if(pathname==='/api/school/review-exceptions'){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const uuid=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x);
    if(request.method==='GET'){
      const schoolId=new URL(request.url).searchParams.get('school_id');
      if(schoolId&&!current.user.schoolMemberships.some(m=>m.school_id===schoolId&&m.access_role==='school_principal'))
        return json({error:'Forbidden'},403,current.cookies);
      const url='/rest/v1/review_exception_requests?select=id,review_id,school_id,requested_by,approved_by,status,reason,starts_at,expires_at,created_at&'+
        (schoolId?'school_id=eq.'+encodeURIComponent(schoolId):
          'requested_by=eq.'+encodeURIComponent(current.user.id))+'&order=created_at.desc&limit=100';
      const result=await backend(env,url,'GET',undefined,current.token);
      return result.ok?json({exceptions:result.data},200,current.cookies):
        json({error:'Unable to read exceptions'},502,current.cookies);
    }
    if(request.method!=='POST')return json({error:'Method not allowed'},405,current.cookies);
    const b=await input(request);
    if(!b||typeof b!=='object'||Array.isArray(b))return json({error:'Invalid exception'},400,current.cookies);
    let rpc,params;
    if(b.action==='request'){
      if(!uuid(b.review_id)||typeof b.reason!=='string'||b.reason.length<10||b.reason.length>1000)
        return json({error:'Invalid exception request'},400,current.cookies);
      rpc='itqan_school_request_review_exception';
      params={p_review:b.review_id,p_reason:b.reason};
    }else if(b.action==='decide'){
      if(!uuid(b.request_id)||typeof b.approve!=='boolean'||
       (b.approve&&typeof b.expires_at!=='string'))
        return json({error:'Invalid exception approval'},400,current.cookies);
      rpc='itqan_school_decide_review_exception';
      params={p_request:b.request_id,p_approve:b.approve,p_expiry:b.approve?b.expires_at:null};
    }else if(b.action==='score'){
      if(!uuid(b.request_id)||!uuid(b.criterion_id)||!Number.isInteger(b.score_level)||
        b.score_level<1||b.score_level>5||
        (b.note!=null&&(typeof b.note!=='string'||b.note.length>2000)))
        return json({error:'Invalid exceptional score'},400,current.cookies);
      rpc='itqan_school_exception_score';
      params={p_request:b.request_id,p_criterion:b.criterion_id,p_level:b.score_level,p_note:b.note||null};
    }else if(b.action==='submit'){
      if(!uuid(b.request_id))return json({error:'Invalid exception id'},400,current.cookies);
      rpc='itqan_school_exception_submit';params={p_request:b.request_id};
    }else return json({error:'Unknown exception action'},400,current.cookies);
    const result=await backend(env,'/rest/v1/rpc/'+rpc,'POST',params,current.token);
    return result.ok?json({ok:true,result:result.data},200,current.cookies):
      json({error:result.data?.code==='42501'?'Forbidden':'Exception incomplete or invalid'},
        result.data?.code==='42501'?403:422,current.cookies);
  }
  // Personnel linking operations use authenticated, auditable PostgreSQL RPCs.
  if (['/api/school/personnel','/api/school/link-request','/api/school/link-decision',
       '/api/school/unlink'].includes(pathname) && request.method === 'POST') {
    const current = await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const body=await input(request);
    if(!body || typeof body!=='object' || Array.isArray(body))
      return json({error:'Invalid request'},400,current.cookies);
    const uuid=x=>typeof x==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
    const principal=schoolId=>current.user.schoolMemberships.some(m=>
      m.school_id===schoolId && m.access_role==='school_principal');
    let rpc,params,fields;
    if(pathname==='/api/school/personnel'){
      fields=['school_id','year_id','full_name','national_id','job_title_id'];
      if(!uuid(body.school_id)||!uuid(body.year_id)||!principal(body.school_id)||
        typeof body.full_name!=='string'||body.full_name.trim().length<2||
        body.full_name.trim().length>200||
        (body.job_title_id!=null&&!uuid(body.job_title_id))||
        (body.national_id!=null&&!/^[0-9]{10}$/.test(body.national_id)))
        return json({error:'Invalid personnel request or permission'},403,current.cookies);
      rpc='itqan_school_create_personnel';
      params={p_school:body.school_id,p_year:body.year_id,p_name:body.full_name.trim(),
        p_national_id:body.national_id||null,p_job:body.job_title_id||null};
    }else if(pathname==='/api/school/link-request'){
      fields=['school_employee_id'];
      if(!uuid(body.school_employee_id))return json({error:'Invalid personnel reference'},400,current.cookies);
      rpc='itqan_school_request_link';params={p_school_employee:body.school_employee_id};
    }else if(pathname==='/api/school/link-decision'){
      fields=['school_id','request_id','approve','job_role','note'];
      if(!uuid(body.school_id)||!principal(body.school_id)||!uuid(body.request_id)||
         typeof body.approve!=='boolean'||
         (body.job_role!=null&&!['teacher','vice_principal','counselor','staff'].includes(body.job_role))||
         (body.note!=null&&(typeof body.note!=='string'||body.note.length>1000)))
        return json({error:'Invalid approval request or permission'},403,current.cookies);
      rpc='itqan_school_decide_link';
      params={p_request:body.request_id,p_approve:body.approve,
        p_job_role:body.job_role||'staff',p_note:body.note||null};
    }else{
      fields=['school_id','user_id','reason'];
      if(!uuid(body.school_id)||!uuid(body.user_id)||
        (body.user_id!==current.user.id&&!principal(body.school_id))||
        typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>500)
        return json({error:'Invalid unlink request or permission'},403,current.cookies);
      rpc='itqan_school_unlink';
      params={p_school:body.school_id,p_user:body.user_id,p_reason:body.reason.trim()};
    }
    if(Object.keys(body).some(k=>!fields.includes(k)))return json({error:'Unexpected fields'},400,current.cookies);
    const result=await backend(env,'/rest/v1/rpc/'+rpc,'POST',params,current.token);
    if(!result.ok){
      const status=result.data?.code==='42501'?403:
        result.data?.code==='23505'?409:result.data?.code==='22023'?422:502;
      return json({error:status===409?'School membership conflict':status===403?'Forbidden':
        'Unable to complete personnel operation'},status,current.cookies);
    }
    return json({ok:true,result:result.data},pathname==='/api/school/link-request'?201:200,current.cookies);
  }
  if(pathname==='/api/school/link-requests' && request.method==='GET'){
    const current=await session(request,env);
    if(!current.user)return json({error:'Unauthorized'},401,current.cookies);
    const schoolId=new URL(request.url).searchParams.get('school_id');
    if(schoolId && !current.user.schoolMemberships.some(m=>m.school_id===schoolId&&m.access_role==='school_principal'))
      return json({error:'Forbidden'},403,current.cookies);
    const path='/rest/v1/school_link_requests?select=id,school_id,school_employee_id,user_id,status,requested_at,decided_at,decision_note'+
      (schoolId?'&school_id=eq.'+encodeURIComponent(schoolId):'&user_id=eq.'+encodeURIComponent(current.user.id))+
      '&order=requested_at.desc&limit=200';
    const result=await backend(env,path,'GET',undefined,current.token);
    return result.ok?json({requests:result.data},200,current.cookies):
      json({error:'Unable to read linking requests'},502,current.cookies);
  }
  if (pathname === '/api/school/members' && request.method === 'GET') {
    const current=await session(request,env);
    if(!current.user) return json({error:'Unauthorized'},401,current.cookies);
    const schoolId=new URL(request.url).searchParams.get('school_id');
    if (!schoolId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(schoolId))
      return json({error:'Invalid school'},400,current.cookies);
    const canView=current.user.role==='site_admin' ||
      current.user.schoolMemberships.some(m=>m.school_id===schoolId && m.access_role==='school_principal');
    if(!canView)return json({error:'Forbidden'},403,current.cookies);
    const memberships=await backend(env,
      '/rest/v1/school_memberships?select=user_id,access_role,job_role,status&school_id=eq.'+schoolId+
      '&order=created_at.desc&limit=200','GET',undefined,current.token);
    if(!memberships.ok)return json({error:'Unable to read members'},502,current.cookies);
    const members=Array.isArray(memberships.data)?memberships.data:[];
    const ids=[...new Set(members.map(m=>m.user_id).filter(x=>typeof x==='string'))];
    if(!ids.length)return json({members:[]},200,current.cookies);
    const profiles=await backend(env,
      '/rest/v1/users?select=id,full_name,status&id=in.('+ids.map(encodeURIComponent).join(',')+')',
      'GET',undefined,current.token);
    if(!profiles.ok)return json({error:'Unable to read member profiles'},502,current.cookies);
    const names=new Map((Array.isArray(profiles.data)?profiles.data:[]).map(p=>[p.id,p]));
    return json({members:members.map(m=>({
      user_id:m.user_id,full_name:names.get(m.user_id)?.full_name||null,
      user_status:names.get(m.user_id)?.status||null,
      access_role:m.access_role,job_role:m.job_role,status:m.status,
    }))},200,current.cookies);
  }
  if ((pathname === '/api/session' || pathname === '/api/schools') && request.method === 'GET') {
    const current = await session(request, env, pathname==='/api/session');
    if (!current.user) return json({ error: 'Unauthorized' }, 401, current.cookies);
    if (pathname === '/api/session') return json({ user: current.user }, 200, current.cookies);
    if (current.user.role !== 'site_admin' && !current.user.schoolMemberships.length)
      return json({ error: 'School membership required' }, 403, current.cookies);
    const schools = await backend(env,
      '/rest/v1/schools?select=id,name,education_department,status&order=name.asc',
      'GET', undefined, current.token);
    if (!schools.ok) return json({ error: 'Unable to read schools' }, 502, current.cookies);
    return json({ schools: schools.data }, 200, current.cookies);
  }
  return json({ error: 'Not found' }, 404);
}
function redirect(target, cookies = []) {
  const response = new Response(null, { status: 302, headers: { location: target, 'cache-control': 'no-store' } });
  for (const value of cookies) response.headers.append('set-cookie', value);
  return response;
}
function secureAsset(response, privatePage = false) {
  const modified = new Response(response.body, response);
  const security = headers();
  for (const key of ['x-content-type-options', 'referrer-policy', 'x-frame-options', 'content-security-policy']) {
    modified.headers.set(key, security.get(key));
  }
  if (privatePage) modified.headers.set('cache-control', 'private, no-store');
  return modified;
}
// Serve a small access page at the requested URL. No query data and no redirect loop.
async function accessDeniedPage(request,env,reason,cookies=[]){
  const page=await env.ASSETS.fetch(new Request(new URL('/access.html',request.url),request));
  if(!page.ok || (page.status>=300&&page.status<400))throw new Error('Access page unavailable');
  const kind=['login','forbidden','membership'].includes(reason)?reason:'unavailable';
  const html=(await page.text()).replace('data-access-state="default"',
    'data-access-state="'+kind+'"');
  const response=new Response(request.method==='HEAD'?null:html,{
    status:kind==='login'?401:403,headers:headers('text/html; charset=utf-8')});
  for(const cookie of cookies)response.headers.append('set-cookie',cookie);
  return response;
}
async function explicitHtmlAsset(request,env,path,privatePage=false){
  const response=await env.ASSETS.fetch(new Request(new URL(path,request.url),request));
  if(!response.ok)throw new Error('HTML asset unavailable: '+path);
  return secureAsset(response,privatePage);
}
function publicHtmlPath(pathname){
  if(pathname==='/')return '/index.html';
  const match=pathname.match(/^\/(index|login|register|access|recover|password)(?:\.html|\/)?$/);
  return match?'/'+match[1]+'.html':null;
}
export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    try {
      const target=protectedRoute(pathname);
      if(env.PREVIEW_ONLY==='true'){
        if(pathname.startsWith(API_PREFIX)||target)
          return json({error:'هذه الصفحة غير متاحة في المعاينة البصرية',code:'PREVIEW_ONLY'},403);
        if(pathname==='/admin-preview.html')
          return secureAsset(await env.ASSETS.fetch(request),true);
      }else if(pathname==='/admin-preview.html'){
        return json({error:'الصفحة غير موجودة',code:'NOT_FOUND'},404);
      }
      if(pathname.startsWith(API_PREFIX))return await api(request,env,pathname);
      if(target){
        if(request.method!=='GET'&&request.method!=='HEAD')
          return json({error:'طريقة الطلب غير مسموحة',code:'METHOD_NOT_ALLOWED'},405);
        const current=await session(request,env,true);
        if(!current.user)return accessDeniedPage(request,env,'login',current.cookies);
        if(current.user.mustChangePassword)return redirect('/password.html',current.cookies);
        if(['admin','frameworks'].includes(target.section)&&current.user.role!=='site_admin')
          return accessDeniedPage(request,env,'forbidden',current.cookies);
        if(target.section==='school'&&current.user.role!=='site_admin'&&
            current.user.schoolMemberships.length===0)
          return accessDeniedPage(request,env,'membership',current.cookies);
        const page=await explicitHtmlAsset(request,env,target.asset,true);
        for(const cookie of current.cookies)page.headers.append('set-cookie',cookie);
        return page;
      }
      const publicPage=publicHtmlPath(pathname);
      if(publicPage){
        if(publicPage==='/access.html'&&new URL(request.url).search)return redirect('/access');
        return explicitHtmlAsset(request,env,publicPage,
          publicPage==='/access.html'||publicPage==='/login.html');
      }
      return secureAsset(await env.ASSETS.fetch(request));
    } catch {
      return pathname.startsWith(API_PREFIX) ? json({ error: 'Service unavailable' }, 503)
        : new Response('الخدمة غير متاحة حالياً', { status: 503, headers: headers('text/plain; charset=utf-8') });
    }
  },
};
