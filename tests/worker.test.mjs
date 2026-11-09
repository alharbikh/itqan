import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const ORIGIN = 'https://itqan.example';
const ENV = {
  SUPABASE_URL: 'https://itqan-test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_unit_test_only',
  ASSETS: { fetch: async () => new Response('<html>Private shell</html>', { headers: { 'content-type': 'text/html' } }) },
};
const TOKEN = 'test-access-token';
const REFRESH = 'test-refresh-token';
const account = { id: '00000000-0000-4000-8000-000000000001', email: 'person@example.invalid' };

function interceptedFetch({ role = 'member', membership = true, failAccess = false } = {}) {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const token = init.headers?.authorization;
    calls.push({ path: u.pathname, auth: token, method: init.method, body: init.body });
    const ok = value => Response.json(value);
    if (u.pathname === '/auth/v1/token') {
      if (u.searchParams.get('grant_type') === 'password') {
        return ok({ access_token: TOKEN, refresh_token: REFRESH, expires_in: 3500 });
      }
      return ok({ access_token: TOKEN, refresh_token: REFRESH, expires_in: 3500 });
    }
    if (u.pathname === '/auth/v1/signup') return ok({ user: account });
    if (u.pathname === '/auth/v1/logout') return ok({});
    if (u.pathname === '/auth/v1/user') {
      if (failAccess || !token) return Response.json({ message: 'Unauthorized' }, { status: 401 });
      return ok(account);
    }
    if (u.pathname === '/rest/v1/users') return ok([{ id: account.id, full_name: 'موظف مخوّل', status: 'active' }]);
    if (u.pathname === '/rest/v1/user_roles') return ok(role === 'site_admin' ? [{ role_code: 'site_admin' }] : []);
    if (u.pathname === '/rest/v1/school_memberships') return ok(membership ? [{ school_id: 'school-a', access_role: 'employee', status: 'active' }] : []);
    if (u.pathname === '/rest/v1/schools') return ok([{ id: 'school-a', name: 'المدرسة أ', status: 'active' }]);
    throw Error('Unknown route: ' + u.pathname);
  };
  return { calls, restore: () => { globalThis.fetch = previous; } };
}
function req(path, options = {}) {
  return new Request(ORIGIN + path, options);
}
function cookieHeader(response) {
  return response.headers.getSetCookie().map(x => x.split(';', 1)[0]).join('; ');
}
function authenticated(method = 'GET') {
  return { method, headers: { cookie: '__Host-itqan_at=' + TOKEN + '; __Host-itqan_rt=' + REFRESH } };
}
test('password authentication sets httpOnly secure cookies and never returns tokens in JSON', async () => {
  const mock = interceptedFetch();
  try {
    const response = await worker.fetch(req('/api/login', {
      method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ email: account.email, password: 'irrelevant-runtime-credential' }),
    }), ENV);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.role, 'member');
    assert.equal(response.headers.getSetCookie().length, 2);
    for (const c of response.headers.getSetCookie()) {
      assert.match(c, /HttpOnly/);
      assert.match(c, /Secure/);
      assert.match(c, /SameSite=Lax/);
    }
    const result = await worker.fetch(req('/api/session', { headers: { cookie: cookieHeader(response) } }), ENV);
    const payload = await result.json();
    assert.equal(result.status, 200);
    assert.equal(payload.user.id, account.id);
    assert.equal(JSON.stringify(payload).includes(TOKEN), false);
    assert.equal(mock.calls.filter(x => x.path === '/auth/v1/user').length >= 1, true);
  } finally { mock.restore(); }
});
test('anonymous visitor cannot read protected APIs or pages', async () => {
  const mock = interceptedFetch();
  try {
    const api = await worker.fetch(req('/api/schools'), ENV);
    assert.equal(api.status, 401);
    const page = await worker.fetch(req('/admin.html'), ENV);
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), '/login.html');
    assert.equal(mock.calls.some(c => c.path === '/rest/v1/schools'), false);
  } finally { mock.restore(); }
});
test('ordinary member cannot open admin page, and can view school rows via JWT', async () => {
  const mock = interceptedFetch();
  try {
    const page = await worker.fetch(req('/admin.html', authenticated()), ENV);
    assert.equal(page.status, 403);
    const own = await worker.fetch(req('/school.html', authenticated()), ENV);
    assert.equal(own.status, 200);
    assert.match(own.headers.get('cache-control'), /no-store/);
    const schools = await worker.fetch(req('/api/schools', authenticated()), ENV);
    assert.equal(schools.status, 200);
    assert.equal((await schools.json()).schools.length, 1);
    const dbCall = mock.calls.find(x => x.path === '/rest/v1/schools');
    assert.equal(dbCall.auth, 'Bearer ' + TOKEN);
  } finally { mock.restore(); }
});
test('account without school access cannot read school data', async () => {
  const mock = interceptedFetch({ membership: false });
  try {
    assert.equal((await worker.fetch(req('/school.html', authenticated()), ENV)).status, 403);
    assert.equal((await worker.fetch(req('/api/schools', authenticated()), ENV)).status, 403);
    assert.equal(mock.calls.some(x => x.path === '/rest/v1/schools'), false);
  } finally { mock.restore(); }
});
test('admin can open administrator page after server-side role check', async () => {
  const mock = interceptedFetch({ role: 'site_admin', membership: false });
  try { assert.equal((await worker.fetch(req('/admin.html', authenticated()), ENV)).status, 200); }
  finally { mock.restore(); }
});
test('registration submits identity only, never a privileged role or school', async () => {
  const mock = interceptedFetch();
  try {
    const response = await worker.fetch(req('/api/register', {
      method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'مستخدم جديد', email: account.email, password: 'a-long-test-password',
        role: 'site_admin', school_id: 'fake-school' }),
    }), ENV);
    assert.equal(response.status, 202);
    const sent = JSON.parse(mock.calls.find(x => x.path === '/auth/v1/signup').body);
    assert.deepEqual(Object.keys(sent.data), ['full_name']);
    assert.equal(sent.role, undefined);
    assert.equal(sent.school_id, undefined);
  } finally { mock.restore(); }
});
test('cross-origin mutation is rejected before credentials are processed', async () => {
  const mock = interceptedFetch();
  try {
    const response = await worker.fetch(req('/api/logout', { method: 'POST', headers: { origin: 'https://other.example' } }), ENV);
    assert.equal(response.status, 403);
    assert.equal(mock.calls.length, 0);
  } finally { mock.restore(); }
});
test('logout invalidates both httpOnly cookies', async () => {
  const mock = interceptedFetch();
  try {
    const response = await worker.fetch(req('/api/logout', {
      ...authenticated('POST'), headers: { ...authenticated().headers, origin: ORIGIN },
    }), ENV);
    assert.equal(response.status, 200);
    assert.equal(response.headers.getSetCookie().length, 2);
    assert.ok(response.headers.getSetCookie().every(c => c.includes('Max-Age=0')));
  } finally { mock.restore(); }
});


