import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const js=readFileSync(new URL('../public/school.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/school.html',import.meta.url),'utf8');
const styles=readFileSync(new URL('../public/school.css',import.meta.url),'utf8');
const admin=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');

test('school services navigate to already implemented workflows instead of future placeholders',()=>{
  assert.match(js,/href:'\/performance\.html'/);
  assert.match(js,/href:'\/link\.html'/);
  assert.match(js,/section:'members'/);
  assert.match(js,/card\.addEventListener\('click',\(\)=>navigate\(service\.section\)\)/);
  assert.doesNotMatch(js,/القسم قيد التجهيز — لا توجد عملية كتابة مفعلة/);
  assert.match(js,/principal\?\[/);
  assert.match(js,/container\.replaceChildren\(\)/);
});

test('school service navigation remains keyboard accessible and visual copy reflects availability',()=>{
  assert.match(styles,/a\.school-service:focus-visible/);
  assert.match(styles,/button\.school-service:focus-visible/);
  assert.match(html,/تُعرض الخدمات المتاحة لحسابك بحسب صلاحياتك المدرسية/);
  assert.doesNotMatch(admin,/منح الأدوار والعضويات سيُفعّل/);
});

test('service page targets are served through the protected Worker route gate',()=>{
  const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
  assert.match(worker,/PROTECTED_ROUTES\s*=\s*\/\^\\\/\(admin\|frameworks\|school\|performance\|link\)/);
  assert.match(worker,/if\(target\)/);
  assert.match(worker,/session\(request,env,true\)/);
});
