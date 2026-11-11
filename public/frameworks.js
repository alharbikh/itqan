(()=>{'use strict';const $=id=>document.getElementById(id);
let catalog={years:[],stages:[]};

const compact=matchMedia('(max-width:760px)');
let navMode='expanded';
function updateNav(){
 for(const mode of ['expanded','icons','hidden'])document.body.classList.toggle('nav-'+mode,navMode===mode);
 const open=document.body.classList.contains('nav-mobile-open');
 $('admin-scrim').hidden=!open;
 $('nav-toggle').setAttribute('aria-expanded',String(compact.matches?open:navMode!=='hidden'));
}
function toggleNav(){
 if(compact.matches)document.body.classList.toggle('nav-mobile-open');
 else navMode={expanded:'icons',icons:'hidden',hidden:'expanded'}[navMode];
 updateNav();
}
function confirmFrameworkAction(question){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');
  dialog.className='itqan-confirm-dialog';
  dialog.setAttribute('dir','rtl');dialog.setAttribute('aria-label','تأكيد إجراء إداري');
  const message=document.createElement('p');message.className='itqan-confirm-message';message.textContent=question;
  const actions=document.createElement('div');actions.className='itqan-confirm-actions';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='itqan-confirm-button';cancel.textContent='إلغاء';
  const accept=document.createElement('button');accept.type='button';accept.className='itqan-confirm-button itqan-confirm-accept';accept.textContent='تأكيد';
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
$('nav-toggle').addEventListener('click',toggleNav);
$('admin-scrim').addEventListener('click',()=>{document.body.classList.remove('nav-mobile-open');updateNav();});
compact.addEventListener('change',()=>{document.body.classList.remove('nav-mobile-open');updateNav();});
updateNav();

function notice(x,type='info'){$('message').textContent=x;$('message').className='alert '+type;$('message').hidden=false;}
async function api(path,method='GET',body){const res=await fetch(path,{method,credentials:'same-origin',
 ...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
 const data=await res.json().catch(()=>({}));
 if(!res.ok){
  if(res.status===401||res.status===403){
   try{sessionStorage.setItem('itqan_access_state',res.status===401?'login':'forbidden');}catch{}
   location.replace('/access');
  }
  throw Error(data.error||'تعذر تنفيذ العملية. تحقق من الاتصال وصلاحيات الحساب.');
 }
 return data;}
function item(parent,...text){const box=document.createElement('div');box.className='perf-item';
 for(const part of text){const p=document.createElement('span');p.textContent=String(part||'—');box.append(p);}
 parent.append(box);return box;}
function option(el,value,title){const o=document.createElement('option');o.value=value;o.textContent=title;el.append(o);}
function safePayload(){const raw=$('json-text').value;if(raw.length>290000)throw Error('حجم ملف JSON كبير');
 const p=JSON.parse(raw);
 if(!p||!Array.isArray(p.jobs)||!p.jobs.length)throw Error('يجب تضمين مصفوفة الوظائف jobs');
 return p;
}
function validate(p){const rows=[];for(const job of p.jobs){
 if(!Array.isArray(job.criteria)||!job.criteria.length)throw Error('لا توجد معايير في الوظيفة '+job.code);
 const sum=job.criteria.reduce((s,c)=>s+Number(c.weight),0);
 rows.push({job:job.title_ar||job.code,count:job.criteria.length,total:sum,valid:Math.abs(sum-100)<.00001});
 }return rows;}
async function refresh(){
 const [c,b]=await Promise.all([api('/api/catalog'),api('/api/admin/framework-batches')]);catalog=c;
 const years=$('years-list');years.replaceChildren();const select=$('stage-year');select.replaceChildren();
 for(const y of c.years||[]){item(years,y.label,y.starts_on+' — '+y.ends_on,y.is_current?'العام الحالي':'عام محفوظ');option(select,y.id,y.label);}
 if(!years.children.length)item(years,'لا توجد أعوام دراسية مضافة.');
 const stages=$('stages-list');stages.replaceChildren();
 for(const st of c.stages||[]){item(stages,st.stage,st.starts_on+' — '+st.ends_on,'المسموح: '+st.earliest_start+' — '+st.latest_end);}
 if(!stages.children.length)item(stages,'لم تضبط فترات مركزية.');
 const batches=$('batches');batches.replaceChildren();
 for(const x of b.batches||[]){
  const box=item(batches,(x.payload?.title_ar||x.payload?.code||'إطار دون عنوان')+' — '+x.status,
   'التاريخ: '+new Date(x.created_at).toLocaleDateString('ar-SA'),'رقم المسودة: '+x.id);
  const buttons=document.createElement('div');buttons.className='perf-toolbar';
  const edit=document.createElement('button');edit.type='button';edit.textContent='عرض/تعديل JSON';
  edit.onclick=()=>{$('json-text').value=JSON.stringify(x.payload,null,2);$('draft-id').value=x.id;
   $('json-text').focus();window.scrollTo({top:$('json-text').getBoundingClientRect().top+window.scrollY-120,behavior:'smooth'});};
  buttons.append(edit);
  if(x.status==='draft'){
   const approve=document.createElement('button');approve.type='button';approve.textContent='اعتماد بعد المراجعة';
   approve.onclick=async()=>{if(!await confirmFrameworkAction('هل راجعت جميع المعايير والتفسيرات والأوزان من المصدر الرسمي؟'))return;
    try{await api('/api/admin/framework-actions','POST',{batch_id:x.id,action:'approve',
     note:'مراجعة واعتماد مدير الموقع'});notice('أُنجز الاعتماد دون نشر','success');await refresh();}
    catch(err){notice(err.message,'error');}};
   buttons.append(approve);
  }else if(x.status==='approved'){
   const publish=document.createElement('button');publish.type='button';publish.textContent='نشر الإطار للمدارس';
   publish.onclick=async()=>{if(!await confirmFrameworkAction('سيصبح الإطار المعتمد متاحًا للمدارس. هل تعتمد النشر؟'))return;
    try{await api('/api/admin/framework-actions','POST',{batch_id:x.id,action:'publish'});
     notice('نُشر الإطار','success');await refresh();}catch(err){notice(err.message,'error');}};
   buttons.append(publish);
  }
  box.append(buttons);
 }
 if(!batches.children.length)item(batches,'لم تُستورد مسودات بعد.');
}
$('json-file').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;
 try{if(file.size>300000)throw Error('حجم الملف يتجاوز الحد المسموح');
 $('json-text').value=await file.text();$('draft-id').value='';notice('تم تحميل الملف محليًا. راجعه ثم احفظ المسودة.','info');}
 catch(err){notice(err.message,'error');}});
$('preview').onclick=()=>{try{const p=safePayload();const result=validate(p),target=$('preview-result');target.replaceChildren();
 for(const x of result)item(target,x.job,x.count+' معيارًا','مجموع الأوزان: '+x.total+'%',
 x.valid?'مجموع صحيح':'يجب تصحيح مجموع الأوزان إلى 100%');
 notice(result.every(x=>x.valid)?'المجاميع صحيحة مبدئيًا. لا تزال مراجعة النصوص والمصدر مطلوبة.':
 'هناك وظائف بأوزان غير مكتملة.','info');
 }catch(e){notice('JSON غير صالح: '+e.message,'error');}};
$('stage').onclick=async()=>{try{const p=safePayload();if(validate(p).some(r=>!r.valid))throw Error('مجاميع الأوزان غير صحيحة');
 await api('/api/admin/framework-batches','POST',{payload:p});$('draft-id').value='';notice('حُفظت مسودة جديدة','success');await refresh();}
 catch(e){notice(e.message,'error');}};
$('replace').onclick=async()=>{try{const p=safePayload(),id=$('draft-id').value;if(!id)throw Error('اختر مسودة من القائمة');
 await api('/api/admin/framework-actions','POST',{action:'replace',batch_id:id,payload:p});
 notice('حُفظت التعديلات دون نشر','success');await refresh();}catch(e){notice(e.message,'error');}};
$('year-form').addEventListener('submit',async e=>{e.preventDefault();try{
 await api('/api/admin/academic-years','POST',{label:$('year-label').value,starts_on:$('year-start').value,
 ends_on:$('year-end').value,is_current:$('year-current').value==='true'});
 notice('أُضيف العام الدراسي','success');$('year-form').reset();await refresh();
 }catch(err){notice(err.message,'error');}});
$('stage-form').addEventListener('submit',async e=>{e.preventDefault();try{
 await api('/api/admin/stage-window','POST',{year_id:$('stage-year').value,stage:$('stage-name').value,
 starts_on:$('stage-start').value,ends_on:$('stage-end').value,
 earliest_start:$('stage-min').value,latest_end:$('stage-max').value});
 notice('حُفظ موعد المرحلة المركزي','success');await refresh();
 }catch(err){notice(err.message,'error');}});
$('refresh').onclick=()=>refresh().then(()=>notice('تحديث ناجح','success')).catch(e=>notice(e.message,'error'));
document.addEventListener('DOMContentLoaded',()=>refresh().catch(e=>notice(e.message,'error')));
})();