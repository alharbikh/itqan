(()=>{'use strict';
const $=id=>document.getElementById(id);
const state={user:null,schools:[],school:null,years:[],jobs:[],criteria:[],frameworks:[],stages:[],evidence:[]};
function msg(value,type='info'){$('message').hidden=false;$('message').textContent=value;$('message').className='alert '+type;}
async function api(path,method='GET',body){
 const res=await fetch(path,{method,credentials:'same-origin',...(body===undefined?{}:{
  headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(data.error||'تعذر إتمام العملية');
 return data;
}
function item(parent,...texts){const e=document.createElement('div');e.className='perf-item';
 for(const t of texts){const d=document.createElement('span');d.textContent=String(t??'—');e.append(d);}
 parent.append(e);return e;}
function option(select,value,text){const o=document.createElement('option');o.value=value;o.textContent=text;select.add(o);}
function principal(){return state.user?.role==='site_admin'||
  state.user?.schoolMemberships?.some(m=>m.school_id===state.school&&m.access_role==='school_principal');}
function selectedYear(){return $('year').value;}
function currentSchool(){return $('school').value;}
function bindForm(id,callback){$(id).addEventListener('submit',async e=>{
 e.preventDefault();const button=e.target.querySelector('button[type=submit]');if(button)button.disabled=true;
 try{await callback();msg('حُفظ الإجراء بنجاح','success');await refresh();}
 catch(err){msg(err.message,'error');}finally{if(button)button.disabled=false;}
});}
async function refresh(){
 state.school=currentSchool();
 const year=selectedYear();
 for(const p of document.querySelectorAll('.principal-panel'))p.hidden=!principal();
 $('role').textContent=principal()?'مدير المدرسة':'موظف';
 const evidence=await api('/api/evidence/personal');
 state.evidence=Array.isArray(evidence.evidence)?evidence.evidence:[];
 const listing=$('evidence-list');listing.replaceChildren();
 const select=$('link-evidence');select.replaceChildren();option(select,'','اختر الشاهد');
 for(const e of state.evidence){
  option(select,e.id,e.title);
  const box=item(listing,e.title,e.description||'شاهد دون وصف');
  if(e.link_url&&/^https:\/\//.test(e.link_url)){
   const a=document.createElement('a');a.href=e.link_url;a.target='_blank';a.rel='noopener noreferrer';
   a.textContent='فتح الرابط';box.append(a);
  }
 }
 if(!state.evidence.length)item(listing,'لا توجد شواهد شخصية محفوظة بعد.');
 const list=$('framework-list');list.replaceChildren();
 for(const f of state.frameworks){
  const box=item(list,f.title_ar+' — الإصدار '+f.version_no,f.source_reference||'إطار منشور');
  const a=document.createElement('button');a.type='button';a.textContent='استعراض العناصر والتفسيرات';
  a.onclick=()=>showCriteria(f.id,box);box.append(a);
 }
 if(!state.frameworks.length)item(list,'لم ينشر مدير الموقع إطار تقييم بعد.');
 const stages=$('stage-list');stages.replaceChildren();
 for(const st of state.stages.filter(x=>!year||x.academic_year_id===year)){
  const label={planning:'التخطيط',midyear:'المراجعة النصفية',final:'الختامي'}[st.stage]||st.stage;
  item(stages,label,'الموعد الافتراضي: '+st.starts_on+' — '+st.ends_on);
 }
 if(!stages.children.length)item(stages,'لم تُضبط مواعيد دورة الأداء بعد.');
 if(!state.school)return;
 const feedback=await api('/api/school/midyear-feedback?school_id='+encodeURIComponent(state.school));
 const fb=$('midyear-list');fb.replaceChildren();
 for(const f of feedback.feedback||[]){
  const box=item(fb,'الموظف: '+f.subject_user_id,'الحالة: '+f.status,
    'جوانب القوة: '+(f.strengths||'—'),'التحسين: '+(f.improvements||'—'),'الإجراءات: '+(f.development_actions||'—'));
  if(f.subject_user_id===state.user.id&&f.status==='published'){
   const b=document.createElement('button');b.textContent='إقرار الاطلاع';b.type='button';
   b.onclick=async()=>{try{await api('/api/school/midyear-ack','POST',{feedback_id:f.id});msg('تم توثيق الاطلاع','success');await refresh();}catch(err){msg(err.message,'error');}};
   box.append(b);
  }
 }
 if(!fb.children.length)item(fb,'لا توجد مراجعات نصفية متاحة لهذا الحساب.');
 if(principal()){
  const [p,requests]=await Promise.all([
   api('/api/school/personnel?school_id='+encodeURIComponent(state.school)),
   api('/api/school/link-requests?school_id='+encodeURIComponent(state.school))]);
  const people=$('personnel-list');people.replaceChildren();
  for(const person of p.personnel||[]){
   const box=item(people,person.employee_name,person.placement_status,
    'معرف الملف: '+person.school_employee_id,person.linked_user_id?
    'الحساب: '+person.linked_user_id:'غير مرتبط بحساب');
   const copy=document.createElement('button');copy.type='button';copy.textContent='نسخ معرف الملف';
   copy.onclick=async()=>{try{await navigator.clipboard.writeText(person.school_employee_id);msg('نُسخ معرف الملف','success');}
     catch{msg('حدد المعرّف وانسخه يدويًا','info');}};box.append(copy);
  }
  if(!people.children.length)item(people,'لا توجد ملفات وظيفية في هذه المدرسة.');
  const req=$('link-request-list');req.replaceChildren();
  for(const r of requests.requests||[]){
   const box=item(req,'الحساب: '+r.user_id,'الملف: '+r.school_employee_id,'الحالة: '+r.status);
   if(r.status==='pending'){
    const role=document.createElement('select');
    for(const [value,label] of [['teacher','معلم'],['vice_principal','وكيل'],['counselor','موجه'],['staff','إداري']])option(role,value,label);
    box.append(role);
    for(const [yes,label] of [[true,'اعتماد الربط'],[false,'رفض الطلب']]){
     const btn=document.createElement('button');btn.type='button';btn.textContent=label;
     btn.onclick=async()=>{if(!confirm('هل تريد '+label+'؟'))return;
      try{await api('/api/school/link-decision','POST',{school_id:state.school,request_id:r.id,
       approve:yes,job_role:role.value,note:'قرار موثق بواسطة مدير المدرسة'});
       msg('حُفظ قرار الربط','success');await refresh();}catch(err){msg(err.message,'error');}};
     box.append(btn);
    }
   }
  }
  if(!req.children.length)item(req,'لا توجد طلبات ربط.');
 }
}
async function showCriteria(frameworkId,box){
 try{const r=await api('/api/framework-details?framework_id='+encodeURIComponent(frameworkId));
  const panel=document.createElement('div');panel.className='perf-list';
  for(const x of r.criteria||[]){const row=item(panel,x.title_ar+' — وزن '+x.weight+'%',x.interpretation||'لا يوجد تفسير مضاف');
    if(x.descriptors?.length)item(row,...x.descriptors.map(d=>'المستوى '+d.score_level+': '+d.descriptor));}
  box.append(panel);
 }catch(err){msg(err.message,'error');}
}
async function init(){
 try{
  const [s,c,schools]=await Promise.all([api('/api/session'),api('/api/catalog'),api('/api/schools')]);
  state.user=s.user;state.years=c.years||[];state.jobs=c.jobs||[];
  state.criteria=c.criteria||[];state.frameworks=c.frameworks||[];state.stages=c.stages||[];
  state.schools=schools.schools||[];
  const sch=$('school');sch.replaceChildren();
  for(const school of state.schools)option(sch,school.id,school.name);
  if(!state.schools.length){msg('لا توجد عضوية نشطة. افتح صفحة طلب الربط.','info');return;}
  state.school=state.schools[0].id;
  const years=$('year');years.replaceChildren();option(years,'','اختر العام الدراسي');
  for(const y of state.years)option(years,y.id,y.label);
  const current=state.years.find(y=>y.is_current)||state.years[0];
  if(current)years.value=current.id;
  const jobs=$('personnel-job');for(const j of state.jobs)option(jobs,j.id,j.title_ar);
  const frameworks=$('framework');frameworks.replaceChildren();option(frameworks,'','اختر الإطار المنشور');
  for(const f of state.frameworks)option(frameworks,f.id,f.title_ar+' (v'+f.version_no+')');
  const crit=$('link-criterion');crit.replaceChildren();option(crit,'','اختر المعيار');
  for(const x of state.criteria)option(crit,x.id,x.title_ar);
  await refresh();
 }catch(err){msg(err.message,'error');}
}
$('refresh').onclick=async()=>{try{await refresh();msg('تم تحديث البيانات','success');}catch(e){msg(e.message,'error');}};
$('school').onchange=()=>refresh().catch(e=>msg(e.message,'error'));
$('year').onchange=()=>refresh().catch(e=>msg(e.message,'error'));
bindForm('framework-ack',async()=>api('/api/school/framework-ack','POST',
 {school_id:state.school,framework_id:$('framework').value}));
bindForm('evidence-form',async()=>{await api('/api/evidence/personal','POST',
 {title:$('evidence-title').value,description:$('evidence-description').value,
 link_url:$('evidence-url').value});$('evidence-form').reset();});
$('link-save').onclick=async()=>{try{await api('/api/evidence/criterion-link','POST',
 {evidence_id:$('link-evidence').value,criterion_id:$('link-criterion').value});
 msg('تم ربط الشاهد','success');}catch(e){msg(e.message,'error');}};
bindForm('personnel-form',async()=>{
 if(!selectedYear())throw Error('اختر العام الدراسي أولًا');
 const data=await api('/api/school/personnel','POST',
 {school_id:state.school,year_id:selectedYear(),full_name:$('personnel-name').value,
 national_id:$('personnel-national').value||null,job_title_id:$('personnel-job').value||null});
 $('personnel-created').hidden=false;
 $('personnel-created').textContent='معرف الملف الجديد لإرساله للموظف: '+data.result;
 $('personnel-form').reset();
});
bindForm('unlink-form',async()=>{if(!confirm('سيتم إنهاء صلاحية الموظف بهذه المدرسة، مع حفظ السجل التاريخي. هل تؤكد؟'))return;
 await api('/api/school/unlink','POST',{school_id:state.school,user_id:$('unlink-user').value,
 reason:$('unlink-reason').value});$('unlink-form').reset();});
bindForm('stage-form',async()=>{if(!selectedYear())throw Error('اختر العام الدراسي أولًا');
 await api('/api/school/stage-window','POST',{school_id:state.school,year_id:selectedYear(),
 stage:$('stage-kind').value,starts_on:$('stage-start').value,ends_on:$('stage-end').value,reason:$('stage-reason').value});});
bindForm('midyear-form',async()=>{if(!selectedYear())throw Error('اختر العام الدراسي أولًا');
 await api('/api/school/midyear-feedback','POST',{school_id:state.school,year_id:selectedYear(),
 subject_user_id:$('midyear-subject').value,strengths:$('midyear-strengths').value,
 improvements:$('midyear-improvements').value,development_actions:$('midyear-actions').value});
 $('midyear-form').reset();});
bindForm('delegate-form',async()=>{await api('/api/school/review-delegations','POST',
 {action:'grant',school_id:state.school,delegate_user_id:$('delegate-user').value,
 subject_user_id:$('delegate-subject').value,scope:$('delegate-scope').value,
 expires_at:new Date($('delegate-expiry').value).toISOString()});$('delegate-form').reset();});
document.addEventListener('DOMContentLoaded',init);
})();