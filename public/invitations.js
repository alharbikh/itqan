(()=>{'use strict';
const list=document.getElementById('invitation-list'),message=document.getElementById('invitation-message');
const say=(text,failed=false)=>{message.textContent=text;message.className='alert '+(failed?'error':'success');message.hidden=false;};
const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=String(text??'');return n;};
async function api(path,method='GET',body){
 const r=await fetch(path,{method,credentials:'same-origin',
 ...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
 const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'تعذر تنفيذ الطلب.');
 return data.result??data;
}
async function load(){
 list.replaceChildren();const items=await api('/api/invitations/mine');
 if(!items.length){list.append(el('p','ليس لديك أي دعوات مدرسية معلقة لبريد هذا الحساب.'));return;}
 for(const i of items){
  const article=el('article','');article.className='admin-card';
  article.append(el('h2',i.school_name),el('p','الملف: '+i.profile_name),
    el('p',i.mode==='school'?'حساب مدرسي مستقل':'ربط الحساب الشخصي بموافقتك'),
    el('p','صالحة حتى: '+new Date(i.expires_at).toLocaleDateString('ar-SA')));
  const buttons=el('div','');buttons.className='buttons';
  for(const [accept,label] of [[true,'قبول الانضمام'],[false,'رفض الدعوة']]){
   const b=el('button',label);b.type='button';b.className=accept?'primary':'button';
   b.addEventListener('click',async()=>{
    b.disabled=true;
    try{const result=await api('/api/invitations/decision','POST',{invitation_id:i.id,accept});
     say(accept?'تم قبول الدعوة وتفعيل ارتباطك المدرسي.':'تم رفض الدعوة.');
     if(accept)location.assign('/school.html');else await load();
    }catch(err){say(err.message,true);b.disabled=false;}
   });buttons.append(b);
  }
  article.append(buttons);list.append(article);
 }
}
load().catch(e=>{say('سجّل الدخول ببريد الدعوة المؤكد لعرض الدعوات. '+e.message,true);});
})();