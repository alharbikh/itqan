(()=>{'use strict';
const form=document.getElementById('school-registration-form');
const box=document.getElementById('message');
const message=(value,kind='error')=>{box.textContent=value;box.className='alert '+kind;box.hidden=false;};
async function request(path,method='GET',data){
 const r=await fetch(path,{method,credentials:'same-origin',...(data?{headers:{'content-type':'application/json'},body:JSON.stringify(data)}:{})});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(d.error||'تعذر تنفيذ العملية.');
 return d;
}
request('/api/session').then(({user})=>{
 if(user.schoolMemberships?.length)location.replace('/school.html');
}).catch(()=>location.replace('/login.html?next=/school-registration.html'));
form.addEventListener('submit',async e=>{
 e.preventDefault();
 const button=form.querySelector('button[type="submit"]');
 const body=Object.fromEntries(new FormData(form));
 body.name=body.name.trim();body.ministry_number=body.ministry_number.trim();
 if(!/^[0-9]{1,20}$/.test(body.ministry_number)){message('الرقم الوزاري يجب أن يكون من 1 إلى 20 رقمًا.');return;}
 button.disabled=true;box.hidden=true;
 try{await request('/api/schools/self-register','POST',body);message('تم إنشاء المدرسة وعضويتك مديرًا لها.','success');location.assign('/school.html');}
 catch(err){message(err.message);}
 finally{button.disabled=false;}
});
})();