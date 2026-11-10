(() => {
'use strict';
const params=new URLSearchParams(location.search);
const sections={
 admin:['لوحة مدير الموقع','/admin.html'],
 frameworks:['إدارة المعايير والأوزان','/frameworks.html'],
 school:['مساحة المدرسة','/school.html'],
 performance:['الأداء الوظيفي والشواهد','/performance.html'],
 link:['ربط الحساب بالملف الوظيفي','/link.html'],
};
const targets={
 login:{
  eyebrow:'تسجيل الدخول مطلوب',title:'يرجى تسجيل الدخول أولًا',
  message:'هذه الصفحة مخصصة للحسابات المسجلة. سجّل الدخول ثم حاول فتح الصفحة مرة أخرى.',
  action:'تسجيل الدخول',help:'لن تظهر البيانات أو الأوامر الخاصة قبل التحقق من الجلسة.'
 },
 forbidden:{
  eyebrow:'صلاحية غير متاحة',title:'ليس لديك إذن لفتح هذه الصفحة',
  message:'حسابك مسجل، لكن الصلاحيات الحالية لا تسمح بعرض هذا القسم أو تنفيذ أوامره.',
  action:'العودة إلى الصفحة الرئيسية',help:'يمكن لمدير الموقع تعديل الصلاحيات المصرح بها، عند الحاجة.'
 },
 membership:{
  eyebrow:'ارتباط المدرسة مطلوب',title:'لا توجد عضوية مدرسة نشطة',
  message:'يلزم اعتماد ارتباط حسابك بمدرسة قبل الدخول إلى هذا القسم.',
  action:'طلب ربط الحساب',help:'تبقى مكتبتك الشخصية للشواهد متاحة حتى دون ارتباط مدرسي.'
 },
 unavailable:{
  eyebrow:'الخدمة غير متاحة مؤقتًا',title:'تعذر التحقق من الجلسة الآن',
  message:'حدث خطأ في الاتصال بخدمة الحسابات. أعد المحاولة بعد التحقق من الاتصال.',
  action:'إعادة المحاولة',help:'لم نعرض بيانات خاصة دون التحقق من الصلاحيات.'
 },
};
const section=Object.hasOwn(sections,params.get('section'))?params.get('section'):'admin';
const reason=Object.hasOwn(targets,params.get('reason'))?params.get('reason'):'forbidden';
const data=targets[reason];
document.getElementById('access-eyebrow').textContent=data.eyebrow;
document.getElementById('access-title').textContent=data.title;
document.getElementById('access-message').textContent=data.message;
document.getElementById('access-destination').textContent='القسم المطلوب: '+sections[section][0];
document.getElementById('access-help').textContent=data.help;
const primary=document.getElementById('access-primary');
primary.textContent=data.action;
primary.href=reason==='login'?'/login.html?next='+encodeURIComponent(sections[section][1]):
 reason==='membership'?'/link.html':reason==='unavailable'?sections[section][1]:'/index.html';
})();
