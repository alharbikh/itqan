(()=>{'use strict';
const $=id=>document.getElementById(id);
const schoolPicker=$('school-picker'),form=$('school-invite-form');
if(!schoolPicker||!form)return;
const message=(text,type='info')=>{const e=$('school-invite-message');e.textContent=text;e.className='alert '+type;e.hidden=false;};
async function api(path,method='GET',body){
 const response=await fetch(path,{method,credentials:'same-origin',
 ...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'تعذر تنفيذ الطلب.');
 return data.result??data;
}
const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=String(text??'');return el;};
const inviteUrl=id=>new URL('/invitations.html?invitation='+encodeURIComponent(id),location.origin).href;
const mailLink=(email,id)=>{
 const a=node('a','فتح البريد لإرسال الدعوة');
 a.href='mailto:'+encodeURIComponent(email)+'?subject='+encodeURIComponent('دعوة الانضمام إلى إتقان سمارت برو')+
 '&body='+encodeURIComponent('تمت دعوتك إلى ملف وظيفي مدرسي في إتقان. افتح الرابط، وسجّل دخولك ببريد الدعوة نفسه، ثم وافق على الانضمام:\n'+inviteUrl(id));
 return a;
};
let school='',profileMap=new Map(),staffIndex=new Map(),prepared=null;
async function refresh(){
 const selected=schoolPicker.value;if(!selected){return;}
 school=selected;
 try{
  const [summary,invites]=await Promise.all([
   api('/api/personnel/admin?school_id='+encodeURIComponent(selected)),
   api('/api/school/invitations?school_id='+encodeURIComponent(selected))]);
  if(schoolPicker.value!==selected)return;
  const profiles=summary.profiles||[];
  profileMap=new Map(profiles.filter(p=>p.status==='active').map(p=>[p.id,p.full_name]));
  staffIndex=new Map(profiles.filter(p=>p.status==='active').map(p=>[String(p.employee_number),p.id]));
  const selector=$('school-invite-profile');selector.replaceChildren(new Option('اختر ملفًا وظيفيًا معتمدًا',''));
  for(const [id,label] of profileMap)selector.add(new Option(label,id));
  const tmp=$('school-temp-profile');if(tmp){
    tmp.replaceChildren(new Option('اختر الملف المعتمد',''));
    for(const [id,label] of profileMap)tmp.add(new Option(label,id));
  }
  const list=$('school-invite-list');list.replaceChildren();
  if(!invites.length)list.append(node('p','لا توجد دعوات مسجلة.'));
  for(const item of invites){
   const article=node('article','');article.className='personnel-request';
   article.append(node('strong',item.full_name+' — '+item.email));
   article.append(node('p',(item.mode==='school'?'حساب مدرسي مستقل':'حساب شخصي بموافقة صاحبه')+
    ' — '+(item.status==='pending'&&Date.parse(item.expires_at)<Date.now()?'منتهية':item.status)));
   if(item.status==='pending'&&Date.parse(item.expires_at)>Date.now()){
    article.append(mailLink(item.email,item.id));
    const cancel=node('button','إلغاء الدعوة');cancel.className='button';cancel.type='button';
    cancel.addEventListener('click',async()=>{
      cancel.disabled=true;
      try{await api('/api/school/invitations/cancel','POST',{school_id:selected,invitation_id:item.id});
       message('أُلغيت الدعوة.','success');await refresh();}
      catch(e){message(e.message,'error');cancel.disabled=false;}
    });
    article.append(cancel);
   }
   list.append(article);
  }
 }catch(e){message(e.message,'error');}
}
form.addEventListener('submit',async e=>{
 e.preventDefault();const button=form.querySelector('button[type="submit"]');
 const profile=$('school-invite-profile').value,email=$('school-invite-email').value.trim();
 const mode=$('school-invite-mode').value;
 if(!school||!profileMap.has(profile)){message('اختر ملفًا وظيفيًا صحيحًا.','error');return;}
 button.disabled=true;
 try{
  const id=await api('/api/school/invitations','POST',{
   school_id:school,profile_id:profile,email,mode});
  message('تم إنشاء الدعوة. افتح بريدك لإرسالها، أو انسخ الرابط لتسليمه إلى الموظف.','success');
  const share=$('school-invite-share');share.replaceChildren();
  const link=mailLink(email,id);share.append(link);
  const copy=node('button','نسخ رابط الدعوة');copy.type='button';copy.className='button';
  copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(inviteUrl(id));}
   catch{message('تعذر النسخ؛ استخدم رابط الدعوة من البريد.','error');}});
  share.append(copy);share.hidden=false;
  form.reset();await refresh();
 }catch(e){message(e.message,'error');}
 finally{button.disabled=false;}
});
schoolPicker.addEventListener('change',()=>{school=schoolPicker.value;refresh();});

