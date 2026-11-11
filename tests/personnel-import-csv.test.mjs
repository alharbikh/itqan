import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,validatePersonnelCsv,MAX_BYTES} from '../src/personnel-import-csv.js';

const header='الاسم الكامل,رقم الموظف,رقم السجل المدني,العام الدراسي,البريد الإلكتروني';
const row='أحمد محمد,0012,1234567890,1448,ahmed@example.org';
test('Arabic CSV preserves leading zeros and privacy-safe preview',()=>{
  const result=validatePersonnelCsv(header+'\n'+row);
  assert.equal(result.summary.valid,1);
  assert.equal(result.rows[0].data.employee_number,'0012');
  assert.equal(result.rows[0].data.national_id,'1234567890');
});
test('quoted delimiters and escaped quotes are handled',()=>{
  const rows=parseCsv('name,number\n"أحمد, ""أ""",0012');
  assert.equal(rows[1][0],'أحمد, "أ"');
});
test('semicolon separated spreadsheets are accepted',()=>{
  assert.equal(parseCsv('a;b\n1;2')[1][1],'2');
});
test('duplicate employee numbers and identities are rejected within file',()=>{
  const result=validatePersonnelCsv(header+'\n'+row+'\nخالد محمد,0012,1234567890,1448,');
  assert.deepEqual(result.rows[1].errors.filter(x=>x.startsWith('duplicate_')),
    ['duplicate_employee_number_in_file','duplicate_national_id_in_file']);
});
test('invalid identity and email are rejected',()=>{
  const result=validatePersonnelCsv(header+'\nأحمد محمد,10,123,1448,invalid');
  assert.deepEqual(result.rows[0].errors,['national_id_format','email_format']);
});
test('missing headers and duplicate aliases fail closed',()=>{
  assert.throws(()=>validatePersonnelCsv('الاسم الكامل,رقم الموظف\nX,1'),/أعمدة/);
  assert.throws(()=>validatePersonnelCsv(header+',email\n'+row+',a@b.org'),/مكررة/);
});
test('unbalanced quotes and excess bytes/rows fail closed',()=>{
  assert.throws(()=>parseCsv('a\n"broken'),/مغلقة/);
  assert.throws(()=>parseCsv('x'.repeat(MAX_BYTES+1)),/حجم/);
  assert.throws(()=>parseCsv('a\nb\nc',{maxRows:1}),/صفوف/);
});
test('empty input produces a non-writing empty preview',()=>{
  assert.equal(validatePersonnelCsv('').summary.total,0);
});
