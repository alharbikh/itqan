(()=>{'use strict';
const $=id=>document.getElementById(id);
const message=(value,type='error')=>{const b=$('message');b.textContent=value;b.className='alert '+type;b.hidden=false;};
async function api(path,method='GET',data){
 const r=await fetch(path,{method,credentials:'same-origin',
  ...(data?{headers:{'content-type':'application/json'},body:JSON.stringify(data)}:{})});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'تعذر تحميل البيانات.');return d;
}
async function load(){
 const d=await api('/api/evidence/personal');const list=$('evidence-list');list.replaceChildren();
 for(const item of d.evidence||[]){const li=document.createElement('li');
 const name=document.createElement('strong');name.textContent=item.title;
 li.append(name);if(item.description){const detail=document.createElement('p');detail.textContent=item.description;li.append(detail);}
 list.append(li);}
 if(!list.children.length){const li=document.createElement('li');li.textContent='لا توجد شواهد شخصية بعد.';list.append(li);}
}
load().catch(e=>message(e.message.includes('تسجيل')?e.message:'سجل الدخول لعرض شواهدك الشخصية.'));
$('evidence-form').addEventListener('submit',async e=>{
 e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;
 try{await api('/api/evidence/personal','POST',{title:$('evidence-title').value.trim(),
  description:$('evidence-description').value.trim(),link_url:$('evidence-link').value.trim()});
  $('evidence-form').reset();message('تم حفظ الشاهد الشخصي.','success');await load();}
 catch(err){message(err.message);}finally{b.disabled=false;}
});
})();