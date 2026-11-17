/** Export imported text as text, so spreadsheet applications cannot execute formulas. */
export function csvCell(value:unknown):string {
  let text=value===null||value===undefined?'':String(value);
  if(typeof value==='number'){
    if(!Number.isFinite(value))throw new Error('导出金额包含无效数值，请先核对记录');
  }else if(/^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(text.normalize('NFKC'))){
    text="'"+text;
  }
  return '"'+text.replaceAll('"','""')+'"';
}

export function createCsv(rows:readonly (readonly unknown[])[]):string {
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
