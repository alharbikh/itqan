(()=>{'use strict';const $=id=>document.getElementById(id);
let user=null;
function notice(text,type='info'){$('message').textContent=text;$('message').className='alert '+type;$('message').hidden=false;}
async function api(path,method='GET',body){const r=await fetch(path,{method,credentials:'same-origin',
 ...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'تعذر تنفيذ الطلب');return d;}
async function refresh(){
 const data=await Promise.all([api('/api/session'),api('/api/school/link-requests'),
  api('/api/personnel/my-requests'),api('/api/personnel/schools'),api('/api/catalog')]);
 const schoolList=$('request-school');const remembered=schoolList.value;
 schoolList.replaceChildren(new Option('اختر المدرسة',''));
 for(const school of data[3].result||[])schoolList.add(new Option(
   school.name+(school.education_department?' — '+school.education_department:''),school.id));
 if(remembered&&[...schoolList.options].some(x=>x.value===remembered))schoolList.value=remembered;
 const jobList=$('request-job');const oldJob=jobList.value;
 jobList.replaceChildren(new Option('غير محدد',''));
 for(const job of data[4].jobs||[])jobList.add(new Option(job.title_ar,job.id));
 if(oldJob&&[...jobList.options].some(x=>x.value===oldJob))jobList.value=oldJob;
 const requested=$('personnel-requests');requested.replaceChildren();
 const translations={draft:'مسودة',pending:'بانتظار المراجعة',under_review:'قيد المراجعة',
   changes_requested:'مطلوب استكمال',approved:'معتمد',rejected:'مرفوض',cancelled:'ملغى'};
 for(const request of data[2].result||[]){
   const row=document.createElement('div');row.className='perf-item';
   const label=document.createElement('strong');label.textContent=(request.school_name||'المدرسة')+' — '+(translations[request.status]||request.status);
   const detail=document.createElement('span');detail.textContent='تاريخ الطلب: '+new Date(request.created_at).toLocaleDateString('ar-SA')+
     (request.decision_note?' — ملاحظة المدير: '+request.decision_note:'');
   row.append(label,detail);requested.append(row);
 }
 if(!requested.children.length){const empty=document.createElement('div');empty.className='perf-note';
   empty.textContent='لا توجد طلبات ملفات وظيفية.';requested.append(empty);}

 user=data[0].user;
 const target=$('requests');target.replaceChildren();
 for(const request of data[1].requests||[]){
  const div=document.createElement('div');div.className='perf-item';
  div.textContent='المدرسة: '+request.school_id+' — حالة الطلب: '+request.status+
    ' — التاريخ: '+new Date(request.requested_at).toLocaleDateString('ar-SA');
  target.append(div);
 }
 if(!target.children.length){const d=document.createElement('div');d.className='perf-note';d.textContent='لا توجد طلبات سابقة.';target.append(d);}
 const exceptions=await api('/api/school/review-exceptions');
 const list=$('exceptions');list.replaceChildren();
 for(const x of exceptions.exceptions||[]){
  const box=document.createElement('div');box.className='perf-item';
  for(const value of ['التقييم: '+x.review_id,'الحالة: '+x.status,'السبب: '+x.reason,
   x.expires_at?'ينتهي: '+new Date(x.expires_at).toLocaleString('ar-SA'):'بانتظار القرار']){
   const item=document.createElement('span');item.textContent=value;box.append(item);}
  if(x.status==='approved'){
   const button=document.createElement('button');button.type='button';
   button.textContent='عرض معايير الاستكمال';button.onclick=async()=>{
    try{const details=await api('/api/school/exception-criteria?request_id='+encodeURIComponent(x.id));
    const fields=document.createElement('div');fields.className='perf-list';
    for(const criterion of details.criteria||[]){
     const row=document.createElement('div');row.className='perf-item';
     const text=document.createElement('span');
     text.textContent=criterion.title_ar+' — الوزن '+criterion.weight+'% — '+(criterion.interpretation||'');
     const select=document.createElement('select');
     for(let k=1;k<=5;k++){const opt=document.createElement('option');opt.value=String(k);
      opt.textContent='المستوى '+k;select.append(opt);}
     if(criterion.score_level)select.value=String(criterion.score_level);
     const note=document.createElement('input');note.placeholder='ملاحظة التقدير';note.maxLength=2000;
     const save=document.createElement('button');save.type='button';save.textContent='حفظ تقدير العنصر';
     save.onclick=async()=>{try{await api('/api/school/review-exceptions','POST',
      {action:'score',request_id:x.id,criterion_id:criterion.criterion_id,score_level:Number(select.value),
       note:note.value});notice('حُفظ التقدير','success');}catch(err){notice(err.message,'error');}};
     row.append(text,select,note,save);fields.append(row);
    }
    const submit=document.createElement('button');submit.type='button';submit.textContent='إنهاء الاستكمال وإرسال التقييم';
    submit.onclick=async()=>{if(!confirm('هل استُكملت جميع الدرجات؟'))return;
     try{await api('/api/school/review-exceptions','POST',{action:'submit',request_id:x.id});
      notice('أُرسل التقييم وأُغلق الاستثناء','success');await refresh();}
     catch(err){notice(err.message,'error');}};
    fields.append(submit);box.append(fields);
    }catch(err){notice(err.message,'error');}};
   box.append(button);
  }
  list.append(box);
 }
 if(!list.children.length){const e=document.createElement('div');e.className='perf-note';
  e.textContent='لا توجد استثناءات تقييم مرتبطة بك.';list.append(e);}
 const membership=user.schoolMemberships?.[0];
 $('active-panel').hidden=!membership;
 if(membership){$('active-school').textContent='المدرسة المرتبطة: '+membership.school_id;
  $('request-form').hidden=true;}else $('request-form').hidden=false;
}
$('request-form').addEventListener('submit',async e=>{e.preventDefault();
 if(user?.schoolMemberships?.length){notice('لديك ارتباط نشط حاليًا. أنهِه قبل اعتماد ارتباط جديد.','error');return;}
 try{await api('/api/personnel/requests','POST',{
 school_id:$('request-school').value,full_name:$('request-name').value.trim(),
 national_id:$('request-national').value.trim(),job_title_id:$('request-job').value||null,
 specialization:$('request-specialization').value.trim()||null});
 notice('أُرسل الطلب إلى مدير المدرسة. لن ينشط الارتباط إلا بعد اعتماده.','success');
 $('request-form').reset();await refresh();}
 catch(err){notice(err.message,'error');}});
$('exception-form').addEventListener('submit',async e=>{e.preventDefault();
 try{await api('/api/school/review-exceptions','POST',
  {action:'request',review_id:$('exception-review').value.trim(),reason:$('exception-reason').value.trim()});
  notice('أُرسل طلب الاستكمال للجهة المخولة','success');$('exception-form').reset();await refresh();}
 catch(err){notice(err.message,'error');}});
$('unlink-form').addEventListener('submit',async e=>{e.preventDefault();
 if(!confirm('سيُفك ارتباطك بالمدرسة الحالية مع الحفاظ على سجلاتها التاريخية. هل تؤكد؟'))return;
 try{await api('/api/school/unlink','POST',{school_id:user.schoolMemberships[0].school_id,
 user_id:user.id,reason:$('reason').value.trim()});
 notice('تم فك الارتباط','success');await refresh();}
 catch(err){notice(err.message,'error');}});
document.addEventListener('DOMContentLoaded',()=>refresh().catch(e=>notice(e.message,'error')));
})();