const tempForm=$('school-temp-account-form'),tempMessage=$('school-temp-message');
if(tempForm){
 const tempOutput=$('school-temp-output'),tempPassword=$('school-temp-password');
 const tempSay=(message,error=false)=>{tempMessage.textContent=message;tempMessage.className='alert '+(error?'error':'success');tempMessage.hidden=false;};
 const clearTemp=()=>{tempPassword.value='';tempOutput.hidden=true;};
 schoolPicker.addEventListener('change',clearTemp);
 tempForm.addEventListener('submit',async e=>{
  e.preventDefault();clearTemp();
  const id=$('school-temp-profile').value;
  if(!schoolPicker.value||!profileMap.has(id)){tempSay('اختر ملفًا وظيفيًا معتمدًا.',true);return;}
  if(!await askBulk(1))return;
  const button=tempForm.querySelector('button[type="submit"]');button.disabled=true;
  try{
   const result=await api('/api/school/accounts/temporary','POST',{
    school_id:schoolPicker.value,profile_id:id,
    email:$('school-temp-email').value.trim(),reason:$('school-temp-reason').value.trim()
   });
   if(!result.ok||!result.temporary_password)throw Error('تعذر استلام كلمة المرور المؤقتة.');
   tempPassword.value=result.temporary_password;
   tempOutput.hidden=false;
   tempSay('أُنشئ حساب مدرسي مستقل. سلّم كلمة المرور لصاحب الحساب فقط عبر قناة آمنة، وألزمه بتغييرها في أول دخول.');
   tempForm.reset();
   await refresh();
  }catch(err){tempSay(err.message||'تعذر إنشاء الحساب.',true);}
  finally{button.disabled=false;}
 });
 $('school-temp-copy').addEventListener('click',async()=>{
  if(!tempPassword.value)return;
  try{await navigator.clipboard.writeText(tempPassword.value);tempSay('نُسخت كلمة المرور. امسحها من الحافظة بعد تسليمها بأمان.');}
  catch{tempSay('تعذر النسخ، استخدم العرض المباشر بحذر.',true);}
 });
}


const bulkFile=$('school-invite-bulk-file'),bulkPreview=$('school-invite-bulk-preview');
const bulkCreate=$('school-invite-bulk-create'),bulkMessage=$('school-invite-bulk-message');
const bulkResults=$('school-invite-bulk-results');
const bulkSay=(text,failed=false)=>{bulkMessage.textContent=text;bulkMessage.className='alert '+(failed?'error':'success');bulkMessage.hidden=false;};
const bulkReset=()=>{prepared=null;bulkCreate.disabled=true;$('school-invite-bulk-summary').hidden=true;bulkResults.replaceChildren();};
const headers={employee_number:'number','رقم الموظف':'number','الرقم الوظيفي':'number',
 email:'email','البريد الإلكتروني':'email','البريد الالكتروني':'email',
 mode:'mode','نوع الحساب':'mode'};
