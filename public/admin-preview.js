/* Review-only rendering: no network, no account state, no writes. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let mode = 'expanded';
  const media = matchMedia('(max-width:760px)');
  const titles = {
    overview:'لوحة المعلومات',schools:'المدارس',users:'المستخدمون',
    permissions:'الأدوار والصلاحيات',settings:'إعدادات المنصة',
  };
  function renderNavigation() {
    for (const value of ['expanded','icons','hidden']) {
      document.body.classList.toggle('nav-'+value,mode===value);
    }
    const opened = document.body.classList.contains('nav-mobile-open');
    $('admin-scrim').hidden = !opened;
    $('nav-toggle').setAttribute('aria-expanded', String(media.matches ? opened : mode!=='hidden'));
    $('nav-toggle').title = media.matches ? (opened?'إغلاق القائمة':'فتح القائمة') : ({
      expanded:'عرض الأيقونات فقط',icons:'إخفاء القائمة',hidden:'إظهار القائمة كاملة',
    })[mode];
  }
  function cycle() {
    if (media.matches) {
      document.body.classList.toggle('nav-mobile-open');
    } else {
      mode = {expanded:'icons',icons:'hidden',hidden:'expanded'}[mode];
    }
    renderNavigation();
  }
  function navigate(target) {
    if (!titles[target]) return;
    for (const section of Object.keys(titles)) {
      $('section-'+section).hidden = section!==target;
    }
    for (const button of document.querySelectorAll('.admin-menu-item')) {
      const active=button.dataset.section===target;
      button.classList.toggle('is-active',active);
      if(active) button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    }
    $('top-current-page').textContent = titles[target];
    document.body.classList.remove('nav-mobile-open');
    renderNavigation();
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('top-user-name').textContent = '';
    $('stat-schools').textContent = '—';
    $('stat-active').textContent = '—';
    $('stat-users').textContent = '—';
    $('stat-connection').textContent = 'معاينة';
    $('schools-count').textContent = 'لا توجد بيانات في المعاينة';
    $('overview-schools').textContent = 'لن تُعرض بيانات مدارس أو حسابات فعلية في هذه المعاينة.';
    for(const [id,cols] of [['schools-body',6],['users-body',3]]) {
      const tr=document.createElement('tr');
      const td=document.createElement('td');
      td.className='empty-row';
      td.colSpan=cols;
      td.textContent='معاينة تصميم فقط — دون بيانات حقيقية أو تجريبية.';
      tr.append(td);
      $(id).replaceChildren(tr);
    }
    $('schools-search').addEventListener('input',()=>{});
    $('nav-toggle').addEventListener('click',cycle);
    $('settings-cycle-nav').addEventListener('click',cycle);
    $('admin-scrim').addEventListener('click',()=>{
      document.body.classList.remove('nav-mobile-open');renderNavigation();
    });
    for(const btn of document.querySelectorAll('.admin-menu-item')) {
      btn.addEventListener('click',()=>navigate(btn.dataset.section));
    }
    for(const btn of document.querySelectorAll('[data-go]')) {
      btn.addEventListener('click',()=>navigate(btn.dataset.go));
    }
    $('add-school').addEventListener('click',()=>{
      $('school-dialog-heading').textContent = 'نموذج إضافة مدرسة — معاينة';
      $('school-form').reset();
      $('school-dialog').showModal();
    });
    $('save-school').disabled=true;
    $('save-school').textContent='الحفظ معطّل في المعاينة';
    $('school-form').addEventListener('submit',event=>event.preventDefault());
    $('close-school').addEventListener('click',()=>$('school-dialog').close());
    $('cancel-school').addEventListener('click',()=>$('school-dialog').close());
    $('refresh-overview').disabled=true;
    $('refresh-overview').title='المعاينة غير متصلة بالبيانات';
    media.addEventListener('change',()=>{
      document.body.classList.remove('nav-mobile-open');renderNavigation();
    });
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape') {
        document.body.classList.remove('nav-mobile-open');renderNavigation();
      }
    });
    renderNavigation();
  });
})();