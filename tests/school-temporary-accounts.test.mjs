import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const edge=readFileSync(new URL('../supabase/functions/itqan-account-recovery/index.ts',import.meta.url),'utf8');
const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261111172306_school_temporary_accounts.sql',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/school.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/school-invitations.js',import.meta.url),'utf8');

test('exceptional account creation is separate from personal account and privileged',()=>{
 assert.match(worker,/\/api\/school\/accounts\/temporary/);
 assert.match(worker,/schoolMemberships\.some/);
 assert.match(edge,/body\.action==='school_create_temporary_account'/);
 assert.match(edge,/itqan_school_provision_temporary_account/);
 assert.match(sql,/revoke all on function public\.itqan_school_provision_temporary_account\([\s\S]+?from public,anon,authenticated/);
 assert.match(sql,/grant execute on function public\.itqan_school_provision_temporary_account\([\s\S]+?to service_role/);
 assert.match(sql,/itqan_school_account/);
});
test('temporary password expiry, forced rotation and audit guard',()=>{
 assert.match(edge,/temporaryPassword\(\)/);
 assert.match(edge,/itqan_force_password_change:true/);
 assert.match(edge,/itqan_temp_password_expires_at:expires_at/);
 assert.match(edge,/school_temporary_account_events/);
 assert.match(sql,/school_temporary_account_events/);
 assert.doesNotMatch(sql,/password\s+text|temporary_password\s+text/i);
});
test('principal sees exceptional form without leaking password into browser persistent storage',()=>{
 assert.match(html,/id="school-temp-account-form"/);
 assert.match(ui,/\/api\/school\/accounts\/temporary/);
 assert.match(ui,/tempOutput\.hidden=false/);
 assert.doesNotMatch(ui,/localStorage\.|sessionStorage\./);
 assert.match(ui,/clearTemp/);
});