function askBulk(count){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='itqan-confirm-dialog';dialog.dir='rtl';
  dialog.setAttribute('aria-label','تأكيد الدعوات الجماعية');
  const text=node('p','سيتم إنشاء '+count+' دعوة مدرسية دون إنشاء حسابات أو عضويات. ستحتاج إلى إرسال الروابط للمستلمين. هل تؤكد؟');
  const actions=node('div','');actions.className='itqan-confirm-actions';
  const cancel=node('button','إلغاء'),yes=node('button','تأكيد');
  cancel.type=yes.type='button';cancel.className=yes.className='itqan-confirm-button';
  actions.append(cancel,yes);dialog.append(text,actions);document.body.append(dialog);
  let settled=false;const finish=value=>{if(settled)return;settled=true;dialog.close();dialog.remove();resolve(value);};
  cancel.onclick=()=>finish(false);yes.onclick=()=>finish(true);
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
  dialog.addEventListener('close',()=>finish(false));
  dialog.showModal();cancel.focus();
 });
}
bulkFile.addEventListener('change',bulkReset);
bulkPreview.addEventListener('click',async()=>{
 bulkReset();
 const file=bulkFile.files?.[0],selected=schoolPicker.value;
 if(!selected||!file){bulkSay('اختر المدرسة وملف CSV أولًا.',true);return;}
 if(file.size>1024*1024){bulkSay('ملف CSV يتجاوز الحد المسموح (1MB).',true);return;}
 try{
  const {parseCsv}=await import('/personnel-import-csv.js');
  const records=parseCsv(await file.text(),{maxRows:500});
  if(records.length<2){bulkSay('ملف الدعوات لا يحتوي موظفين.',true);return;}
  const columns=records[0].map(x=>headers[String(x).trim().toLowerCase()]||null);
  if(!columns.includes('number')||!columns.includes('email')||
     columns.filter(Boolean).some((c,i,a)=>a.indexOf(c)!==i))
   {bulkSay('يجب توفير عمود رقم الموظف والبريد الإلكتروني دون تكرار.',true);return;}
  if(records.length>101){bulkSay('حد المعاينة 100 موظف لكل دفعة.',true);return;}
  const ids=new Set(),entries=[],issues=[];
  for(let i=1;i<records.length;i++){
   const values=records[i],row=Object.fromEntries(columns.map((c,j)=>[c,values[j]?.trim()||'']).filter(x=>x[0]));
   const id=staffIndex.get(row.number);
   const mode=row.mode||'school';
   const email=row.email?.toLowerCase()||'';
   let reason='';
   if(values.length!==columns.length)reason='عدد الأعمدة غير صحيح';
   else if(!id)reason='رقم الموظف غير موجود في الملفات المعتمدة لهذه المدرسة';
   else if(ids.has(id))reason='ملف الموظف مكرر في ملف الدعوات';
   else if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)reason='بريد إلكتروني غير صالح';
   else if(!['school','personal'].includes(mode))reason='نوع حساب غير معروف';
   if(reason){issues.push('الصف '+(i+1)+': '+reason);continue;}
   ids.add(id);entries.push({profile_id:id,email,mode,number:row.number});
  }
  $('school-invite-bulk-counts').textContent='صالح: '+entries.length+'، يحتاج مراجعة: '+issues.length+'.';
  for(const issue of issues.slice(0,15))bulkResults.append(node('p',issue));
  if(issues.length>15)bulkResults.append(node('p','توجد أخطاء إضافية؛ صحّح الملف وأعد المعاينة.'));
  $('school-invite-bulk-summary').hidden=false;
  prepared={school:selected,entries};bulkCreate.disabled=!entries.length;
  bulkSay('المعاينة جاهزة. لم تُنشأ أي دعوات حتى الآن.');
 }catch(error){bulkSay(error.message||'تعذرت قراءة ملف الدعوات.',true);}
});
bulkCreate.addEventListener('click',async()=>{
 if(!prepared||!prepared.entries.length||prepared.school!==schoolPicker.value){
  bulkSay('تغيّرت المدرسة أو المعاينة. أعد الفحص.',true);bulkReset();return;
 }
 if(!await askBulk(prepared.entries.length))return;
 const entries=prepared.entries;prepared=null;bulkCreate.disabled=true;
 bulkResults.replaceChildren();let created=0,failed=0;
 for(const row of entries){
  try{
   const id=await api('/api/school/invitations','POST',{
     school_id:schoolPicker.value,profile_id:row.profile_id,email:row.email,mode:row.mode});
   const p=node('p','رقم الموظف '+row.number+': ');
   p.append(mailLink(row.email,id));bulkResults.append(p);created++;
  }catch(e){failed++;bulkResults.append(node('p','رقم الموظف '+row.number+': '+e.message));}
 }
 bulkSay('أُنشئت '+created+' دعوة، وتعذرت '+failed+'. لم تُرسل رسائل بريد آليًا؛ استخدم روابط الإرسال بجوار كل موظف.',failed>0);
 await refresh();
});


for(const tab of document.querySelectorAll('[data-personnel-tab]')){
 if(tab.dataset.personnelTab==='invitations')tab.addEventListener('click',refresh);
}
})();