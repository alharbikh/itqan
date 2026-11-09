(()=>{'use strict';const $=id=>document.getElementById(id);
let user=null;
function notice(text,type='info'){$('message').textContent=text;$('message').className='alert '+type;$('message').hidden=false;}
async function api(path,method='GET',body){const r=await fetch(path,{method,credentials:'same-origin',
 ...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'تعذر تنفيذ الطلب');return d;}
async function refresh(){
 const data=await Promise.all([api('/api/session'),api('/api/school/link-requests')]);
 user=data[0].user;
 const target=$('requests');target.replaceChildren();
 for(const request of data[1].requests||[]){
  const div=document.createElement('div');div.className='perf-item';
  div.textContent='المدرسة: '+request.school_id+' — حالة الطلب: '+request.status+
    ' — التاريخ: '+new Date(request.requested_at).toLocaleDateString('ar-SA');
  target.append(div);
 }
 if(!target.children.length){const d=document.createElement('div');d.className='perf-note';d.textContent='لا توجد طلبات سابقة.';target.append(d);}
 const membership=user.schoolMemberships?.[0];
 $('active-panel').hidden=!membership;
 if(membership){$('active-school').textContent='المدرسة المرتبطة: '+membership.school_id;
  $('request-form').hidden=true;}else $('request-form').hidden=false;
}
$('request-form').addEventListener('submit',async e=>{e.preventDefault();
 try{await api('/api/school/link-request','POST',{school_employee_id:$('school-employee-id').value.trim()});
 notice('أُرسل الطلب لمدير المدرسة لمراجعة الهوية','success');$('request-form').reset();await refresh();}
 catch(err){notice(err.message,'error');}});
$('unlink-form').addEventListener('submit',async e=>{e.preventDefault();
 if(!confirm('سيُفك ارتباطك بالمدرسة الحالية مع الحفاظ على سجلاتها التاريخية. هل تؤكد؟'))return;
 try{await api('/api/school/unlink','POST',{school_id:user.schoolMemberships[0].school_id,
 user_id:user.id,reason:$('reason').value.trim()});
 notice('تم فك الارتباط','success');await refresh();}
 catch(err){notice(err.message,'error');}});
document.addEventListener('DOMContentLoaded',()=>refresh().catch(e=>notice(e.message,'error')));
})();