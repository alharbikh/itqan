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
    backend(env, '/rest/v1/school_memberships?select=school_id,access_role,status&user_id=eq.' + id,
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
      .filter(x => x.status === 'active').map(x => ({ school_id: x.school_id, access_role: x.access_role })),
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
async function input(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return null;
  if (Number(request.headers.get('content-length') || 0) > 8192) return null;
  try {
    const text = await request.text();
    return text.length <= 8192 ? JSON.parse(text) : null;
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

  if (pathname === '/api/admin/schools' || pathname === '/api/admin/users' ||
      /^\\/api\\/admin\\/schools\\/[0-9a-f-]{36}$/.test(pathname)) {
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
