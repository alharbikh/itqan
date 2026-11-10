/* School-only dashboard: no browser data persistence, all data comes from authenticated Cloudflare APIs. */
(() => {
'use strict';
const $=id=>document.getElementById(id);
const titles={overview:'لوحة المدرسة',membership:'مدارسي وصلاحياتي',members:'منسوبو المدرسة',services:'خدمات المدرسة'};
const roleNames={site_admin:'مدير الموقع',school_principal:'مدير المدرسة',employee:'موظف'};
const jobNames={principal:'مدير',teacher:'معلم',vice_principal:'وكيل',counselor:'موجه طلابي',staff:'إداري'};
const state={user:null,schools:[],selected:null,mode:'expanded',section:'overview'};
const mobile=matchMedia('(max-width:760px)');
async function api(path,method='GET',body){
  const response=await fetch(path,{method,credentials:'same-origin',
    ...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
  let payload={};
  try{payload=await response.json();}catch{}
  if(!response.ok)throw Error(payload.error||'Unable to load school data');
  return payload;
}
function notice(message){const el=$('message');el.hidden=false;el.className='alert error';el.textContent=message;}
function navRender(){
  for(const mode of ['expanded','icons','hidden'])document.body.classList.toggle('nav-'+mode,state.mode===mode);
  const opened=document.body.classList.contains('nav-mobile-open');
  $('admin-scrim').hidden=!opened;
  $('nav-toggle').setAttribute('aria-expanded',String(mobile.matches?opened:state.mode!=='hidden'));
}
function toggleNav(){
  if(mobile.matches)document.body.classList.toggle('nav-mobile-open');
  else state.mode={expanded:'icons',icons:'hidden',hidden:'expanded'}[state.mode];
  navRender();
}
function membershipFor(schoolId){
  return state.user?.schoolMemberships?.find(m=>m.school_id===schoolId)||null;
}
function maySeeMembers(){
  const m=membershipFor(state.selected);
  return state.user?.role==='site_admin'||m?.access_role==='school_principal';
}
function schoolById(id){return state.schools.find(s=>s.id===id);}
function navigate(section){
  if(!titles[section])return;
  if(section==='members'&&!maySeeMembers())return;
  state.section=section;
  for(const name of Object.keys(titles))$('section-'+name).hidden=name!==section;
  for(const button of document.querySelectorAll('.admin-menu-item')){
    const on=button.dataset.section===section;
    button.classList.toggle('is-active',on);
    if(on)button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  }
  $('top-current-page').textContent=titles[section];
  document.body.classList.remove('nav-mobile-open');
  navRender();
  if(section==='members')loadMembers();
}
function makeText(tag,value,className){
  const e=document.createElement(tag);e.textContent=String(value??'—');if(className)e.className=className;return e;
}
function populateMemberships(){
  const list=$('membership-list');list.replaceChildren();
  const granted=state.schools;
  for(const school of granted){
    const member=membershipFor(school.id);
    const item=makeText('div','', 'admin-mini-item');
    const schoolName=makeText('b',school.name);
    const label=makeText('small',state.user.role==='site_admin'?'مدير الموقع':(
      roleNames[member?.access_role]||'عضوية مدرسية'));
    item.replaceChildren(schoolName,label);
    list.append(item);
  }
  if(!granted.length)list.append(makeText('p','لا توجد مدارس مصرح بها للحساب.'));
}
function populateServices(){
  const container=$('service-list');container.replaceChildren();
  const principal=maySeeMembers();
  const labels=principal?
    ['إدارة منسوبي المدرسة','متابعة ملفات الإنجاز','تقييم الأداء الوظيفي','إسناد الشواهد']:
    ['ملف الإنجاز المهني','الشواهد المهنية','التقييم الذاتي','نتيجة التقييم المنشورة'];
  for(const label of labels){
    const card=makeText('div','', 'school-service');
    card.append(makeText('strong',label),makeText('small','القسم قيد التجهيز — لا توجد عملية كتابة مفعلة'));
    container.append(card);
  }
}
function displaySchool(){
  const chosen=schoolById(state.selected);
  if(!chosen)return;
  const member=membershipFor(chosen.id);
  const role=state.user.role==='site_admin'?'site_admin':member?.access_role||'employee';
  $('stat-role').textContent=roleNames[role]||role;
  $('stat-job').textContent=state.user.role==='site_admin'?'إدارة الموقع':jobNames[member?.job_role]||'غير محدد';
  $('top-school-role').textContent=roleNames[role]||role;
  $('membership-badge').textContent=roleNames[role]||role;
  $('current-school-title').textContent=chosen.name;
  $('current-school-description').textContent=chosen.education_department?
    'الإدارة التعليمية: '+chosen.education_department:'لم تُحدَّد إدارة تعليمية لهذه المدرسة.';
  for(const b of document.querySelectorAll('.principal-only'))b.hidden=!maySeeMembers();
  if(state.section==='members'&&!maySeeMembers())navigate('overview');
  populateServices();
  if(state.section==='members')loadMembers();
}
function renderMembers(rows){
  const tbody=$('members-body');tbody.replaceChildren();
  if(!rows.length){
    const tr=document.createElement('tr'),td=makeText('td','لا توجد عضويات متاحة للعرض.','empty-row');
    td.colSpan=4;tr.append(td);tbody.append(tr);return;
  }
  for(const m of rows){
    const tr=document.createElement('tr');
    tr.append(makeText('td',m.full_name||m.user_id),
      makeText('td',roleNames[m.access_role]||m.access_role),
      makeText('td',jobNames[m.job_role]||'غير محدد'),
      makeText('td',m.status==='active'?'نشط':'غير نشط'));
    tbody.append(tr);
  }
}
async function loadMembers(){
  if(!maySeeMembers())return;
  const select=state.selected;
  if(window.itqanPersonnelAdmin)void window.itqanPersonnelAdmin.load(select);
  const tbody=$('members-body');tbody.replaceChildren();
  const tr=document.createElement('tr'),td=makeText('td','جارٍ تحميل العضويات…','empty-row');
  td.colSpan=4;tr.append(td);tbody.append(tr);
  try {
    const result=await api('/api/school/members?school_id='+encodeURIComponent(select));
    if(state.selected===select)renderMembers(Array.isArray(result.members)?result.members:[]);
  }catch{if(state.selected===select)notice('تعذر عرض منسوبي المدرسة. تحقق من صلاحية مدير المدرسة.');}
}
async function initialize(){
  $('nav-toggle').addEventListener('click',toggleNav);
  $('admin-scrim').addEventListener('click',()=>{document.body.classList.remove('nav-mobile-open');navRender();});
  for(const button of document.querySelectorAll('.admin-menu-item')){
    button.addEventListener('click',()=>navigate(button.dataset.section));
  }
  $('school-picker').addEventListener('change',()=>{
    state.selected=$('school-picker').value;
    displaySchool();
  });
  $('refresh-members').addEventListener('click',loadMembers);
  $('logout').addEventListener('click',async()=>{
    try{await api('/api/logout','POST',{});}finally{location.replace('/login.html');}
  });
  mobile.addEventListener('change',()=>{document.body.classList.remove('nav-mobile-open');navRender();});
  navRender();
  try{
    const [session,schools]=await Promise.all([api('/api/session'),api('/api/schools')]);
    state.user=session.user;
    if(!state.user){notice('لا توجد جلسة صالحة.');return;}
    $('top-user-name').textContent=state.user.name||'مستخدم';
    const granted=new Set((state.user.schoolMemberships||[]).map(m=>m.school_id));
    state.schools=(Array.isArray(schools.schools)?schools.schools:[])
      .filter(s=>state.user.role==='site_admin'||granted.has(s.id));
    if(!state.schools.length){notice('لم تُعتمد عضوية في مدرسة نشطة لهذا الحساب.');return;}
    const picker=$('school-picker');picker.replaceChildren();
    for(const school of state.schools)picker.add(new Option(school.name,school.id));
    state.selected=state.schools[0].id;
    $('stat-schools').textContent=state.schools.length;
    $('stat-connection').textContent='متصل';
    populateMemberships();
    displaySchool();
  }catch{notice('تعذر التحقق من الجلسة أو قراءة المدارس المصرح بها.');}
}
document.addEventListener('DOMContentLoaded',initialize);
})();
