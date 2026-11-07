import type { PdfTextItem, PdfTextPage } from './pdfText';
import { amountCents } from './money';

export interface PdfVoucherEntry {
  summary:string;
  account:string;
  /** 金额始终保留原列和负号，空白列以 0.00 表示，不把红字移动到另一列。 */
  debit:string;
  credit:string;
  sourcePage:number;
}
export interface ParsedPdfVoucher {
  no:string;period:string;date:string;summary:string;supplier:string;amount:string;
  expectedAttachments?:number;company:string;sourcePages:number[];
  entries:PdfVoucherEntry[];reviewReasons:string[];debitTotal:string;creditTotal:string;
}
interface PrintedVoucherPage {
  no:string;date:string;company:string;partIndex:number;partCount:number;
  sourcePage:number;entries:PdfVoucherEntry[];debitTotal:string;creditTotal:string;
  expectedAttachments?:number;
}
const compact=(text:string)=>text.normalize('NFKC').replace(/\s/g,'');
const moneyPattern=/^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{2})$/;
const centsText=(cents:number)=>(cents/100).toFixed(2);
const normalizedAmount=(text:string)=>centsText(amountCents(compact(text)));

/** 基于文字坐标恢复行。仅用于字段/表头定位，金额仍从各自列读取。 */
function lines(items:PdfTextItem[]):PdfTextItem[] {
 const rows:{y:number;items:PdfTextItem[]}[]=[];
 for(const item of [...items].sort((a,b)=>b.y-a.y||a.x-b.x)){
  let row=rows.find(existing=>Math.abs(existing.y-item.y)<=2);
  if(!row){row={y:item.y,items:[]};rows.push(row);}row.items.push(item);
 }
 return rows.map(row=>{
  const cells=row.items.sort((a,b)=>a.x-b.x);const first=cells[0]!;
  return {text:cells.map(cell=>cell.text).join(' '),x:first.x,y:row.y,width:Math.max(...cells.map(cell=>cell.x+cell.width))-first.x,height:Math.max(...cells.map(cell=>cell.height))};
 });
}
function header(items:PdfTextItem[],name:string):PdfTextItem|undefined {
 // PDF 内容流可能把一个标题拆成多个字，先找完整单元，随后允许同一行的小间隙拼合。
 const direct=items.find(item=>compact(item.text)===name);if(direct)return direct;
 for(const first of items){
  const row=items.filter(item=>Math.abs(item.y-first.y)<=2&&item.x>=first.x).sort((a,b)=>a.x-b.x);
  let text='';let right=first.x;
  for(const item of row){if(item.x-right>Math.max(item.height,8))break;text+=compact(item.text);right=item.x+item.width;
   if(text===name)return {...first,text:name,width:right-first.x};if(text.length>=name.length)break;
  }
 }
 return undefined;
}
function parsePage(page:PdfTextPage):PrintedVoucherPage|undefined {
 const visual=lines(page.items);const joined=visual.map(line=>line.text).join('\n');
 const noMatch=joined.match(/凭证号\s*[：:]\s*([^\s：:]+)\s*[-－—]\s*(\d+)(?:\s+(\d+)\s*\/\s*(\d+))?/);
 if(!noMatch)return undefined;
 const dateMatch=joined.match(/日期\s*[：:]\s*(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
 if(!dateMatch)throw new Error(`PDF 第 ${page.pageNumber} 页：凭证日期未识别，请改用结构化导入或补录`);
 const date=`${dateMatch[1]}-${dateMatch[2]!.padStart(2,'0')}-${dateMatch[3]!.padStart(2,'0')}`;
 const no=`${noMatch[1]}-${noMatch[2]}`;
 const debitHead=header(page.items,'借方金额'),creditHead=header(page.items,'贷方金额');
 const accountHead=header(page.items,'科目'),summaryHead=header(page.items,'摘要');
 const totalLine=visual.find(line=>/^合计[：:]/.test(compact(line.text)));
 if(!debitHead||!creditHead||!accountHead||!summaryHead||!totalLine)throw new Error(`PDF 第 ${page.pageNumber} 页（${no}）：分录表头或合计行未能完整识别`);
 const moneyItems=page.items.filter(item=>item.x>=debitHead.x-12&&moneyPattern.test(compact(item.text)));
 const middle=(debitHead.x+debitHead.width/2+creditHead.x+creditHead.width/2)/2;
 const isDebit=(item:PdfTextItem)=>item.x+item.width/2<middle;
 const totalAmounts=moneyItems.filter(item=>Math.abs(item.y-totalLine.y)<=3);
 const debitTotal=totalAmounts.filter(isDebit),creditTotal=totalAmounts.filter(item=>!isDebit(item));
 if(debitTotal.length!==1||creditTotal.length!==1)throw new Error(`PDF 第 ${page.pageNumber} 页（${no}）：借贷合计金额缺失或有歧义，请核对原件`);
 const body=page.items.filter(item=>item.y<Math.min(debitHead.y,creditHead.y)-3&&item.y>totalLine.y+8);
 // 会计科目代码定位行，避免把摘要里的数量、四位小数单价误认为凭证金额。
 const accountLeft=accountHead.x-(accountHead.x-summaryHead.x)*0.65;
 const accounts=body.filter(item=>item.x>=accountLeft&&item.x<debitHead.x-12&&/^\d{4,}\s+\S/.test(item.text.trim())).sort((a,b)=>b.y-a.y);
 if(!accounts.length)throw new Error(`PDF 第 ${page.pageNumber} 页（${no}）：未识别到会计分录，不能只取合计导入`);
 const entries:PdfVoucherEntry[]=accounts.map((account,index)=>{
  const next=accounts[index+1];
  const summaryItems=body.filter(item=>item.x<accountLeft&&item.y<=account.y+3&&item.y>(next?next.y+3:totalLine.y+8)).sort((a,b)=>b.y-a.y||a.x-b.x);
  const rowAmounts=moneyItems.filter(item=>item.y>totalLine.y+8&&accounts.reduce((closest,candidate)=>Math.abs(candidate.y-item.y)<Math.abs(closest.y-item.y)?candidate:closest,accounts[0]!)===account);
  const debits=rowAmounts.filter(isDebit),credits=rowAmounts.filter(item=>!isDebit(item));
  if(debits.length>1||credits.length>1||(!debits.length&&!credits.length))throw new Error(`PDF 第 ${page.pageNumber} 页（${no}）：科目 ${account.text} 的借贷金额不能唯一定位`);
  return {summary:summaryItems.map(item=>item.text).join(''),account:account.text.trim(),debit:debits[0]?normalizedAmount(debits[0].text):'0.00',credit:credits[0]?normalizedAmount(credits[0].text):'0.00',sourcePage:page.pageNumber};
 });
 // 单位与日期通常共用一行；限制到日期单元左侧，避免把日期/凭证号拼进企业名称。
 const companyItem=page.items.find(item=>/^单位\s*[：:]/.test(item.text));
 const dateItem=page.items.find(item=>/^日期\s*[：:]/.test(item.text));
 const company=companyItem?page.items.filter(item=>Math.abs(item.y-companyItem.y)<=2&&item.x>=companyItem.x&&(!dateItem||item.x<dateItem.x)).sort((a,b)=>a.x-b.x).map(item=>item.text).join('').replace(/^单位\s*[：:]\s*/,'').trim():'';
 const attachmentMatch=joined.match(/附单据\s*(\d+)\s*张/);
 return {no,date,company,partIndex:Number(noMatch[3]||1),partCount:Number(noMatch[4]||1),sourcePage:page.pageNumber,entries,debitTotal:normalizedAmount(debitTotal[0]!.text),creditTotal:normalizedAmount(creditTotal[0]!.text),expectedAttachments:attachmentMatch?Number(attachmentMatch[1]):undefined};
}

/**
 * 解析文字型记账凭证：按“单位 + 日期 + 凭证号”合并连续续页。
 * 续页合计是累计金额，所以只取最后一页打印合计；逐行分录仅累加一次并以整数分校验。
 */
export function parseVoucherPages(pages:PdfTextPage[]):ParsedPdfVoucher[] {
 const groups:{key:string;pages:PrintedVoucherPage[]}[]=[];
 for(const page of [...pages].sort((a,b)=>a.pageNumber-b.pageNumber)){
  const parsed=parsePage(page);if(!parsed)continue;
  const key=`${parsed.company}/${parsed.date}/${parsed.no}`;let group=groups.find(item=>item.key===key);
  if(!group){group={key,pages:[]};groups.push(group);}
  group.pages.push(parsed);
 }
 return groups.map(group=>{
  const parts=group.pages.sort((a,b)=>a.partIndex-b.partIndex||a.sourcePage-b.sourcePage);const first=parts[0]!,last=parts[parts.length-1]!;
  const reasons:string[]=[];const entries=parts.flatMap(part=>part.entries);
  if(parts.length!==first.partCount||parts.some((part,index)=>part.partCount!==first.partCount||part.partIndex!==index+1))reasons.push('凭证续页页码缺失、重复或不连续，请核对原件');
  const debitSum=entries.reduce((sum,entry)=>sum+amountCents(entry.debit),0),creditSum=entries.reduce((sum,entry)=>sum+amountCents(entry.credit),0);
  const debitTotal=amountCents(last.debitTotal),creditTotal=amountCents(last.creditTotal);
  if(debitSum!==creditSum||debitSum!==debitTotal||creditSum!==creditTotal)reasons.push('原始分录合计与最终借贷合计不一致，请人工核对');
  if(debitTotal===0)reasons.push('零净额凭证，需按原始正负分录人工复核');
  if(debitTotal<0)reasons.push('负净额凭证，需人工复核红字业务');
  if(entries.some(entry=>amountCents(entry.debit)<0||amountCents(entry.credit)<0))reasons.push('含红字或负数分录，已保留原借贷列和负号');
  // 往来辅助核算名称是客商证据；本企业抬头及“待抵扣”等内部核算项不能充当客商。
  const parties=[...new Set(entries.flatMap(entry=>{
   const match=entry.account.match(/_[^.\s]+\.(.+)$/);const name=match?.[1]?.trim();
   return name&&!/^(待抵扣|暂估|其他|内部往来)$/.test(name)&&name!==first.company?[name]:[];
  }))];
  const supplier=parties.length===1?parties[0]!:'';
  if(!parties.length)reasons.push('未发现明确外部客商；内部结转等凭证请按业务复核');
  if(parties.length>1)reasons.push(`包含 ${parties.length} 个往来客商，不能自动指定单一客商`);
  if(parties.some(party=>/有限公$|有限责任公$/.test(party)))reasons.push('客商名称在原件中可能被截断，请核验完整名称');
  const counts=[...new Set(parts.flatMap(part=>part.expectedAttachments===undefined?[]:[part.expectedAttachments]))];
  if(!counts.length)reasons.push('原件附件数为空，请核对实际附件数量');
  if(counts.length>1)reasons.push('续页附件数不一致，请人工核对');
  return {no:first.no,date:first.date,period:first.date.slice(0,7),company:first.company,supplier,summary:[...new Set(entries.map(entry=>entry.summary).filter(Boolean))].join('；'),amount:last.debitTotal,debitTotal:last.debitTotal,creditTotal:last.creditTotal,expectedAttachments:counts.length===1?counts[0]:undefined,sourcePages:parts.map(part=>part.sourcePage),entries,reviewReasons:reasons};
 });
}
