// Itqan Smart Pro — Cloudflare Worker / Supabase BFF.
// Authentication cookies are HttpOnly; browser scripts receive no access or refresh tokens.
const ACCESS_COOKIE = '__Host-itqan_at';
const REFRESH_COOKIE = '__Host-itqan_rt';
const API_PREFIX = '/api/';
const SESSION_MAX_AGE = 60 * 60;
const REFRESH_MAX_AGE = 60 * 60 * 24 * 14;

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
    schoolMemberships: (Array.isArray(memberships.data) ? memberships.data : [])
      .filter(x => x.status === 'active').map(x => ({ school_id: x.school_id, access_role: x.access_role, job_role: x.job_role })),
  };
}
async function session(request, env) {
  const stored = readCookies(request);
  const access = stored[ACCESS_COOKIE];
  const user = await verifiedUser(env, access);
  if (user) return { user, token: access, cookies: [] };
  const refresh = stored[REFRESH_COOKIE];
  if (!refresh) return { user: null, cookies: clearedCookies() };
  const updated = await backend(env, '/auth/v1/token?grant_type=refresh_token', 'POST',
    { refresh_token: refresh });
  if (!updated.ok || !updated.data?.access_token || !updated.data?.refresh_token)
    return { user: null, cookies: clearedCookies() };
  const refreshedUser = await verifiedUser(env, updated.data.access_token);
  if (!refreshedUser) return { user: null, cookies: clearedCookies() };
  return { user: refreshedUser, token: updated.data.access_token, cookies: tokensCookies(updated.data) };
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

function validSchool(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      typeof body.name !== 'string' || body.name.trim().length < 2 ||
      body.name.trim().length > 160) return null;
  const allowed = ['name','education_stage','gender','education_department','ministry_number'];
  if (Object.keys(body).some(key => !allowed.includes(key))) return null;
  const result = { name: body.name.trim() };
  for (const key of allowed.slice(1)) {
    const value = body[key];
    if (value === undefined || value === null || value === '') {
      result[key] = null;
      continue;
    }
    if (typeof value !== 'string' || value.trim().length > 160) return null;
    result[key] = value.trim();
  }
  if (result.gender !== null && !['male','female','mixed'].includes(result.gender)) return null;
  return result;
}

async function api(request, env, pathname) {
  if (['POST','PATCH','PUT','DELETE'].includes(request.method) && !sameOrigin(request)) return json({ error: 'Forbidden' }, 403);
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
    return json({ user }, 200, tokensCookies(result.data));
  }
  if (pathname === '/api/register' && request.method === 'POST') {
    const body = await input(request);
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string' ||
        typeof body.name !== 'string' || body.name.trim().length < 2 ||
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email) ||
        body.password.length < 12 || body.password.length > 1024) return json({ error: 'Invalid registration' }, 400);
    const response = await backend(env, '/auth/v1/signup', 'POST', {
      email: body.email.trim(), password: body.password,
      data: { full_name: body.name.trim().slice(0, 200) },
    });
    if (!response.ok) return json({ error: 'Unable to register account' }, 400);
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
      const school = validSchool(body);
      if (!school) return json({ error: 'Invalid school data' }, 400, current.cookies);
      const result = await backend(env, '/rest/v1/schools?select=id,name,education_stage,gender,education_department,ministry_number,status,created_at',
        'POST', school, current.token, { Prefer: 'return=representation' });
      if (!result.ok) return json({ error: result.status === 403 || result.status === 401 ? 'Forbidden' : 'Could not create school' },
        result.status === 403 || result.status === 401 ? 403 : 422, current.cookies);
      return json({ school: result.data?.[0] }, 201, current.cookies);
    }

    if (request.method === 'PATCH' && pathname.startsWith('/api/admin/schools/')) {
      const schoolId = pathname.split('/').pop();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(schoolId))
        return json({ error: 'Invalid school' }, 400, current.cookies);
      const body = await input(request);
      const school = validSchool(body);
      if (!school) return json({ error: 'Invalid school data' }, 400, current.cookies);
      const result = await backend(env,
        '/rest/v1/schools?id=eq.' + schoolId + '&select=id,name,education_stage,gender,education_department,ministry_number,status,created_at',
        'PATCH', school, current.token, { Prefer: 'return=representation' });
      if (!result.ok) return json({ error: result.status === 403 || result.status === 401 ? 'Forbidden' : 'Could not update school' },
        result.status === 403 || result.status === 401 ? 403 : 422, current.cookies);
      if (!Array.isArray(result.data) || !result.data.length)
        return json({ error: 'School not found' }, 404, current.cookies);
      return json({ school: result.data[0] }, 200, current.cookies);
    }
    return json({ error: 'Method not allowed' }, 405, current.cookies);
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
    const current = await session(request, env);
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
export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    try {
      if (env.PREVIEW_ONLY === 'true') {
        if (pathname.startsWith(API_PREFIX) || pathname === '/admin.html' || pathname === '/school.html')
          return json({error:'Not available in visual preview'},403);
        if (pathname === '/admin-preview.html')
          return secureAsset(await env.ASSETS.fetch(request),true);
      } else if (pathname === '/admin-preview.html') {
        return json({error:'Not found'},404);
      }
      if (pathname.startsWith(API_PREFIX)) return await api(request, env, pathname);
      if (pathname === '/admin.html' || pathname === '/school.html') {
        const current = await session(request, env);
        if (!current.user) return redirect('/login.html', current.cookies);
        if (pathname === '/admin.html' && current.user.role !== 'site_admin')
          return json({ error: 'Forbidden' }, 403, current.cookies);
        if (pathname === '/school.html' && current.user.role !== 'site_admin' &&
            current.user.schoolMemberships.length === 0)
          return json({ error: 'Membership required' }, 403, current.cookies);
        const page = secureAsset(await env.ASSETS.fetch(request), true);
        for (const value of current.cookies) page.headers.append('set-cookie', value);
        return page;
      }
      return secureAsset(await env.ASSETS.fetch(request));
    } catch {
      return pathname.startsWith(API_PREFIX) ? json({ error: 'Service unavailable' }, 503)
        : new Response('الخدمة غير متاحة حالياً', { status: 503, headers: headers('text/plain; charset=utf-8') });
    }
  },
};
