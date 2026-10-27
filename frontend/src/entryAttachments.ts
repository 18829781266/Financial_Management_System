import {amountCents} from './money';
import type {EntryAttachment,MatchRule,SourceDocument,Voucher,VoucherEntry} from './types';
import type {RuleEvaluation,RuleMatch} from './matchingEngine';

export const RECEIPT_RULE_ID='R09';
export const ACCOUNT_TAIL_LENGTH=4;
export const RECEIPT_DATE_WINDOW=30;
export function receiptEntryRule():MatchRule {
 return {id:RECEIPT_RULE_ID,name:'金额＋收款账号尾号逐行匹配',description:'回单金额与分录金额完全一致，收款账号或尾号在科目中，日期差严格小于30天；歧义交人工复核',priority:1,enabled:true,threshold:100,tolerance:0,dateWindow:30,matchType:'exact',conditions:{associationScope:'voucher',documentTypes:['bank'],requireAmount:true,requireDate:true}};
}

/** 不把空值、流水号或四位会计科目代码当成收款账号。 */
export function normalizeBankAccount(value:unknown):string {
 if(typeof value!=='string')return '';
 const text=value.normalize('NFKC').trim().replace(/[\s\-‐–—]/g,'');
 if(!/^[\d*Xx•·●]{4,40}$/.test(text))return '';
 const tail=text.match(/\d{4,}$/)?.[0];
 return tail||'';
}
export function subjectAccounts(subject:string):string[] {
 const text=String(subject||'').normalize('NFKC').replace(/^\s*\d{4,}(?:\.\d+)*(?=\s|[\u4e00-\u9fff_])/,'');
 return [...new Set((text.match(/[\d*Xx•·●][\d*Xx•·● -]{2,}[\d*Xx•·●]/g)||[]).map(normalizeBankAccount).filter(Boolean))];
}
export function accountInSubject(payeeAccount:string,subject:string):boolean {
 const receipt=normalizeBankAccount(payeeAccount);
 if(!receipt)return false;
 return subjectAccounts(subject).some(account=>{
  // 双方均保留完整账号时必须一致，不能将尾号偶合的两个完整账号当成一户。
  if(receipt.length>=8&&account.length>=8)return receipt===account;
  const shorter=receipt.length<account.length?receipt:account,longer=receipt.length<account.length?account:receipt;
  return shorter.length>=ACCOUNT_TAIL_LENGTH&&longer.endsWith(shorter);
 });
}
export function entryMoney(entry:VoucherEntry):{cents:number;side:'debit'|'credit'}|undefined {
 try{
  const debit=amountCents(entry.debit),credit=amountCents(entry.credit);
  if(debit>0&&credit===0)return {cents:debit,side:'debit'};
  if(credit>0&&debit===0)return {cents:credit,side:'credit'};
 }catch{/* 无效分录交人工核对，不能丢失小数精度后比较。 */}
 return undefined;
}
export function businessDate(value:string):number {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return NaN;
 const time=Date.parse(`${value}T00:00:00Z`);
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time:NaN;
}
export function requiredReceiptEntries(voucher:Voucher):number[] {
 return (voucher.entries||[]).flatMap((entry,index)=>subjectAccounts(entry.account).length||/^\s*1002/.test(entry.account)||/银行存款|银行账户|结算账户/.test(entry.account)?[index]:[]);
}
export function attachmentCoverage(voucher:Voucher,links:EntryAttachment[]=voucher.entryAttachments||[]):boolean {
 const required=requiredReceiptEntries(voucher);
 return required.length>0&&required.every(index=>links.some(link=>link.entryIndex===index));
}
export function clearReceiptReference(doc:SourceDocument):void {
 if(doc.matchRemark)doc.remarks=(doc.remarks||'').split('\n').filter(line=>line!==doc.matchRemark).join('\n');
 delete doc.matchRemark;delete doc.matchedVoucherId;delete doc.matchedVoucherNo;delete doc.matchedEntryIndex;
}
export function writeReceiptReference(doc:SourceDocument,voucher:Voucher,entryIndex:number):void {
 clearReceiptReference(doc);
 const note=`[关联凭证：${voucher.period} ${voucher.no}，第${entryIndex+1}条分录]`;
 doc.remarks=[doc.remarks?.trim(),note].filter(Boolean).join('\n');
 doc.matchRemark=note;doc.matchedVoucherId=voucher.id;doc.matchedVoucherNo=voucher.no;doc.matchedEntryIndex=entryIndex;
}
export interface EntryMatch extends RuleMatch {entryAttachments:EntryAttachment[];complete:boolean}
export interface EntryEvaluation extends RuleEvaluation {matches:EntryMatch[];documentOutcomes:{documentId:string;reason:string}[]}

