/* Itqan site administration. Server-provided identities and RLS rows only. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const state = { mode: 'expanded', section: 'overview', schools: [], users: [], editing: null };
const names = {overview:'لوحة المعلومات',schools:'المدارس',users:'المستخدمون',permissions:'الأدوار والصلاحيات',settings:'إعدادات المنصة'};
const mobile = matchMedia('(max-width:760px)');
function notice(message, type='info') {
  const box = $('message');
  box.textContent = message;
  box.className = 'alert ' + type;
  box.hidden = false;
  box.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function clearNotice() { $('message').hidden=true; }
async function api(path, method='GET', body) {
  const response = await fetch(path, {
    method,
    credentials:'same-origin',
    ...(body === undefined ? {} : {
      headers: {'content-type':'application/json'},
      body:JSON.stringify(body),
    }),
  });
  let payload;
  try { payload = await response.json(); } catch { payload={}; }
  if (!response.ok) throw Error(payload.error || 'Request failed');
  return payload;
}
function navRender() {
  const body=document.body;
  for (const mode of ['expanded','icons','hidden']) body.classList.toggle('nav-'+mode, state.mode===mode);
  const opened=body.classList.contains('nav-mobile-open');
  $('admin-scrim').hidden=!opened;
  $('nav-toggle').setAttribute('aria-expanded', String(mobile.matches ? opened : state.mode!=='hidden'));
  $('nav-toggle').title=mobile.matches ? (opened ? 'إغلاق القائمة' : 'فتح القائمة') : ({
    expanded:'القائمة كاملة — التبديل إلى أيقونات',icons:'أيقونات فقط — إخفاء القائمة',hidden:'القائمة مخفية — إظهارها كاملة',
  })[state.mode];
}
function cycleNav() {
  if (mobile.matches) document.body.classList.toggle('nav-mobile-open');
  else state.mode={expanded:'icons',icons:'hidden',hidden:'expanded'}[state.mode];
  navRender();
}
function go(section) {
  if (!names[section]) return;
  state.section=section;
  for (const [key] of Object.entries(names)) {
    const panel=$('section-'+key);
    panel.hidden=key!==section;
    panel.classList.toggle('is-current',key===section);
  }
  for (const button of document.querySelectorAll('.admin-menu-item')) {
    const active=button.dataset.section===section;
    button.classList.toggle('is-active',active);
    if (active) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  }
  $('top-current-page').textContent=names[section];
  document.body.classList.remove('nav-mobile-open');
  navRender();
  clearNotice();
}
function cell(text, className) {
  const el=document.createElement('td');
  el.textContent=String(text ?? '—');
  if (className) el.className=className;
  return el;
}
function status(value) {
  const span=document.createElement('span');
  span.className='status-pill'+(value==='active'?'':' inactive');
  span.textContent=value==='active'?'نشط':'غير نشط';
  return span;
}
function emptyRow(tbody,count,message) {
  tbody.replaceChildren();
  const tr=document.createElement('tr');
  const td=cell(message,'empty-row');
  td.colSpan=count;
  tr.append(td);
  tbody.append(tr);
}
function populateSchools() {
  const tbody=$('schools-body');
  const query=$('schools-search').value.trim().toLocaleLowerCase('ar');
  const rows=state.schools.filter(s=>(s.name||'').toLocaleLowerCase('ar').includes(query) ||
    String(s.ministry_number||'').includes(query));
  $('schools-count').textContent=rows.length+' مدرسة';
  if (!rows.length) { emptyRow(tbody,6,query?'لا توجد مدارس تطابق البحث.':'لا توجد مدارس مسجلة بعد.');return; }
  tbody.replaceChildren();
  for (const school of rows) {
    const tr=document.createElement('tr');
    tr.append(cell(school.name),cell(school.ministry_number),cell(school.education_stage),
      cell(school.education_department));
    const stateCell=document.createElement('td');
    stateCell.append(status(school.status));
    tr.append(stateCell);
    const action=document.createElement('td');
    const btn=document.createElement('button');
    btn.type='button';btn.className='button';btn.textContent='تعديل';
    btn.setAttribute('aria-label','تعديل بيانات '+school.name);
    btn.addEventListener('click',()=>openSchool(school));
    action.append(btn);
    tr.append(action);
    tbody.append(tr);
  }
}
function populateUsers() {
  const tbody=$('users-body');
  if (!state.users.length) { emptyRow(tbody,3,'لا توجد حسابات متاحة للعرض.');return; }
  tbody.replaceChildren();
  for (const user of state.users) {
    const tr=document.createElement('tr');
    tr.append(cell(user.full_name||'بدون اسم'));
    const c=document.createElement('td');c.append(status(user.status));tr.append(c);
    let date='—';
    if (user.created_at) {
      try { date=new Intl.DateTimeFormat('ar-SA',{dateStyle:'medium'}).format(new Date(user.created_at)); } catch {}
    }
    tr.append(cell(date));
    tbody.append(tr);
  }
}
function populateOverview() {
  $('stat-schools').textContent=state.schools.length;
  $('stat-active').textContent=state.schools.filter(x=>x.status==='active').length;
  $('stat-users').textContent=state.users.length;
  $('stat-connection').textContent='متصل';
  const list=$('overview-schools');
  list.replaceChildren();
  if (!state.schools.length) {
    const p=document.createElement('p');p.textContent='لا توجد مدارس بعد. استخدم قسم المدارس لإضافة أول مدرسة.';list.append(p);
    return;
  }
  for(const school of state.schools.slice(0,5)) {
    const item=document.createElement('div');item.className='admin-mini-item';
    const name=document.createElement('b');name.textContent=school.name;
    const meta=document.createElement('small');meta.textContent=school.education_stage||'المرحلة غير محددة';
    item.append(name,meta);list.append(item);
  }
}
async function refresh() {
  try {
    const [schools,users]=await Promise.all([
      api('/api/admin/schools'),api('/api/admin/users'),
    ]);
    state.schools=Array.isArray(schools.schools)?schools.schools:[];
    state.users=Array.isArray(users.users)?users.users:[];
    populateSchools();populateUsers();populateOverview();
  } catch {
    $('stat-connection').textContent='تعذر الاتصال';
    notice('تعذر تحميل بيانات الإدارة من Supabase. تحقق من الجلسة أو الصلاحيات.','error');
  }
}
function openSchool(school=null) {
  state.editing=school?.id||null;
  $('school-dialog-heading').textContent=school?'تعديل مدرسة':'إضافة مدرسة';
  $('school-form').reset();
  $('school-name').value=school?.name||'';
  $('school-ministry').value=school?.ministry_number||'';
  $('school-stage').value=school?.education_stage||'';
  $('school-gender').value=school?.gender||'';
  $('school-department').value=school?.education_department||'';
  $('school-form-error').hidden=true;
  $('school-dialog').showModal();
  $('school-name').focus();
}
async function saveSchool(event) {
  event.preventDefault();
  const btn=$('save-school');
  const data={
    name:$('school-name').value.trim(),
    ministry_number:$('school-ministry').value.trim(),
    education_stage:$('school-stage').value,
    gender:$('school-gender').value,
    education_department:$('school-department').value.trim(),
  };
  if (data.name.length<2) {
    $('school-form-error').hidden=false;
    $('school-form-error').textContent='اسم المدرسة مطلوب ويجب ألا يقل عن حرفين.';
    return;
  }
  btn.disabled=true;
  try {
    const editing=Boolean(state.editing);
    await api(editing?'/api/admin/schools/'+encodeURIComponent(state.editing):'/api/admin/schools',
      editing?'PATCH':'POST',data);
    $('school-dialog').close();
    await refresh();
    go('schools');
    notice(editing?'تم تحديث بيانات المدرسة بنجاح.':'تم تسجيل المدرسة في Supabase بنجاح.','success');
  } catch {
    $('school-form-error').hidden=false;
    $('school-form-error').textContent='لم يتم حفظ المدرسة. تحقق من الحقول والرقم الوزاري أو صلاحيات الحساب.';
  } finally {btn.disabled=false;}
}
async function start() {
  $('nav-toggle').addEventListener('click',cycleNav);
  $('settings-cycle-nav').addEventListener('click',cycleNav);
  $('admin-scrim').addEventListener('click',()=>{document.body.classList.remove('nav-mobile-open');navRender();});
  for (const button of document.querySelectorAll('.admin-menu-item')) {
    button.addEventListener('click',()=>go(button.dataset.section));
  }
  for (const button of document.querySelectorAll('[data-go]')) {
    button.addEventListener('click',()=>go(button.dataset.go));
  }
  mobile.addEventListener('change',()=>{document.body.classList.remove('nav-mobile-open');navRender();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape' && document.body.classList.contains('nav-mobile-open')){
    document.body.classList.remove('nav-mobile-open');navRender();
  }});
  $('refresh-overview').addEventListener('click',refresh);
  $('schools-search').addEventListener('input',populateSchools);
  $('add-school').addEventListener('click',()=>openSchool());
  $('close-school').addEventListener('click',()=>$('school-dialog').close());
  $('cancel-school').addEventListener('click',()=>$('school-dialog').close());
  $('school-form').addEventListener('submit',saveSchool);
  $('logout').addEventListener('click',async()=>{
    try {await api('/api/logout','POST',{});} finally {location.replace('/login.html');}
  });
  navRender();
  try {
    const {user}=await api('/api/session');
    if (user.role!=='site_admin') {notice('لا تملك صلاحية مدير الموقع.','error');return;}
    $('top-user-name').textContent=user.name||'مدير الموقع';
    await refresh();
  } catch {notice('تعذر التحقق من جلسة مدير الموقع. أعد تسجيل الدخول.','error');}
}
document.addEventListener('DOMContentLoaded',start);
})();