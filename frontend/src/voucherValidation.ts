import {amountCents} from './money';
export interface FieldIssue {field:string;message:string}
export function inputField(values:Record<string,unknown>,...names:string[]):unknown{return names.map(name=>values[name]).find(v=>v!==undefined&&v!==null&&String(v).trim()!=='');}
/** 收集待补录字段；有 PDF 来源的合法零/负净额可保留，空值与格式错误仍必须修正。 */
export function voucherInputIssues(values:Record<string,unknown>,options:{requireDate?:boolean;allowIncompletePdf?:boolean}={}):FieldIssue[]{
 const issues:FieldIssue[]=[];
 const no=String(inputField(values,'no','voucherNo','VoucherNo','凭证号')??'').trim();
 const period=String(inputField(values,'period','Period','期间')??'').trim();
 const supplier=String(inputField(values,'supplier','supplierName','SupplierName','客商')??'').trim();
 const summary=String(inputField(values,'summary','abstract','Abstract','摘要')??'').trim();
 if(!no)issues.push({field:'no',message:'请填写凭证号'});
 if(!period)issues.push({field:'period',message:'请选择或填写会计期间'});
 else if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))issues.push({field:'period',message:'期间格式应为 YYYY-MM'});
 const dateValue=String(inputField(values,'date','voucherDate','日期')??(!options.requireDate&&period?`${period}-01`:'')).normalize('NFKC').trim().replace(/[年/.]/g,'-').replace(/月/g,'-').replace(/日/g,'');
 if(!dateValue)issues.push({field:'date',message:'请填写凭证日期'});
 else{
  const match=dateValue.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const date=match?`${match[1]}-${match[2]!.padStart(2,'0')}-${match[3]!.padStart(2,'0')}`:'';
  const parsed=new Date(`${date}T00:00:00Z`);
  if(!date||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)issues.push({field:'date',message:'请填写真实日期，格式为 YYYY-MM-DD'});
  else if(period&&!date.startsWith(period))issues.push({field:'date',message:'凭证日期必须属于所选会计期间'});
 }
 if(!summary)issues.push({field:'summary',message:'请填写凭证摘要'});
 if(!supplier&&!options.allowIncompletePdf)issues.push({field:'supplier',message:'请填写客商名称'});
 try{if(amountCents(inputField(values,'amount','Amount','金额'))<=0&&!options.allowIncompletePdf)issues.push({field:'amount',message:'凭证金额须大于 0'});}catch(e){issues.push({field:'amount',message:e instanceof Error?e.message:'请核对金额'});}
 const rawAttachments=inputField(values,'expectedAttachments','expectedAttachmentCount','附件数');
 if(rawAttachments!==undefined){const count=Number(rawAttachments);if(!Number.isInteger(count)||count<1||count>500)issues.push({field:'expectedAttachments',message:'附件数应为 1 至 500 的整数'});}
 return issues;
}
