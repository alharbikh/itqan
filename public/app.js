// Browser presentation layer: all account state is read from Cloudflare endpoints.
const $ = id => document.getElementById(id);
const show = (message, type = 'info') => {
  const target = $('message');
  if (!target) return;
  target.textContent = message;
  target.className = 'alert ' + type;
  target.hidden = false;
};
async function call(path, method = 'GET', data) {
  const response = await fetch(path, {
    method, credentials: 'same-origin',
    ...(data === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }),
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(payload.error || 'Request failed', { cause: response.status });
  return payload;
}
async function init() {
  const view = document.body.dataset.view;
  if(view==='recover'){
    const requestForm=$('recovery-request-form'),complete=$('recovery-complete-form');
    requestForm.addEventListener('submit',async e=>{
      e.preventDefault();const button=requestForm.querySelector('button[type="submit"]');button.disabled=true;
      try{
        const result=await call('/api/password/recovery/request','POST',{email:$('email').value.trim()});
        show(result.message,'success');
      }catch(error){show(error.message||'تعذر إرسال الطلب.','error')}
      finally{button.disabled=false;}
    });
    complete.addEventListener('submit',async e=>{
      e.preventDefault();
      if($('password').value!==$('password-confirm').value){show('تأكيد كلمة المرور لا يطابق الكلمة الجديدة.','error');return}
      const button=complete.querySelector('button[type="submit"]');button.disabled=true;
      try{
        await call('/api/password/recovery/complete','POST',
          {email:$('email').value.trim(),code:$('code').value.trim(),password:$('password').value});
        location.replace('/login.html?password_updated=1');
      }catch(error){show(error.message||'تعذر إكمال الاستعادة.','error')}
      finally{button.disabled=false;}
    });
    return;
  }
  if(view==='password'){
    let mustChange=false,role=null;
    try{
      const result=await call('/api/session');mustChange=result.user.mustChangePassword===true;role=result.user.role;
      if(mustChange){
        $('current-password-label').firstChild.textContent='كلمة المرور المؤقتة';
        $('password-guidance').textContent='أدخل كلمة المرور المؤقتة التي تسلمتها، ثم أنشئ كلمة مرور جديدة قبل استخدام المنصة.';
      }
      $('current-password').required=true;
    }catch{show('يلزم تسجيل الدخول أولًا لتغيير كلمة المرور.','error');
      $('password-change-form').hidden=true;return}
    $('password-change-form').addEventListener('submit',async e=>{
      e.preventDefault();
      if($('password').value!==$('password-confirm').value){show('تأكيد كلمة المرور لا يطابق كلمة المرور الجديدة.','error');return}
      const button=e.currentTarget.querySelector('button[type="submit"]');button.disabled=true;
      try{
        await call('/api/password/change','POST',{password:$('password').value,
          current_password:$('current-password').value});
        $('password-change-form').reset();
        location.replace('/login.html?password_updated=1');
      }catch(error){show(error.message||'تعذر تغيير كلمة المرور.','error')}
      finally{button.disabled=false;}
    });
    return;
  }
  if (view === 'login' || view === 'register') {
    if(view==='login'&&new URLSearchParams(location.search).get('password_updated')==='1')
      show('تم تحديث كلمة المرور بنجاح. سجّل الدخول بكلمة المرور الجديدة.','success');
    const form = $('account-form');
    form?.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      const password = $('password').value;
      const email = $('email').value.trim();
      submit.disabled = true;
      try {
        if (view === 'register') {
          await call('/api/register', 'POST', { name: $('name').value.trim(), email, password });
          form.reset();
          show('تم استلام التسجيل. تحقّق من بريدك الإلكتروني وانتظر اعتماد العضوية.', 'success');
        } else {
          const result = await call('/api/login', 'POST', { email, password });
          if(result.user.mustChangePassword){location.assign('/password.html');return;}
          const next=new URLSearchParams(location.search).get('next');
          const permitted=['/admin.html','/frameworks.html','/school.html','/performance.html','/link.html'];
          window.location.assign(permitted.includes(next)?next:
            result.user.role === 'site_admin' ? '/admin.html' :
            result.user.schoolMemberships?.length ? '/school.html' : '/link.html');
        }
      } catch (error) {
        show(error.message || (view === 'login' ? 'تعذّر تسجيل الدخول.' :
          'تعذّر إنشاء الحساب.'),'error');
      } finally { submit.disabled = false; }
    });
    return;
  }
  if (view === 'admin' || view === 'school') {
    try {
      const { user } = await call('/api/session');
      if (view === 'admin' && user.role !== 'site_admin') {
        show('هذا الحساب غير مخول لإدارة الموقع.', 'error');
        return;
      }
      if (view === 'school' && user.role !== 'site_admin' && user.schoolMemberships.length === 0) {
        show('لم تُعتمد عضوية مدرسة لهذا الحساب بعد.', 'error');
        return;
      }
      $('welcome').textContent = user.name;
      const { schools } = await call('/api/schools');
      const list = $('schools');
      list.replaceChildren();
      if (!schools?.length) {
        const li = document.createElement('li');
        li.textContent = 'لا توجد مدارس متاحة للحساب حاليًا.';
        list.appendChild(li);
      } else {
        for (const school of schools) {
          const li = document.createElement('li');
          li.textContent = school.name + (school.education_department ? ' — ' + school.education_department : '');
          list.appendChild(li);
        }
      }
      $('workspace').hidden = false;
    } catch {
      show('تعذر التحقق من الجلسة أو قراءة المدارس المصرح بها.', 'error');
    }
    $('logout')?.addEventListener('click', async () => {
      try { await call('/api/logout', 'POST', {}); } finally { location.replace('/login.html'); }
    });
  }
}
document.addEventListener('DOMContentLoaded', init);
