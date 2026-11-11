import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20261111172000_school_directed_invitations.sql',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/school.html',import.meta.url),'utf8');
const link=readFileSync(new URL('../public/link.html',import.meta.url),'utf8');
const recipient=readFileSync(new URL('../public/invitations.js',import.meta.url),'utf8');

test('legacy employee-originated enrollment is denied at Worker and database',()=>{
  assert.match(worker,/SCHOOL_INVITATION_REQUIRED/);
  assert.match(worker,/\/api\/personnel\/requests/);
  assert.match(worker,/\/api\/school\/link-request/);
  assert.match(migration,/revoke all on function public\.itqan_personnel_submit_request/);
  assert.match(migration,/revoke all on function public\.itqan_school_request_link/);
  assert.match(link,/<section class="perf-section" hidden><h2>طلب إنشاء ملف وظيفي/);
});
test('invitations require school-scoped management and verified email consent',()=>{
  assert.match(migration,/has_school_permission\(p_school,'school\.manage_members'\)/);
  assert.match(migration,/email_confirmed_at is null/);
  assert.match(migration,/lower\(v_auth\.email\)<>v_inv\.invite_email/);
  assert.match(migration,/v_auth\.created_at<v_inv\.created_at/);
  assert.match(migration,/enable row level security/);
  assert.match(migration,/revoke all on public\.school_invitations from public,anon,authenticated/);
});
test('invitation creation does not provision a login and user consent is explicit',()=>{
  assert.match(html,/data-personnel-tab="invitations"/);
  assert.match(recipient,/accept:true|accept\}/); // explicit acceptance from a click handler
  assert.match(worker,/itqan_school_invitation_create/);
  assert.match(worker,/itqan_school_invitation_decide/);
  assert.doesNotMatch(migration,/auth\/v1\/admin\/users/);
});
