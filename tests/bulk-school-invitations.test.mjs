import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../public/school.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../public/school-invitations.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');

test('only the manager invitation pane offers bulk CSV preview and explicit confirmation',()=>{
 assert.match(page,/data-personnel-panel="invitations"/);
 for(const id of ['school-invite-bulk-file','school-invite-bulk-preview','school-invite-bulk-create'])
  assert.ok(page.includes('id="'+id+'"'));
 assert.match(script,/askBulk\(prepared\.entries\.length\)/);
 assert.match(script,/schoolPicker\.value/);
});
test('bulk invitation parser uses constrained CSV and known approved profiles',()=>{
 assert.match(script,/import\('\/personnel-import-csv\.js'\)/);
 assert.match(script,/maxRows:500/);
 assert.match(script,/records\.length>101/);
 assert.match(script,/staffIndex\.get\(row\.number\)/);
 assert.match(script,/ids\.has\(id\)/);
 assert.match(script,/\['school','personal'\]/);
});
test('bulk invitations do not create accounts or memberships and require manager API',()=>{
 assert.match(script,/\/api\/school\/invitations/);
 assert.doesNotMatch(script,/\/auth\/v1\//);
 assert.match(worker,/itqan_school_invitation_create/);
 assert.match(script,/لم تُرسل رسائل بريد آليًا/);
});
