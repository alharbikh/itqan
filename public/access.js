(() => {
'use strict';
const body=document.body;
const allowed=new Set(['login','forbidden','membership','unavailable']);
let reason=body.dataset.accessState;
if(!allowed.has(reason)){
 try{
  reason=sessionStorage.getItem('itqan_access_state')||'unavailable';
  sessionStorage.removeItem('itqan_access_state');
 }catch{reason='unavailable';}
}
if(!allowed.has(reason))reason='unavailable';
const messages={
 login:{eyebrow:'تسجيل الدخول مطلوب',title:'يرجى تسجيل الدخول أولًا',
   message:'سجّل الدخول للمتابعة.',label:'تسجيل الدخول',href:'/login.html'},
 forbidden:{eyebrow:'وصول غير مصرح به',title:'ليس لديك صلاحية للوصول',
   message:'',label:'تسجيل الدخول بحساب آخر',href:'/login.html'},
 membership:{eyebrow:'ارتباط المدرسة مطلوب',title:'يلزم ربط حسابك بمدرسة',
   message:'',label:'طلب ربط الحساب',href:'/link.html'},
 unavailable:{eyebrow:'تعذر التحقق من الوصول',title:'تعذر فتح الصفحة حاليًا',
   message:'حاول مرة أخرى لاحقًا.',label:'تسجيل الدخول',href:'/login.html'}
};
const data=messages[reason];
body.dataset.accessState=reason;
document.getElementById('access-eyebrow').textContent=data.eyebrow;
document.getElementById('access-title').textContent=data.title;
const description=document.getElementById('access-message');
description.textContent=data.message;description.hidden=!data.message;
const primary=document.getElementById('access-primary');
primary.textContent=data.label;primary.href=data.href;
document.getElementById('access-back').addEventListener('click',()=>{
 if(history.length>1)history.back();
 else location.assign('/index.html');
});
})();