/** 先在全部分录中找候选，再统一排除双向歧义，不采用“循环遇到第一条就绑定”。 */
export function evaluateEntryAttachments(vouchers:Voucher[],documents:SourceDocument[],rule:MatchRule):EntryEvaluation {
 const documentOutcomes=new Map<string,string>();
 const blocked=new Map<string,string>();
 const proposals=new Map<string,{voucher:Voucher;entryIndex:number;side:'debit'|'credit'}[]>();
 const slots=new Map<string,string[]>();
 const byAmount=new Map<number,{voucher:Voucher;entryIndex:number;side:'debit'|'credit'}[]>();
 const existing=new Set(vouchers.flatMap(v=>v.entryAttachments||[]).map(link=>link.documentId));
 for(const voucher of vouchers){
  if(voucher.ruleId==='MANUAL'&&voucher.status==='matched'&&!voucher.entryAttachments?.length)continue;
  let reason='';
  if(!rule.enabled)reason='金额＋收款账号规则已停用，请启用后重试';
  else if(!Number.isFinite(businessDate(voucher.date)))reason='凭证日期无效，请人工复核';
  else if(!voucher.entries?.length)reason='凭证缺少逐行分录，请补录摘要、科目及借贷金额后复核';
  else if(voucher.autoMatchBlockedReasons?.some(value=>/借贷合计|续页|红字|负数/.test(value)))reason='原始分录金额或续页异常，请人工复核';
  else if(voucher.entries.some(entry=>!entryMoney(entry)))reason='存在零金额、红字、双边金额或无效分录，请人工复核';
  else if(!voucher.entries.some(entry=>subjectAccounts(entry.account).length))reason='凭证科目未读取到收款账号或至少4位尾号，请人工复核';
  else {
   try{
    const debit=voucher.entries.reduce((sum,entry)=>sum+amountCents(entry.debit),0),credit=voucher.entries.reduce((sum,entry)=>sum+amountCents(entry.credit),0);
    if(!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit)||debit!==credit||debit!==amountCents(voucher.amount))reason='分录借贷合计与凭证金额不一致，请核对原件';
   }catch{reason='凭证金额无效，请核对原件';}
  }
  if(reason){blocked.set(voucher.id,reason);continue;}
  for(const [entryIndex,entry] of voucher.entries!.entries()){
   if(voucher.entryAttachments?.some(link=>link.entryIndex===entryIndex))continue;
   const money=entryMoney(entry)!;
   if(!subjectAccounts(entry.account).length)continue;
   const list=byAmount.get(money.cents)||[];list.push({voucher,entryIndex,side:money.side});byAmount.set(money.cents,list);
  }
 }
 for(const doc of documents){
  if(doc.status==='matched'||existing.has(doc.id))continue;
  let cents:number;
  try{cents=amountCents(doc.amount);}catch{cents=0;}
  const date=businessDate(doc.date);
  let reason='';
  if(!rule.enabled)reason='金额＋收款账号规则已停用';
  else if(!normalizeBankAccount(doc.payeeAccount))reason='未可靠读取收款账号或至少4位尾号，请从回单原件补录';
  else if(cents<=0||!Number.isFinite(date))reason='回单金额或业务日期缺失，请人工复核';
  else if(doc.extractionStatus==='pending'&&doc.sourceKind!=='pdf-text')reason='回单字段尚未复核，请对照原件补录并保存';
  if(reason){documentOutcomes.set(doc.id,reason);continue;}
  // 以整数“分”建立金额索引，避免浮点容差，也避免每张回单重新扫描全部金额不符分录。
  const amountCandidates=byAmount.get(cents)||[];
  const accountCandidates=amountCandidates.filter(({voucher,entryIndex})=>accountInSubject(doc.payeeAccount!,voucher.entries![entryIndex]!.account));
  const candidates=accountCandidates.filter(({voucher})=>Math.abs(date-businessDate(voucher.date))/86400000<RECEIPT_DATE_WINDOW);
  if(candidates.length!==1){
   documentOutcomes.set(doc.id,candidates.length>1?'金额、账号及日期同时命中多条分录，请人工复核':accountCandidates.length?'回单与凭证日期差达到或超过30天，请人工复核':amountCandidates.length?'金额一致，但收款账号或尾号未在对应科目中命中':'没有金额完全一致的可关联分录，请人工复核');
   continue;
  }
  proposals.set(doc.id,candidates);
  const {voucher,entryIndex}=candidates[0]!;const slot=`${voucher.id}/${entryIndex}`;
  slots.set(slot,[...(slots.get(slot)||[]),doc.id]);
 }
 const linksByVoucher=new Map<string,EntryAttachment[]>();
 for(const [documentId,candidates] of proposals){
  const {voucher,entryIndex,side}=candidates[0]!;
  if(slots.get(`${voucher.id}/${entryIndex}`)!.length!==1){documentOutcomes.set(documentId,'同一分录存在多份金额、账号和日期均符合的回单，请人工确认');continue;}
  const links=linksByVoucher.get(voucher.id)||[];links.push({entryIndex,documentId,side,ruleId:'R09'});linksByVoucher.set(voucher.id,links);
 }
 const matches:EntryMatch[]=[];
 const outcomes=vouchers.map(voucher=>{
  const links=[...(voucher.entryAttachments||[]),...(linksByVoucher.get(voucher.id)||[])];
  const complete=attachmentCoverage(voucher,links);
  if(linksByVoucher.has(voucher.id))matches.push({voucherId:voucher.id,documentIds:links.map(link=>link.documentId),entryAttachments:links,complete,ruleId:'R09',confidence:100});
  return {voucherId:voucher.id,matched:complete,ruleId:'R09',reason:blocked.get(voucher.id)||(complete?'已逐行核对金额、收款账号及日期并关联附件':links.length?'部分分录已关联，其余分录请人工复核':'未找到唯一满足金额＋收款账号＋日期差小于30天的回单，请人工复核')};
 });
 return {matches,outcomes,documentOutcomes:[...documentOutcomes].map(([documentId,reason])=>({documentId,reason}))};
}
