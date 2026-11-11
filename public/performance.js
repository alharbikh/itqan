(()=>{'use strict';
const $=id=>document.getElementById(id);
const state={user:null,schools:[],school:null,years:[],jobs:[],criteria:[],frameworks:[],stages:[],evidence:[]};

function requestConfirmation(question){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');
  dialog.setAttribute('aria-label','تأكيد الإجراء');
  dialog.setAttribute('dir','rtl');
  dialog.className='itqan-confirm-dialog';
  const message=document.createElement('p');
  message.textContent=question;
  message.className='itqan-confirm-message';
  const actions=document.createElement('div');
  actions.className='itqan-confirm-actions';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='إلغاء';
  const accept=document.createElement('button');accept.type='button';accept.textContent='تأكيد';
  for(const button of [cancel,accept])button.className='itqan-confirm-button';
  accept.classList.add('itqan-confirm-accept');
  actions.append(cancel,accept);dialog.append(message,actions);document.body.append(dialog);
  let settled=false;
  const finish=value=>{if(settled)return;settled=true;dialog.close();dialog.remove();resolve(value);};
  cancel.addEventListener('click',()=>finish(false));
  accept.addEventListener('click',()=>finish(true));
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
  dialog.addEventListener('close',()=>finish(false));
  try{dialog.showModal();cancel.focus();}catch{finish(false);}
 });
}
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
async function renderAttachments(evidenceId,container,schoolId=null){
 const query=new URLSearchParams({evidence_id:evidenceId});
 if(schoolId)query.set('school_id',schoolId);
 const response=await api('/api/evidence/attachments?'+query);
 const attachments=response.attachments||[];
 if(!attachments.length)return;
 const area=document.createElement('div');area.className='perf-list';
 for(const a of attachments){
  const line=document.createElement('div');line.className='perf-item';
  const caption=document.createElement('span');
  caption.textContent=a.original_filename+' — '+(a.byte_size/1024/1024).toFixed(2)+' ميجابايت';
  const download=document.createElement('a');
  download.href='/api/evidence/attachments/'+encodeURIComponent(a.id)+'/download'+
    (schoolId?'?school_id='+encodeURIComponent(schoolId):'');
  download.textContent='تنزيل المرفق';download.rel='nofollow';
  line.append(caption,download);
  if(!schoolId&&a.user_id===state.user?.id){
   const remove=document.createElement('button');remove.type='button';remove.textContent='حذف المرفق';
   remove.onclick=async()=>{if(!await requestConfirmation('سيُحذف الملف نهائيًا ولا يمكن استرجاعه. هل تؤكد؟'))return;
    try{await api('/api/evidence/attachments/'+encodeURIComponent(a.id),'DELETE');
       msg('حُذف المرفق بنجاح','success');await refresh();}
    catch(error){msg(error.message,'error');}};
   line.append(remove);
  }
  area.append(line);
 }
 container.append(area);
}
function option(select,value,text){const o=document.createElement('option');o.value=value;o.textContent=text;select.add(o);}
function principal(){return state.user?.schoolMemberships?.some(m=>m.school_id===state.school&&m.access_role==='school_principal');}
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
 $('share-evidence').disabled=!state.school;
 $('unshare-evidence').disabled=!state.school;
 $('role').textContent=principal()?'مدير المدرسة':'موظف';
 const evidence=await api('/api/evidence/personal');
 state.evidence=Array.isArray(evidence.evidence)?evidence.evidence:[];
 const listing=$('evidence-list');listing.replaceChildren();
 const select=$('link-evidence');select.replaceChildren();option(select,'','اختر الشاهد');
 for(const e of state.evidence){
  option(select,e.id,e.title);
  const box=item(listing,e.title,e.description||'شاهد دون وصف');
  try{await renderAttachments(e.id,box);}
  catch(error){const note=document.createElement('span');note.textContent='تعذر عرض مرفقات الشاهد';box.append(note);}
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
  if(principal()&&f.reviewer_user_id===state.user.id&&f.status==='draft'){
   const publish=document.createElement('button');publish.type='button';publish.textContent='نشر التغذية الراجعة';
   publish.onclick=async()=>{if(!await requestConfirmation('سيطلع الموظف على هذه الملاحظات الوصفية. هل تؤكد؟'))return;
    try{await api('/api/school/midyear-feedback','PATCH',{action:'publish',school_id:state.school,feedback_id:f.id});
    msg('نُشرت المراجعة الوصفية','success');await refresh();}catch(e){msg(e.message,'error');}};
   box.append(publish);
  }
  if(f.subject_user_id===state.user.id&&f.status==='published'){
   const b=document.createElement('button');b.textContent='إقرار الاطلاع';b.type='button';
   b.onclick=async()=>{try{await api('/api/school/midyear-ack','POST',{feedback_id:f.id});msg('تم توثيق الاطلاع','success');await refresh();}catch(err){msg(err.message,'error');}};
   box.append(b);
  }
 }
 if(!fb.children.length)item(fb,'لا توجد مراجعات نصفية متاحة لهذا الحساب.');
 const reviews=await api('/api/school/reviews?school_id='+encodeURIComponent(state.school));
 const reviewList=$('reviews-list');reviewList.replaceChildren();
 for(const r of reviews.reviews||[]){
  const box=item(reviewList,'الموظف: '+r.subject_user_id,'الحالة: '+r.status,
    'التقدير العام: '+(r.final_rating_5==null?'لم يحتسب':r.final_rating_5+' / 5')+
    (r.final_score_5_exact==null?'':' — المتوسط الموزون: '+Number(r.final_score_5_exact).toFixed(2)+' / 5'));
  if(principal()&&r.status==='draft'){
    const edit=document.createElement('button');edit.type='button';edit.textContent='تقدير المعايير';
    edit.onclick=()=>scoreEditor(r,box).catch(e=>msg(e.message,'error'));box.append(edit);
    const submit=document.createElement('button');submit.type='button';submit.textContent='إرسال التقييم للمراجعة';
    submit.onclick=async()=>{try{const answer=await api('/api/school/review-actions','POST',
    {action:'submit',review_id:r.id});msg('أُرسل التقييم: '+answer.result+' / 100','success');await refresh();}
    catch(e){msg(e.message,'error');}};box.append(submit);
  }
  if(principal()&&r.status==='submitted'){
    const approve=document.createElement('button');approve.type='button';approve.textContent='اعتماد داخلي للتقييم';
    approve.onclick=async()=>{if(!await requestConfirmation('هذا اعتماد داخلي مساند، وليس اعتمادًا رسميًا في فارس. هل تؤكد؟'))return;
     try{await api('/api/school/review-actions','POST',{action:'approve',review_id:r.id});
       msg('تم الاعتماد الداخلي','success');await refresh();}catch(e){msg(e.message,'error');}};
    box.append(approve);
  }
 }
 if(!reviewList.children.length)item(reviewList,'لا توجد تقييمات متاحة للعرض.');
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
     btn.onclick=async()=>{if(!await requestConfirmation('هل تريد '+label+'؟'))return;
      try{await api('/api/school/link-decision','POST',{school_id:state.school,request_id:r.id,
       approve:yes,job_role:role.value,note:'قرار موثق بواسطة مدير المدرسة'});
       msg('حُفظ قرار الربط','success');await refresh();}catch(err){msg(err.message,'error');}};
     box.append(btn);
    }
   }
  }
  if(!req.children.length)item(req,'لا توجد طلبات ربط.');
  const shared=await api('/api/school/shared-evidence?school_id='+encodeURIComponent(state.school));
  const sharedList=$('shared-evidence-list');sharedList.replaceChildren();
  for(const evidence of shared.evidence||[]){
   const box=item(sharedList,'الموظف: '+evidence.user_id,evidence.title,evidence.description||'بدون وصف');
   try{await renderAttachments(evidence.id,box,state.school);}
   catch(error){const note=document.createElement('span');note.textContent='تعذر عرض المرفقات المشاركة';box.append(note);}
   if(evidence.link_url&&/^https:\/\//.test(evidence.link_url)){
    const link=document.createElement('a');link.href=evidence.link_url;link.rel='noopener noreferrer';
    link.target='_blank';link.textContent='فتح الرابط';box.append(link);}
  }
  if(!sharedList.children.length)item(sharedList,'لم يشارك الموظفون شواهد شخصية مع المدرسة.');
  const exceptionRequests=await api('/api/school/review-exceptions?school_id='+encodeURIComponent(state.school));
  const list=$('exception-requests-list');list.replaceChildren();
  for(const x of exceptionRequests.exceptions||[]){
   const box=item(list,'المقيم السابق: '+x.requested_by,'التقييم: '+x.review_id,
    'الحالة: '+x.status,'السبب: '+x.reason);
   if(x.status==='pending'&&x.requested_by!==state.user.id){
    for(const [approve,label] of [[true,'إجازة لمدة 7 أيام'],[false,'رفض الطلب']]){
     const button=document.createElement('button');button.type='button';button.textContent=label;
     button.onclick=async()=>{if(!await requestConfirmation('هل تؤكد قرار الاستثناء؟'))return;
       try{await api('/api/school/review-exceptions','POST',
        {action:'decide',request_id:x.id,approve,
         expires_at:approve?new Date(Date.now()+7*86400000).toISOString():null});
        msg('حُفظ قرار الاستكمال','success');await refresh();}catch(e){msg(e.message,'error');}};
     box.append(button);
    }
   }
  }
  if(!list.children.length)item(list,'لا توجد طلبات استكمال استثنائي.');
 }
}
async function scoreEditor(review,container){
 const d=await api('/api/framework-details?framework_id='+encodeURIComponent(review.framework_id));
 const criteria=(d.criteria||[]).filter(x=>x.job_title_id===review.job_title_id);
 if(!criteria.length)throw Error('لم تُعثر على معايير مرتبطة بوظيفة الموظف.');
 const pane=document.createElement('div');pane.className='perf-list';
 for(const c of criteria){
  const row=item(pane,c.title_ar+' — الوزن '+c.weight+'%',c.interpretation||'لا يوجد تفسير مضاف');
  const score=document.createElement('select');
  for(let i=1;i<=5;i++)option(score,String(i),'المستوى '+i);
  const note=document.createElement('input');note.placeholder='ملاحظات المقيم (اختياري)';note.maxLength=2000;
  const save=document.createElement('button');save.type='button';save.textContent='حفظ درجة المعيار';
  save.onclick=async()=>{try{await api('/api/school/review-actions','POST',
   {action:'score',review_id:review.id,criterion_id:c.criterion_id,score_level:Number(score.value),note:note.value});
   msg('حُفظ تقدير العنصر','success');}catch(e){msg(e.message,'error');}};
  row.append(score,note,save);
 }
 container.append(pane);
}
let criteriaTabsCounter=0;
function makeCriterionTabs(criterion,sourceReference){
 const card=document.createElement('section');
 card.className='criterion-detail';
 const title=document.createElement('h3');
 title.textContent=(criterion.title_ar||'معيار دون عنوان')+' — الوزن '+criterion.weight+'%';
 card.append(title);
 const tabs=document.createElement('div');tabs.className='criterion-tabs';
 tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','تفاصيل المعيار');
 const panels=document.createElement('div');panels.className='criterion-panels';
 const tabKey='criterion-'+(++criteriaTabsCounter);
 const definitions=[
  ['التفسير',()=>{
    const p=document.createElement('p');
    p.textContent=criterion.interpretation||'لم يُضف تفسير رسمي لهذا المعيار بعد.';
    return p;
  }],
  ['سلم التقدير',()=>{
    const list=document.createElement('ol');list.className='criterion-descriptors';
    for(const level of (criterion.descriptors||[]).slice().sort((a,b)=>a.score_level-b.score_level)){
      const li=document.createElement('li');
      li.textContent='المستوى '+level.score_level+': '+level.descriptor;
      list.append(li);
    }
    if(!list.children.length){
      const empty=document.createElement('p');
      empty.textContent='لم يرد وصف مستويات مستقل في البيانات المعتمدة لهذا المعيار.';
      return empty;
    }
    return list;
  }],
  ['الشواهد',()=>{
    const list=document.createElement('ul');list.className='criterion-suggestions';
    for(const suggestion of criterion.suggestions||[]){
      const li=document.createElement('li');
      const title=document.createElement('strong');title.textContent=suggestion.title_ar||'شاهد مقترح';
      li.append(title);
      if(suggestion.description){
        const details=document.createElement('span');details.textContent=' — '+suggestion.description;li.append(details);
      }
      list.append(li);
    }
    if(!list.children.length){
      const empty=document.createElement('p');
      empty.textContent='لا توجد شواهد إرشادية منشورة لهذا المعيار. الشواهد غير إلزامية إلا بمسوغ رسمي.';
      return empty;
    }
    return list;
  }],
  ['المرجع',()=>{
    const p=document.createElement('p');
    p.textContent='المصدر: '+(sourceReference||'لم يُسجل مرجع للإطار')+
      ' — الصفحة: '+(criterion.source_page??'غير محددة');
    return p;
  }]
 ];
 const buttons=[];
 const sections=[];
 const activate=index=>{
   buttons.forEach((button,i)=>{
     const selected=i===index;button.setAttribute('aria-selected',String(selected));
     button.tabIndex=selected?0:-1;sections[i].hidden=!selected;
   });
 };
 definitions.forEach(([label,content],index)=>{
   const button=document.createElement('button');button.type='button';button.setAttribute('role','tab');
   button.id=tabKey+'-tab-'+index;button.setAttribute('aria-controls',tabKey+'-panel-'+index);
   button.textContent=label;tabs.append(button);buttons.push(button);
   const section=document.createElement('section');section.id=tabKey+'-panel-'+index;
   section.setAttribute('role','tabpanel');section.setAttribute('aria-labelledby',button.id);
   section.className='criterion-panel';section.append(content());panels.append(section);sections.push(section);
   button.addEventListener('click',()=>activate(index));
   button.addEventListener('keydown',event=>{
     const step=event.key==='ArrowLeft'?1:event.key==='ArrowRight'?-1:0;
     if(!step&&event.key!=='Home'&&event.key!=='End')return;
     event.preventDefault();
     const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:
       (index+step+buttons.length)%buttons.length;
     activate(next);buttons[next].focus();
   });
 });
 card.append(tabs,panels);activate(0);return card;
}
async function showCriteria(frameworkId,box){
 try{
  const r=await api('/api/framework-details?framework_id='+encodeURIComponent(frameworkId));
  box.querySelector('.criteria-collection')?.remove();
  const panel=document.createElement('div');panel.className='perf-list criteria-collection';
  const reference=state.frameworks.find(x=>x.id===frameworkId)?.source_reference||'';
  for(const criterion of r.criteria||[])panel.append(makeCriterionTabs(criterion,reference));
  if(!panel.children.length)item(panel,'لا توجد معايير منشورة لهذا الإطار.');
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
  if(!state.schools.length){msg('لا توجد عضوية مدرسية نشطة. مكتبة شواهدك الشخصية ومرفقاتها ما زالت متاحة.','info');await refresh();return;}
  state.school=state.schools[0].id;
  const years=$('year');years.replaceChildren();option(years,'','اختر العام الدراسي');
  for(const y of state.years)option(years,y.id,y.label);
  const current=state.years.find(y=>y.is_current)||state.years[0];
  if(current)years.value=current.id;
  const jobs=$('personnel-job');for(const j of state.jobs)option(jobs,j.id,j.title_ar);
  const frameworks=$('framework');frameworks.replaceChildren();option(frameworks,'','اختر الإطار المنشور');
  for(const f of state.frameworks)option(frameworks,f.id,f.title_ar+' (v'+f.version_no+')');
  const reviewFramework=$('review-framework');reviewFramework.replaceChildren();
  for(const f of state.frameworks)option(reviewFramework,f.id,f.title_ar+' (v'+f.version_no+')');
  const reviewJob=$('review-job');reviewJob.replaceChildren();
  for(const j of state.jobs)option(reviewJob,j.id,j.title_ar);
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
bindForm('attachment-form',async()=>{
 const evidenceId=$('link-evidence').value;
 const file=$('attachment-file').files?.[0];
 if(!evidenceId)throw Error('اختر شاهدًا أولًا');
 if(!file||file.size===0||file.size>5*1024*1024)throw Error('اختر ملفًا لا يتجاوز 5 ميجابايت');
 const data=new FormData();data.append('evidence_id',evidenceId);data.append('file',file,file.name);
 const res=await fetch('/api/evidence/attachments',{method:'POST',credentials:'same-origin',body:data});
 const response=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(response.error||'تعذر رفع المرفق');
 $('attachment-form').reset();
});
$('share-evidence').onclick=async()=>{try{
 await api('/api/evidence/share','POST',{evidence_id:$('link-evidence').value,school_id:state.school});
 msg('شاركت الشاهد مع المدرسة الحالية','success');await refresh();}catch(e){msg(e.message,'error');}};
$('unshare-evidence').onclick=async()=>{try{
 await api('/api/evidence/share','DELETE',{evidence_id:$('link-evidence').value,school_id:state.school});
 msg('ألغيت مشاركة الشاهد مع المدرسة','success');await refresh();}catch(e){msg(e.message,'error');}};
$('link-save').onclick=async()=>{try{await api('/api/evidence/criterion-link','POST',
 {evidence_id:$('link-evidence').value,criterion_id:$('link-criterion').value});
 msg('تم ربط الشاهد','success');}catch(e){msg(e.message,'error');}};
bindForm('review-form',async()=>{const y=state.years.find(x=>x.id===selectedYear());
 if(!y)throw Error('اختر العام الدراسي');
 await api('/api/school/reviews','POST',{school_id:state.school,subject_user_id:$('review-subject').value,
 year:y.label,framework_id:$('review-framework').value,job_title_id:$('review-job').value});
 $('review-form').reset();
});
bindForm('personnel-form',async()=>{
 if(!selectedYear())throw Error('اختر العام الدراسي أولًا');
 const data=await api('/api/school/personnel','POST',
 {school_id:state.school,year_id:selectedYear(),full_name:$('personnel-name').value,
 national_id:$('personnel-national').value||null,job_title_id:$('personnel-job').value||null});
 $('personnel-created').hidden=false;
 $('personnel-created').textContent='معرف الملف الجديد لإرساله للموظف: '+data.result;
 $('personnel-form').reset();
});
bindForm('unlink-form',async()=>{if(!await requestConfirmation('سيتم إنهاء صلاحية الموظف بهذه المدرسة، مع حفظ السجل التاريخي. هل تؤكد؟'))return;
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