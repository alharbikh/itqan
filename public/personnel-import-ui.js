import {validatePersonnelCsv,MAX_BYTES} from '/personnel-import-csv.js';
const $=id=>document.getElementById(id);
const form=$('personnel-import-form');
if(form){
  let preview=null;
  const notice=(value,failed=true,action=false)=>{
    const target=$(action?'personnel-import-action-message':'personnel-import-message');
    if(!target)return;
    target.textContent=value;target.className='alert '+(failed?'error':'success');target.hidden=false;
  };
  const cell=(row,value)=>{
    const td=document.createElement('td');td.textContent=String(value??'');row.append(td);
  };
  const updateYears=()=>{
    const source=$('personnel-direct-year'),target=$('personnel-import-year');
    const old=target.value;target.replaceChildren(new Option('اختر العام الدراسي',''));
    for(const opt of source.options)if(opt.value)target.add(new Option(opt.textContent,opt.value));
    if(Array.from(target.options).some(o=>o.value===old))target.value=old;
    else if(target.options.length===2)target.selectedIndex=1;
  };
  const refresh=()=>{
    preview=null;$('personnel-import-commit').disabled=true;
    $('personnel-import-summary').hidden=true;
  };
  function ask(question){
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.className='itqan-confirm-dialog';
      dialog.setAttribute('dir','rtl');dialog.setAttribute('aria-label','اعتماد استيراد الموظفين');
      const p=document.createElement('p');p.textContent=question;
      const actions=document.createElement('div');actions.className='itqan-confirm-actions';
      const cancel=document.createElement('button');cancel.type='button';cancel.textContent='إلغاء';
      const yes=document.createElement('button');yes.type='button';yes.textContent='تأكيد';
      for(const b of [cancel,yes])b.className='itqan-confirm-button';
      actions.append(cancel,yes);dialog.append(p,actions);document.body.append(dialog);
      let done=false;const finish=v=>{if(done)return;done=true;dialog.close();dialog.remove();resolve(v);};
      cancel.onclick=()=>finish(false);yes.onclick=()=>finish(true);
      dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});
      dialog.addEventListener('close',()=>finish(false));
      dialog.showModal();cancel.focus();
    });
  }
  const errors={
    column_count:'عدد الأعمدة مختلف',
    full_name:'الاسم غير صالح',
    employee_number:'رقم الموظف غير صالح',
    national_id_format:'صيغة الهوية غير صحيحة',
    school_year:'العام الدراسي ناقص',
    school_year_mismatch:'العام الدراسي مختلف',
    email_format:'البريد غير صالح',
    duplicate_employee_number_in_file:'رقم الموظف مكرر في الملف',
    duplicate_national_id_in_file:'رقم الهوية مكرر في الملف'
  };
  $('personnel-import-section').addEventListener('toggle',()=>{
    if($('personnel-import-section').open)updateYears();
  });
  $('personnel-import-file').addEventListener('change',refresh);
  $('personnel-import-year').addEventListener('change',refresh);
  $('school-picker').addEventListener('change',refresh);
  $('personnel-import-preview').addEventListener('click',async()=>{
    refresh();
    const file=$('personnel-import-file').files?.[0],year=$('personnel-import-year');
    if(!file||!year.value){notice('اختر ملف CSV والعام الدراسي.');return;}
    if(file.size>MAX_BYTES){notice('حجم الملف أكبر من الحد المسموح (1MB).');return;}
    const school=$('school-picker').value;
    if(!school){notice('اختر المدرسة أولًا.');return;}
    try{
      const text=await file.text();
      const parsed=validatePersonnelCsv(text);
      const expected=year.selectedOptions[0].textContent.trim();
      for(const r of parsed.rows){
        if(!expected.includes(r.data.school_year||'')){
          r.errors.push('school_year_mismatch');r.valid=false;
        }
      }
      const valid=parsed.rows.filter(r=>r.valid);
      const invalid=parsed.rows.length-valid.length;
      const table=$('personnel-import-rows');table.replaceChildren();
      for(const r of parsed.rows.slice(0,50)){
        const tr=document.createElement('tr');
        cell(tr,r.row);cell(tr,r.data.full_name);cell(tr,r.data.employee_number);
        cell(tr,r.valid?'صالح':r.errors.map(e=>errors[e]||e).join('، '));table.append(tr);
      }
      $('personnel-import-counts').textContent='الإجمالي: '+parsed.rows.length+'، صالح: '+valid.length+
        '، يحتاج تصحيحًا: '+invalid+'. المعروض أول 50 صفًا.';
      preview={school,year:year.value,rows:valid.map(r=>({
        full_name:r.data.full_name,employee_number:r.data.employee_number,
        national_id:r.data.national_id,specialization:r.data.specialization||null,
        job_title_id:null
      }))};
      $('personnel-import-summary').hidden=false;
      $('personnel-import-commit').disabled=!valid.length;
      notice(invalid?'تم الفحص؛ صحح الصفوف غير الصالحة أو اعتمد الصفوف الصالحة فقط.':'اكتملت معاينة الملف دون حفظ.',false);
    }catch(e){notice(e.message||'تعذرت قراءة الملف.');}
  });
  $('personnel-import-commit').addEventListener('click',async()=>{
    if(!preview||!preview.rows.length)return;
    if(preview.school!==$('school-picker').value||
       preview.year!==$('personnel-import-year').value){
      notice('تغيّرت المدرسة أو السنة، أعد معاينة الملف.');refresh();return;
    }
    const proceed=await ask('سيتم إنشاء ملفات الموظفين الصالحة فقط دون حسابات دخول، على دفعات تصل إلى 50 سجلًا. هل تؤكد؟');
    if(!proceed)return;
    const b=$('personnel-import-commit');b.disabled=true;
    let created=0,skipped=0;
    try{
      for(let i=0;i<preview.rows.length;i+=50){
        const response=await fetch('/api/personnel/bulk-import',{
          method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},
          body:JSON.stringify({school_id:preview.school,year_id:preview.year,rows:preview.rows.slice(i,i+50)})
        });
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw Error(data.error||'تعذرت دفعة الاستيراد.');
        created+=Number(data.result?.created||0);skipped+=Number(data.result?.skipped||0);
        notice('جاري الاستيراد: أُنشئ '+created+'، موجود مسبقًا '+skipped+'.',false,true);
      }
      notice('انتهى استيراد الملفات: جديد '+created+'، موجود دون تغيير '+skipped+'.',false,true);
      preview=null;
      if(window.itqanPersonnelAdmin?.load)await window.itqanPersonnelAdmin.load($('school-picker').value);
    }catch(e){
      notice('توقف الاستيراد بعد إنشاء '+created+' ملفًا وتجاوز '+skipped+
       ' سجلًا موجودًا. الدفعات الناجحة محفوظة، أصلح الخطأ وأعد معاينة الملف: '+e.message,true,true);
    }finally{b.disabled=true;}
  });
}