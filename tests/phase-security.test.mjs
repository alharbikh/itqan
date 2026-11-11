import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const ORIGIN = 'https://itqan.example';
const ENV = {
  SUPABASE_URL: 'https://itqan-test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_unit_test_only',
  ASSETS: {fetch: async () => new Response('<html>Protected shell</html>', {
    headers: {'content-type':'text/html'}})},
};
const UUID = '00000000-0000-4000-8000-000000000001';
const protectedReads = [
  '/api/admin/schools', '/api/admin/users', '/api/admin/audit',
  '/api/admin/framework-batches', '/api/personnel/schools',
  '/api/personnel/my-profiles', '/api/personnel/operations',
  '/api/school/midyear-feedback', '/api/school/shared-evidence',
  '/api/evidence/personal', '/api/evidence/attachments?evidence_id='+UUID,
  '/api/school/reviews', '/api/school/members?school_id='+UUID,
];
const protectedWrites = [
  '/api/admin/actions', '/api/admin/academic-years',
  '/api/admin/framework-batches', '/api/admin/users/password',
  '/api/personnel/requests', '/api/personnel/direct',
  '/api/personnel/operations', '/api/school/stage-window',
  '/api/school/review-delegations', '/api/school/review-actions',
  '/api/school/review-exceptions', '/api/evidence/share',
  '/api/evidence/attachments', '/api/password/change',
];

test('all major project phases reject unauthenticated API reads and writes', async () => {
  const previous = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => { upstreamCalls++; throw Error('Unexpected upstream request'); };
  try {
    for (const path of protectedReads) {
      const response = await worker.fetch(new Request(ORIGIN+path), ENV);
      assert.equal(response.status, 401, 'anonymous GET '+path);
    }
    for (const path of protectedWrites) {
      const response = await worker.fetch(new Request(ORIGIN+path, {
        method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},
        body:'{}',
      }), ENV);
      assert.equal(response.status, 401, 'anonymous POST '+path);
    }
    assert.equal(upstreamCalls, 0, 'anonymous requests should not contact the database');
  } finally { globalThis.fetch = previous; }
});

test('cross-origin requests never reach a privileged API across project phases', async () => {
  const previous = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => { upstreamCalls++; throw Error('Unexpected upstream request'); };
  try {
    for (const path of protectedWrites) {
      const response = await worker.fetch(new Request(ORIGIN+path, {
        method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},
        body:'{}',
      }), ENV);
      assert.equal(response.status, 403, 'cross-origin POST '+path);
    }
    assert.equal(upstreamCalls, 0);
  } finally { globalThis.fetch = previous; }
});

test('forced password change leaves only session visibility and password-change flow accessible', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init={}) => {
    const route = new URL(url).pathname;
    calls.push(route);
    if (route==='/auth/v1/user') return Response.json({
      id:UUID,email:'owner@example.invalid',
      app_metadata:{itqan_force_password_change:true},
    });
    if (route==='/rest/v1/users') return Response.json([{id:UUID,full_name:'مدير',status:'active'}]);
    if (route==='/rest/v1/user_roles') return Response.json([{role_code:'site_admin'}]);
    if (route==='/rest/v1/school_memberships') return Response.json([]);
    throw Error('Unexpected upstream: '+route);
  };
  const cookies = {cookie:'__Host-itqan_at=access-test'};
  try {
    const session = await worker.fetch(new Request(ORIGIN+'/api/session',{headers:cookies}),ENV);
    assert.equal(session.status,200);
    assert.equal((await session.json()).user.mustChangePassword,true);
    const data = await worker.fetch(new Request(ORIGIN+'/api/schools',{headers:cookies}),ENV);
    assert.equal(data.status,401);
    const admin = await worker.fetch(new Request(ORIGIN+'/admin.html',{headers:cookies}),ENV);
    assert.equal(admin.status,302);
    assert.equal(admin.headers.get('location'),'/password.html');
    const reset = await worker.fetch(new Request(ORIGIN+'/api/password/change',{
      method:'POST',headers:{...cookies,origin:ORIGIN,'content-type':'application/json'},
      body:JSON.stringify({current_password:'temporary123',password:'temporary123'}),
    }),ENV);
    assert.equal(reset.status,400);
    assert.equal((await reset.json()).code,'PASSWORD_REUSED');
    assert.equal(calls.some(x=>x==='/functions/v1/itqan-account-recovery'),false);
  } finally { globalThis.fetch=previous; }
});
