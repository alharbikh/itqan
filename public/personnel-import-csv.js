// School personnel CSV import preflight. Pure data parser: does not provision users or write data.
export const MAX_ROWS = 2000;
export const MAX_BYTES = 1024 * 1024;
const ALIASES = {
  'الاسم الكامل':'full_name','اسم الموظف':'full_name','full_name':'full_name',
  'رقم الموظف':'employee_number','الرقم الوظيفي':'employee_number','employee_number':'employee_number',
  'رقم الهوية':'national_id','رقم السجل المدني':'national_id','رقم الهوية أو الإقامة':'national_id','national_id':'national_id',
  'المسمى الوظيفي':'job_title','الوظيفة':'job_title','job_title':'job_title',
  'التخصص':'specialization','specialization':'specialization',
  'البريد الإلكتروني':'email','البريد الالكتروني':'email','email':'email',
  'العام الدراسي':'school_year','school_year':'school_year'
};
const REQUIRED=['full_name','employee_number','national_id','school_year'];
function normalize(s){return String(s).replace(/\uFEFF/g,'').trim().toLowerCase();}
export function parseCsv(text,{maxRows=MAX_ROWS}={}){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_BYTES)throw Error('حجم ملف الاستيراد غير صالح.');
  if(!Number.isInteger(maxRows)||maxRows<1||maxRows>MAX_ROWS)throw Error('حد الصفوف غير صالح.');
  const first=text.replace(/^\uFEFF/,'').split(/\r?\n/,1)[0];
  const delimiter=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',';
  const out=[];let line=[],field='',quoted=false,afterQuote=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){
      if(c==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(c==='"'){quoted=false;afterQuote=true;}
      else field+=c;
    }else if(afterQuote){
      if(c===delimiter){line.push(field);field='';afterQuote=false;}
      else if(c==='\r'||c==='\n'){line.push(field);field='';afterQuote=false;if(line.some(x=>x.trim()))out.push(line);line=[];if(c==='\r'&&text[i+1]==='\n')i++;}
      else if(!/\s/.test(c))throw Error('صيغة CSV غير صحيحة بعد علامة الاقتباس.');
    }else if(c==='"'){
      if(field.length)throw Error('صيغة اقتباس غير صحيحة.');quoted=true;
    }else if(c===delimiter){line.push(field);field='';}
    else if(c==='\r'||c==='\n'){
      line.push(field);field='';if(line.some(x=>x.trim()))out.push(line);line=[];
      if(c==='\r'&&text[i+1]==='\n')i++;
    }else field+=c;
    if(out.length>maxRows+1)throw Error('عدد الصفوف تجاوز الحد.');
  }
  if(quoted)throw Error('علامة اقتباس غير مغلقة.');
  line.push(field);if(line.some(x=>x.trim()))out.push(line);
  if(out.length>maxRows+1)throw Error('عدد الصفوف تجاوز الحد.');
  return out;
}
export function validatePersonnelCsv(text,opts={}){
  const raw=parseCsv(text,opts);
  if(!raw.length)return {columns:[],rows:[],summary:{total:0,valid:0,invalid:0}};
  const columns=raw[0].map(x=>ALIASES[normalize(x)]||null);
  if(REQUIRED.some(x=>!columns.includes(x)))throw Error('أعمدة مطلوبة غير موجودة.');
  if(columns.filter(Boolean).some((x,i,a)=>a.indexOf(x)!==i))throw Error('أعمدة مكررة.');
  const numbers=new Set(),identities=new Set();
  const rows=raw.slice(1).map((cells,index)=>{
    const data={};columns.forEach((col,i)=>{if(col)data[col]=String(cells[i]??'').trim();});
    const errors=[];
    if(cells.length!==columns.length)errors.push('column_count');
    if(!data.full_name||data.full_name.length<2||data.full_name.length>200)errors.push('full_name');
    if(!data.employee_number||data.employee_number.length>80)errors.push('employee_number');
    if(!/^\d{10}$/.test(data.national_id||''))errors.push('national_id_format');
    if(!data.school_year)errors.push('school_year');
    if(data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))errors.push('email_format');
    if(data.employee_number&&numbers.has(data.employee_number))errors.push('duplicate_employee_number_in_file');
    if(data.national_id&&identities.has(data.national_id))errors.push('duplicate_national_id_in_file');
    if(data.employee_number)numbers.add(data.employee_number);
    if(data.national_id)identities.add(data.national_id);
    return {row:index+2,data,errors,valid:errors.length===0};
  });
  return {columns,rows,summary:{total:rows.length,valid:rows.filter(x=>x.valid).length,invalid:rows.filter(x=>!x.valid).length}};
}
