/* Principal-only personnel management. State is never persisted in browser storage. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const state={school:null,requests:[],profiles:[],years:[],jobs:[],tab:'profiles'};
const statusNames={draft:'مسودة',pending:'بانتظار المراجعة',under_review:'قيد المراجعة',
 changes_requested:'مطلوب استكمال',approved:'معتمد',rejected:'مرفوض',cancelled:'ملغى'};
async function api(path,method='GET',body){
 const response=await fetch(path,{method,credentials:'same-origin',
  ...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||'تعذر تنفيذ الطلب');
 return Object.prototype.hasOwnProperty.call(result,'result')?result.result:result;
}
function elem(tag,text,cls){const node=document.createElement(tag);node.textContent=String(text??'');if(cls)node.className=cls;return node;}
function notice(message,error=false){const e=$('personnel-message');e.textContent=message;e.className='alert '+(error?'error':'success');e.hidden=false;}
function tab(name){
 state.tab=name;
 for(const button of document.querySelectorAll('[data-personnel-tab]')){
  const active=button.dataset.personnelTab===name;
  button.classList.toggle('is-active',active);button.setAttribute('aria-selected',String(active));
 }
 for(const panel of document.querySelectorAll('[data-personnel-panel]'))panel.hidden=panel.dataset.personnelPanel!==name;
}
function renderProfiles(){
 const tbody=$('personnel-profiles-body');tbody.replaceChildren();
 for(const p of state.profiles){
  const tr=document.createElement('tr');
  for(const v of [p.full_name,p.employee_number,p.status==='active'?'حالي':'تاريخي',p.specialization||'—'])tr.append(elem('td',v));
  tbody.append(tr);
 }
 if(!tbody.children.length){const tr=document.createElement('tr');const td=elem('td','لا توجد ملفات وظيفية معتمدة.');td.colSpan=4;tr.append(td);tbody.append(tr);}
}
function select(options,placeholder){
 const s=document.createElement('select');s.add(new Option(placeholder,''));
 for(const o of options)s.add(new Option(o.label,o.id));
 return s;
}
function requestRow(r){
 const box=elem('article','','personnel-request');
 const heading=elem('div','','personnel-request-head');
 heading.append(elem('strong',r.full_name),elem('span',statusNames[r.status]||r.status,'personnel-status'));
 const meta=elem('p','الهوية: '+r.national_mask+' — تاريخ الطلب: '+new Date(r.created_at).toLocaleDateString('ar-SA'));
 box.append(heading,meta);
 if(r.specialization)box.append(elem('p','التخصص: '+r.specialization));
 if(r.decision_note)box.append(elem('p','سبب القرار: '+r.decision_note));
 if(['pending','under_review'].includes(r.status)){
  const actions=elem('div','','personnel-actions');
  const button=(label,action)=>{
   const b=elem('button',label,'button');b.type='button';
   b.addEventListener('click',()=>decision(r,action));actions.append(b);
  };
  if(r.status==='pending')button('بدء المراجعة','start');
  if(r.status==='under_review'){
   button('التحقق من الهوية','reveal');button('اعتماد الملف والارتباط','approve');
   button('طلب استكمال','changes');button('رفض الطلب','reject');
  }
  box.append(actions);
 }
 return box;
}
function renderRequests(){
 const list=$('personnel-requests-list');list.replaceChildren();
 const history=$('personnel-history-list');history.replaceChildren();
 for(const r of state.requests){
  const row=requestRow(r);
  if(['approved','rejected','cancelled'].includes(r.status)){
   history.append(row);
  }else list.append(row);
 }
 if(!list.children.length)list.append(elem('p','لا توجد طلبات معلقة.','personnel-empty'));
 if(!history.children.length)history.append(elem('p','لا توجد قرارات مكتملة.','personnel-empty'));
}
async function decision(r,action){
 try{
  if(action==='reveal'){
   if(!confirm('سيتم تسجيل الكشف عن رقم الهوية في سجل التدقيق. هل تريد المتابعة؟'))return;
   const value=await api('/api/personnel/admin','POST',
    {school_id:state.school,request_id:r.id,action:'reveal'});
   const answer=elem('p','رقم الهوية بعد التحقق من الصلاحية: '+value);
   answer.className='personnel-sensitive';
   const list=$('personnel-requests-list');
   list.prepend(answer);
   return;
  }
  let payload={school_id:state.school,request_id:r.id,action};
  if(['reject','changes'].includes(action)){
   const reason=prompt(action==='reject'?'سبب رفض الطلب:':'ما البيانات المطلوب استكمالها؟');
   if(reason===null)return;
   if(reason.trim().length<3){notice('أدخل سببًا واضحًا لا يقل عن 3 أحرف.',true);return;}
   payload.note=reason.trim();
  }
  if(action==='approve'){
   const form=document.createElement('form');form.className='personnel-approval-form';
   form.append(elem('h3','اعتماد الملف الوظيفي والارتباط'));
   const number=elem('input');number.required=true;number.maxLength=80;number.placeholder='رقم الموظف في هذه المدرسة';
   const year=select(state.years.map(x=>({id:x.id,label:x.label})),'اختر العام الدراسي');
   year.required=true;
   const job=select(state.jobs.map(x=>({id:x.id,label:x.title_ar})),'المسمى الوظيفي (اختياري)');
   const comment=elem('input');comment.placeholder='ملاحظة الاعتماد (اختيارية)';comment.maxLength=1000;
   for(const [title,control] of [['رقم الموظف',number],['العام الدراسي',year],['الوظيفة',job],['ملاحظة',comment]]){
    const label=elem('label',title);label.append(control);form.append(label);
   }
   const submit=elem('button','اعتماد وربط الحساب','button');submit.type='submit';form.append(submit);
   const cancel=elem('button','إلغاء','button');cancel.type='button';cancel.onclick=()=>form.remove();form.append(cancel);
   form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!confirm('هل تحققّت من هوية الموظف وتوافق البيانات مع سجلات المدرسة؟'))return;
    submit.disabled=true;
    try{
     await api('/api/personnel/admin','POST',{...payload,employee_number:number.value.trim(),
       year_id:year.value,job_title_id:job.value||null,note:comment.value.trim()||null});
     notice('تم اعتماد الملف والارتباط بنجاح.');form.remove();await load(state.school);
    }catch(err){notice(err.message,true);}finally{submit.disabled=false;}
   });
   $('personnel-requests-list').prepend(form);number.focus();return;
  }
  if(action==='start'&&!confirm('سيُقفل تعديل الموظف للطلب عند بدء المراجعة. هل تتابع؟'))return;
  if(action==='reject'&&!confirm('تأكيد رفض الطلب؟'))return;
  await api('/api/personnel/admin','POST',payload);
  notice('تم تنفيذ الإجراء.');await load(state.school);
 }catch(err){notice(err.message,true);}
}
async function operationAction(op,action,decisionValue){
 try{
  if(!confirm(action==='execute'?'تنفيذ العملية بعد اكتمال الموافقات؟':
     decisionValue==='approved'?'اعتماد مشاركة الحقول المحددة؟':'رفض مشاركة البيانات؟'))return;
  const body=action==='execute'?
    {action:'execute',operation_id:op.id}:
    {action:'decide',operation_id:op.id,approval_type:'source_school_owner',decision:decisionValue};
  await api('/api/personnel/operations','POST',body);
  notice('تم تحديث عملية النقل أو النسخ.');await load(state.school);
 }catch(e){notice(e.message,true);}
}
function renderOperations(){
 const list=$('personnel-operations-list');list.replaceChildren();
 for(const op of state.operations||[]){
  const box=elem('article','','personnel-request');
  box.append(elem('strong',(op.operation_type==='transfer'?'نقل':'نسخ')+' — '+op.status));
  box.append(elem('p','من '+op.source_school_name+' إلى '+op.target_school_name));
  box.append(elem('p','رقم الموظف المستهدف: '+op.target_employee_number));
  box.append(elem('p','الحقول المختارة: '+(op.selected_fields||[]).join('، ')));
  box.append(elem('p','موافقة صاحب الملف: '+(op.subject_approved?'تمت':'معلقة')+
   ' — موافقة المدرسة المصدر: '+(op.source_approved?'تمت':'معلقة')));
  const actions=elem('div','','personnel-actions');
  const btn=(label,handler)=>{const b=elem('button',label,'button');b.type='button';b.addEventListener('click',handler);actions.append(b);};
  if(op.source_school_id===state.school&&op.status==='pending'&&!op.source_approved){
   btn('الموافقة بصفتك مدير المدرسة المصدر',()=>operationAction(op,'decide','approved'));
   btn('رفض مشاركة البيانات',()=>operationAction(op,'decide','rejected'));
  }
  if(op.target_school_id===state.school&&op.status==='approved')
   btn('تنفيذ النقل / النسخ',()=>operationAction(op,'execute'));
  box.append(actions);list.append(box);
 }
 if(!list.children.length)list.append(elem('p','لا توجد عمليات نسخ أو نقل.','personnel-empty'));
}
async function load(school){
 if(!school)return;
 state.school=school;
 try{
  const [data,catalog,operations]=await Promise.all([
   api('/api/personnel/admin?school_id='+encodeURIComponent(school)),
   api('/api/catalog'),api('/api/personnel/operations?school_id='+encodeURIComponent(school))]);
  if(state.school!==school)return;
  state.requests=data.requests||[];state.profiles=data.profiles||[];
  state.years=catalog.years||[];state.jobs=catalog.jobs||[];state.operations=operations||[];
  renderProfiles();renderRequests();renderOperations();
 }catch(err){notice(err.message,true);}
}
document.addEventListener('DOMContentLoaded',()=>{
 const form=$('personnel-operation-form');
 if(form)form.addEventListener('submit',async event=>{
  event.preventDefault();
  const source=$('personnel-source-id').value.trim();
  const number=$('personnel-target-number').value.trim();
  const fields=['full_name_snapshot',
   ...[...form.querySelectorAll('input[type=checkbox]:checked:not([disabled])')].map(x=>x.value)];
  if(!confirm('سيُرسل طلب المشاركة إلى صاحب الملف ومدير المدرسة المصدر. لن تُنقل البيانات قبل موافقتهما.'))return;
  const submit=form.querySelector('button[type=submit]');submit.disabled=true;
  try{
   await api('/api/personnel/operations','POST',{action:'start',
    source_profile_id:source,target_school_id:state.school,
    employee_number:number,operation_type:$('personnel-operation-type').value,selected_fields:fields});
   notice('تم إنشاء طلب النقل أو النسخ، وهو بانتظار الموافقات.');
   form.reset();await load(state.school);
  }catch(e){notice(e.message,true);}finally{submit.disabled=false;}
 });
 for(const b of document.querySelectorAll('[data-personnel-tab]'))b.addEventListener('click',()=>tab(b.dataset.personnelTab));
 tab('profiles');
});
window.itqanPersonnelAdmin={load};
})();