test('new personnel and evaluation routes reject unauthenticated and unprivileged callers', async () => {
  const mock = interceptedFetch();
  try {
    const anonymous = await worker.fetch(req('/api/evidence/personal'), ENV);
    assert.equal(anonymous.status, 401);
    const framework = await worker.fetch(req('/api/admin/framework-batches', authenticated()), ENV);
    assert.equal(framework.status, 403);
    assert.equal(mock.calls.some(x => x.path === '/rest/v1/framework_import_batches'), false);
    const link = await worker.fetch(req('/api/school/link-decision', {
      method: 'POST',
      headers: { ...authenticated().headers, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({
        school_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        request_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        approve: true, job_role: 'teacher',
      }),
    }), ENV);
    assert.equal(link.status, 403);
    assert.equal(mock.calls.some(x => x.path.endsWith('/rpc/itqan_school_decide_link')), false);
    const score = await worker.fetch(req('/api/school/review-actions', {
      method: 'POST',
      headers: { ...authenticated().headers, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'score', review_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        criterion_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', score_level: 6,
      }),
    }), ENV);
    assert.equal(score.status, 400);
    assert.equal(mock.calls.some(x => x.path.endsWith('/rpc/itqan_school_score_criterion')), false);
  } finally { mock.restore(); }
});
