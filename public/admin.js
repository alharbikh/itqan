/* Itqan site administration. Server-provided identities and RLS rows only. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const state = { mode: 'expanded', section: 'overview', schools: [], users: [], memberships: [], permissions: [], siteAdmins: [], audit: [], editing: null };
const names = {overview:'لوحة المعلومات',schools:'المدارس',users:'المستخدمون',memberships:'عضويات المدارس',permissions:'الأدوار والصلاحيات',audit:'سجل العمليات',resources:'أدوات مدير الموقع',settings:'إعدادات المنصة'};
const mobile = matchMedia('(max-width:760px)');
function notice(message, type='info') {
  const box = $('message');
  box.textContent = message;
  box.className = 'alert ' + type;
  box.hidden = false;
  box.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function openAccessPage(reason){
  try{sessionStorage.setItem('itqan_access_state',reason);}catch{}
  location.replace('/access');
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
  if (!response.ok) {
    const failure=new Error(payload.error || 'تعذر إتمام الطلب. أعد المحاولة.');
    failure.status=response.status;
    failure.code=payload.code||null;
    failure.field=payload.field||null;
    failure.reference=payload.reference||null;
    throw failure;
  }
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
    const del=document.createElement('button');
    del.type='button';del.className='button admin-danger';del.textContent='حذف';
    del.setAttribute('aria-label','حذف المدرسة '+school.name);
    del.addEventListener('click',()=>deleteSchool(school));
    action.append(del);
    const toggle=document.createElement('button');
    toggle.type='button';toggle.className='button';
    toggle.textContent=school.status==='active'?'تعطيل':'تفعيل';
    toggle.addEventListener('click',()=>changeSchoolStatus(school));
    action.append(toggle);
    action.className='admin-row-actions';
    tr.append(action);
    tbody.append(tr);
  }
}
function populateUsers() {
  const tbody=$('users-body');
  if (!state.users.length) { emptyRow(tbody,4,'لا توجد حسابات متاحة للعرض.');return; }
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
    const actions=document.createElement('td');actions.className='admin-row-actions';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='button';
    toggle.textContent=user.status==='active'?'إيقاف':'تفعيل';
    toggle.addEventListener('click',()=>changeUserStatus(user));
    actions.append(toggle);
    const reset=document.createElement('button');reset.type='button';reset.className='button';reset.textContent='إعادة ضبط الدخول';
    reset.addEventListener('click',()=>openPasswordReset(user));actions.append(reset);tr.append(actions);
    tbody.append(tr);
  }
}
let passwordResetUser=null;
function closePasswordReset(){
  $('password-reset-dialog').close();$('password-reset-form').reset();
  $('password-reset-once').value='';$('password-reset-output').hidden=true;
  $('password-reset-error').hidden=true;passwordResetUser=null;
}
function openPasswordReset(user){
  passwordResetUser=user;
  $('password-reset-form').reset();$('password-reset-error').hidden=true;
  $('password-reset-output').hidden=true;$('password-reset-once').value='';
  $('password-reset-submit').hidden=false;
  $('password-reset-user-name').textContent='الحساب: '+(user.full_name||user.id);
  $('password-reset-dialog').showModal();$('password-reset-reason').focus();
}
async function submitPasswordReset(e){
  e.preventDefault();
  if(!passwordResetUser)return;
  const button=$('password-reset-submit');button.disabled=true;
  $('password-reset-error').hidden=true;
  try{
    const result=await api('/api/admin/users/password','POST',{
      user_id:passwordResetUser.id,reason:$('password-reset-reason').value.trim()});
    $('password-reset-once').value=result.temporary_password;
    $('password-reset-output').hidden=false;button.hidden=true;
    await loadAudit();
  }catch(error){
    $('password-reset-error').textContent=error.message||'تعذر إعادة الضبط.';
    $('password-reset-error').hidden=false;
  }finally{button.disabled=false;}
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

const roleTitles={site_admin:'مدير الموقع',school_principal:'مدير المدرسة',employee:'موظف'};
const jobTitles={principal:'مدير',teacher:'معلم',vice_principal:'وكيل',counselor:'موجه طلابي',staff:'إداري'};
function displayTime(value){
  try{return new Intl.DateTimeFormat('ar-SA',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}
  catch{return '—';}
}
async function adminAction(action, values, question){
  if(!window.confirm(question))return false;
  try{
    await api('/api/admin/actions','POST',{action,...values});
    await refresh();
    await loadAudit();
    notice('تم تنفيذ العملية وتسجيلها في سجل التدقيق.','success');
    return true;
  }catch(error){
    notice(error.message||'تعذر تنفيذ الإجراء','error');
    return false;
  }
}
function deleteSchool(school){
  return adminAction('school.delete',{school_id:school.id},
    'حذف المدرسة «'+school.name+'» نهائيًا؟ لن يسمح النظام بالحذف إذا وجدت سجلات أو عضويات مرتبطة. لا يمكن التراجع.');
}
function changeSchoolStatus(school){
  const status=school.status==='active'?'inactive':'active';
  return adminAction('school.status',{school_id:school.id,status},
    (status==='inactive'?'تعطيل':'تفعيل')+' المدرسة «'+school.name+'»؟');
}
function changeUserStatus(user){
  const status=user.status==='active'?'disabled':'active';
  return adminAction('user.status',{user_id:user.id,status},
    (status==='inactive'?'إيقاف':'تفعيل')+' حساب «'+(user.full_name||user.id)+'»؟');
}
function fillMembershipOptions(){
  const schoolSelect=$('membership-school'),userSelect=$('membership-user');
  const selectedSchool=schoolSelect.value, selectedUser=userSelect.value;
  schoolSelect.replaceChildren(new Option('اختر المدرسة',''));
  userSelect.replaceChildren(new Option('اختر حسابًا مسجلًا',''));
  for(const school of state.schools.filter(x=>x.status==='active')){
    schoolSelect.add(new Option(school.name,school.id));
  }
  for(const user of state.users.filter(x=>x.status==='active')){
    userSelect.add(new Option(user.full_name||user.id,user.id));
  }
  schoolSelect.value=[...schoolSelect.options].some(x=>x.value===selectedSchool)?selectedSchool:'';
  userSelect.value=[...userSelect.options].some(x=>x.value===selectedUser)?selectedUser:'';
}
function populateMemberships(){
  const tbody=$('memberships-body');
  tbody.replaceChildren();
  if(!state.memberships.length){emptyRow(tbody,6,'لا توجد عضويات مدارس مسجلة.');return;}
  for(const membership of state.memberships){
    const school=state.schools.find(x=>x.id===membership.school_id);
    const user=state.users.find(x=>x.id===membership.user_id);
    const tr=document.createElement('tr');
    tr.append(cell(school?.name||membership.school_id),cell(user?.full_name||membership.user_id),
      cell(roleTitles[membership.access_role]||membership.access_role),
      cell(jobTitles[membership.job_role]||membership.job_role));
    const statusCell=document.createElement('td');
    statusCell.append(status(membership.status));tr.append(statusCell);
    const action=document.createElement('td');
    const edit=document.createElement('button');edit.type='button';edit.className='button';
    edit.textContent='تعديل';edit.addEventListener('click',()=>{
      go('memberships');
      $('membership-school').value=membership.school_id;
      $('membership-user').value=membership.user_id;
      $('membership-role').value=membership.access_role;
      $('membership-job').value=membership.job_role;
      $('membership-status').value=membership.status;
      $('membership-form').scrollIntoView({behavior:'smooth',block:'start'});
    });
    action.append(edit);tr.append(action);tbody.append(tr);
  }
}

function populateSiteAdmins(){
  const select=$('site-role-user');
  const selected=select.value;
  select.replaceChildren(new Option('اختر حسابًا',''));
  for(const user of state.users){
    select.add(new Option(user.full_name||user.id,user.id));
  }
  select.value=[...select.options].some(option=>option.value===selected)?selected:'';
  const list=$('site-admins-list');
  list.replaceChildren();
  if(!state.siteAdmins.length){
    const p=document.createElement('p');p.textContent='لم تظهر بيانات مديري الموقع.';list.append(p);return;
  }
  for(const record of state.siteAdmins){
    const user=state.users.find(x=>x.id===record.user_id);
    const item=document.createElement('div');item.className='admin-mini-item';
    const name=document.createElement('b');name.textContent=user?.full_name||record.user_id;
    const label=document.createElement('small');label.textContent='مدير الموقع';
    item.append(name,label);list.append(item);
  }
}
async function saveSiteRole(event){
  event.preventDefault();
  const user_id=$('site-role-user').value;
  const enabled=$('site-role-enabled').value==='true';
  const user=state.users.find(x=>x.id===user_id);
  if(!user){notice('اختر حسابًا صحيحًا.','error');return;}
  if(enabled){
    const typed=window.prompt('للتأكيد على منح صلاحية مدير الموقع الكاملة، اكتب: مدير الموقع');
    if(typed!=='مدير الموقع')return;
  }
  await adminAction('user.role',{user_id,enabled},
    (enabled?'منح صلاحية مدير الموقع الكاملة إلى ':'سحب صلاحية مدير الموقع من ')+
    '«'+(user.full_name||user.id)+'»؟');
}
function populateRoles(){
  const tbody=$('role-matrix-body');tbody.replaceChildren();
  for(const item of state.permissions){
    const tr=document.createElement('tr');
    tr.append(cell(roleTitles[item.role_code]||item.role_code),cell(item.permission_code));
    tbody.append(tr);
  }
  if(!state.permissions.length)emptyRow(tbody,2,'لا توجد صلاحيات ظاهرة.');
}
async function loadAudit(){
  try{
    const result=await api('/api/admin/audit');
    state.audit=Array.isArray(result.audit)?result.audit:[];
    const tbody=$('audit-body');tbody.replaceChildren();
    if(!state.audit.length){emptyRow(tbody,4,'لا توجد عمليات مسجلة بعد.');return;}
    const labels={'school.create':'إنشاء مدرسة','school.update':'تعديل مدرسة','school.delete':'حذف مدرسة','school.status':'تعديل حالة مدرسة',
      'membership.upsert':'تحديث عضوية','user.status':'تعديل حالة حساب',
      'user.role.grant':'منح مدير الموقع','user.role.revoke':'سحب مدير الموقع',
      'user.password.temporary':'إنشاء كلمة مرور مؤقتة'};
    for(const item of state.audit){
      const tr=document.createElement('tr');
      const actor=state.users.find(x=>x.id===item.actor_user_id);
      tr.append(cell(labels[item.operation]||item.operation),cell(item.target_type+' · '+item.target_id),
        cell(actor?.full_name||item.actor_user_id),cell(displayTime(item.created_at)));
      tbody.append(tr);
    }
  }catch{notice('تعذر تحميل سجل التدقيق.','error');}
}
async function saveMembership(event){
  event.preventDefault();
  const access_role=$('membership-role').value;
  const job_role=$('membership-job').value;
  const school_id=$('membership-school').value;
  const user_id=$('membership-user').value;
  const membershipStatus=$('membership-status').value;
  if(access_role==='school_principal'&&job_role!=='principal'){
    notice('يجب اختيار عمل «مدير» عند منح صلاحية مدير المدرسة.','error');return;
  }
  const school=state.schools.find(x=>x.id===school_id);
  const user=state.users.find(x=>x.id===user_id);
  await adminAction('membership.upsert',{school_id,user_id,access_role,job_role,status:membershipStatus},
    'اعتماد عضوية «'+(user?.full_name||user_id)+'» في «'+(school?.name||school_id)+'» بصلاحية '+(roleTitles[access_role]||access_role)+'؟');
}

async function refresh() {
  try {
    const [schools,users,memberships,roles,siteAdmins]=await Promise.all([
      api('/api/admin/schools'),api('/api/admin/users'),
      api('/api/admin/memberships'),api('/api/admin/roles'),api('/api/admin/site-admins'),
    ]);
    state.schools=Array.isArray(schools.schools)?schools.schools:[];
    state.users=Array.isArray(users.users)?users.users:[];
    state.memberships=Array.isArray(memberships.memberships)?memberships.memberships:[];
    state.permissions=Array.isArray(roles.permissions)?roles.permissions:[];
    state.siteAdmins=Array.isArray(siteAdmins.site_admins)?siteAdmins.site_admins:[];
    populateSchools();populateUsers();populateOverview();
    fillMembershipOptions();populateMemberships();populateRoles();populateSiteAdmins();
  } catch (error) {
    $('stat-connection').textContent='تعذر الاتصال';
    if(error.status===401||error.status===403){
      openAccessPage(error.status===401?'login':'forbidden');
      return;
    }
    notice('تعذر تحميل بيانات الإدارة: '+error.message,'error');
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
  for(const el of $('school-form').querySelectorAll('[aria-invalid]'))el.removeAttribute('aria-invalid');
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
  } catch (error) {
    $('school-form-error').hidden=false;
    $('school-form-error').textContent=error.message+(error.reference?' (رمز: '+error.reference+')':'');
    const fields={name:'school-name',ministry_number:'school-ministry',
      gender:'school-gender',education_stage:'school-stage',education_department:'school-department'};
    const invalid=fields[error.field]&&$(fields[error.field]);
    if(invalid){invalid.setAttribute('aria-invalid','true');invalid.focus();}
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
  $('membership-form').addEventListener('submit',saveMembership);
  $('site-role-form').addEventListener('submit',saveSiteRole);
  $('refresh-audit').addEventListener('click',loadAudit);
  $('password-reset-form').addEventListener('submit',submitPasswordReset);
  $('password-reset-close').addEventListener('click',closePasswordReset);
  $('password-reset-cancel').addEventListener('click',closePasswordReset);
  $('password-reset-dialog').addEventListener('close',()=>{
    $('password-reset-once').value='';$('password-reset-output').hidden=true;passwordResetUser=null;
  });
  $('password-reset-copy').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText($('password-reset-once').value);
      notice('تم النسخ. شارك كلمة المرور عبر قناة آمنة فقط.','success');
    }catch{$('password-reset-once').select();notice('حدد كلمة المرور وانسخها يدويًا.','info');}
  });
  $('membership-role').addEventListener('change',()=>{
    if($('membership-role').value==='school_principal')$('membership-job').value='principal';
  });
  $('logout').addEventListener('click',async()=>{
    try {await api('/api/logout','POST',{});} finally {location.replace('/login.html');}
  });
  navRender();
  try {
    const {user}=await api('/api/session');
    if (user.role!=='site_admin') {openAccessPage('forbidden');return;}
    $('top-user-name').textContent=user.name||'مدير الموقع';
    await refresh();
    await loadAudit();
  } catch (error) {
    if(error.status===401||error.status===403){
      openAccessPage(error.status===401?'login':'forbidden');
      return;
    }
    notice('تعذر التحقق من حساب مدير الموقع: '+(error.message||'اتصال الخدمة غير متاح')+'.','error');
  }
}
document.addEventListener('DOMContentLoaded',start);
})();