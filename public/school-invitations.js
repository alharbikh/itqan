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
let school='',profileMap=new Map();
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
  const selector=$('school-invite-profile');selector.replaceChildren(new Option('اختر ملفًا وظيفيًا معتمدًا',''));
  for(const [id,label] of profileMap)selector.add(new Option(label,id));
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
for(const tab of document.querySelectorAll('[data-personnel-tab]')){
 if(tab.dataset.personnelTab==='invitations')tab.addEventListener('click',refresh);
}
})();