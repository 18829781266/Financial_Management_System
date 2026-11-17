import {amountCents} from './money';
import {centsToAmount,documentRemainingCents,entryAllocatedCents} from './evidenceRelations';
import type {EntryAttachment,MatchRule,SourceDocument,Voucher,VoucherEntry} from './types';
import type {RuleEvaluation,RuleMatch} from './matchingEngine';

export const RECEIPT_RULE_ID='R09';
export const ACCOUNT_TAIL_LENGTH=4;
export const FULL_ACCOUNT_MIN_LENGTH=8;
export const RECEIPT_DATE_WINDOW=30;
export function receiptEntryRule():MatchRule {
 return {id:RECEIPT_RULE_ID,name:'回单分录分摊匹配',description:'核对往来对象、收付方向、账号与日期；整份余额组合唯一时自动关联，部分分摊与歧义交人工复核',priority:1,enabled:true,threshold:100,tolerance:0,dateWindow:30,matchType:'exact',conditions:{associationScope:'voucher',documentTypes:['bank'],requireAmount:true,requireDate:true}};
}

/** 不把空值、流水号或四位会计科目代码当成银行账号。 */
export function normalizeBankAccount(value:unknown):string {
 if(typeof value!=='string')return '';
 const text=value.normalize('NFKC').trim().replace(/[\s\-‐–—]/g,'');
 if(!/^[\d*Xx•·●]{4,40}$/.test(text))return '';
 const tail=text.match(/\d{4,}$/)?.[0];
 return tail||'';
}
export function subjectAccounts(subject:string):string[] {
 const text=String(subject||'').normalize('NFKC').replace(/^\s*\d{4,}(?:\.\d+)*(?=\s|[\u4e00-\u9fff_])/,'');
 const marker=/(?:账号|账户|帐户|卡号|尾号|尾数)[：:#_\-‐–—\s]*$/;
 const mask=/[*Xx•·●]/;
 const candidates=[...text.matchAll(/[\d*Xx•·●][\d*Xx•·● \-‐–—]{2,}[\d*Xx•·●]/g)];
 return [...new Set(candidates.flatMap(match=>{
  const account=normalizeBankAccount(match[0]);
  if(!account)return [];
  const prefix=text.slice(0,match.index??0);
  const explicit=marker.test(prefix),masked=mask.test(match[0]);
  return explicit||masked||account.length>=FULL_ACCOUNT_MIN_LENGTH?[account]:[];
 }))];
}
export function accountInSubject(payeeAccount:string,subject:string):boolean {
 const receipt=normalizeBankAccount(payeeAccount);
 if(!receipt)return false;
 return subjectAccounts(subject).some(account=>{
  if(receipt.length>=8&&account.length>=8)return receipt===account;
  const shorter=receipt.length<account.length?receipt:account,longer=receipt.length<account.length?account:receipt;
  return shorter.length>=ACCOUNT_TAIL_LENGTH&&longer.endsWith(shorter);
 });
}
/** 借方银行增加核收款账号，贷方银行减少核付款账号；红字保留原方向但金额同号为负。 */
export function entryAccount(document:SourceDocument,side:'debit'|'credit'):string {
 return side==='debit'?document.payeeAccount||'':document.payerAccount||'';
}
export function entryMoney(entry:VoucherEntry):{cents:number;side:'debit'|'credit'}|undefined {
 try{
  const debit=amountCents(entry.debit),credit=amountCents(entry.credit);
  if(debit!==0&&credit===0)return {cents:debit,side:'debit'};
  if(credit!==0&&debit===0)return {cents:credit,side:'credit'};
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
/** 完整性按“分摊金额之和＝分录金额”判断，不再按附件份数或单据原始总额判断。 */
export function attachmentCoverage(voucher:Voucher,links:EntryAttachment[]=voucher.entryAttachments||[],documents:SourceDocument[]=[]):boolean {
 const required=requiredReceiptEntries(voucher);
 if(!required.length)return false;
 const byId=new Map(documents.map(document=>[document.id,document]));
 return required.every(index=>{
  const money=voucher.entries?.[index]&&entryMoney(voucher.entries[index]!);
  if(!money)return false;
  const own=links.filter(link=>link.entryIndex===index);
  if(!own.length)return false;
  const total=own.reduce((sum,link)=>{
   const document=byId.get(link.documentId);
   if(!document)return sum;
   if(document.type==='contract'||document.type==='approval'||link.relationType==='reference')return sum;
   try{return sum+(link.allocatedAmount===undefined?amountCents(document.amount):amountCents(link.allocatedAmount));}catch{return sum;}
  },0);
  return total===money.cents;
 });
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

interface EntryNode {key:string;voucher:Voucher;entryIndex:number;side:'debit'|'credit';remaining:number}
interface DocumentNode {document:SourceDocument;remaining:number}

/** 自动核销保留完整法律主体名称，不剥离集团、股份或公司后缀。 */
const canonicalParty=(value:unknown)=>String(value||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
function entryParty(voucher:Voucher,entryIndex:number):{name?:string;reason?:string} {
 const own=canonicalParty(voucher.company),entry=voucher.entries?.[entryIndex];
 const auxiliary=(voucher.entries||[]).flatMap(item=>{
  if(!/^(?:\s*(?:1122|1123|1221|2202|2203|2241)\b)|应收|应付|往来/.test(item.account))return [];
  const name=item.account.match(/_[^.\s]+\.(.+)$/)?.[1]?.trim();
  return name&&!/^(待抵扣|暂估|其他|内部往来)$/.test(name)?[name]:[];
 });
 const names=[entry?.counterparty,...auxiliary,voucher.supplier].map(canonicalParty).filter(name=>name&&name!==own);
 const unique=[...new Set(names)];
 if(unique.length>1)return {reason:'分录辅助客商与凭证客商不一致或存在多个往来对象，请人工复核'};
 if(!unique.length)return {reason:'未能确认分录的外部往来客商，请人工复核'};
 return {name:unique[0]};
}
export function entryCounterpartyIssue(voucher:Voucher,entryIndex:number,document:SourceDocument,side:'debit'|'credit'):string|undefined {
 const expected=entryParty(voucher,entryIndex);
 if(expected.reason)return expected.reason;
 const external=side==='debit'?(document.payerName===undefined?document.supplier:document.payerName):document.payeeName;
 if(!canonicalParty(external))return `回单${side==='debit'?'付款人':'收款人'}缺失，无法确认外部往来客商，请人工复核`;
 if(canonicalParty(external)!==expected.name)return '回单外部往来客商与分录客商不一致，代收代付等特殊业务请人工复核';
 const reference=voucher.entries?.[entryIndex]?.bankNo||voucher.bankNo;
 const normalizeId=(value:unknown)=>String(value||'').normalize('NFKC').replace(/\s+/g,'').toUpperCase();
 if(reference&&![document.bankNo,document.receiptNo,document.number].some(value=>normalizeId(value)===normalizeId(reference)))return '分录指定的银行流水或回单标识不一致，请人工复核';
 return undefined;
}

/**
 * 全局候选按连通分量处理。只有金额分配被拓扑与合计唯一确定时才自动提交：
 * 自动关联只消费整份回单剩余额度，不擅自从大额回单截取金额；多对一要求回单余额
 * 恰好覆盖全部候选分录。部分分摊、多对多及同分候选交人工，避免顺序抢占。
 */
export function evaluateEntryAttachments(vouchers:Voucher[],documents:SourceDocument[],rule:MatchRule,allocationVouchers:Voucher[]=vouchers):EntryEvaluation {
 const documentOutcomes=new Map<string,string>(),blocked=new Map<string,string>(),candidateIssues=new Map<string,string>();
 const entryNodes=new Map<string,EntryNode>(),documentNodes=new Map<string,DocumentNode>();
 const adjacency=new Map<string,Set<string>>();
 const configuredTypes=new Set(rule.conditions?.documentTypes||['bank']);
 const connect=(entryKey:string,documentId:string)=>{
  adjacency.set(entryKey,new Set([...(adjacency.get(entryKey)||[]),documentId]));
  adjacency.set(documentId,new Set([...(adjacency.get(documentId)||[]),entryKey]));
 };
 for(const voucher of vouchers){
  if(voucher.ruleId==='MANUAL'&&voucher.status==='matched'&&!voucher.entryAttachments?.length)continue;
  let reason='';
  if(!rule.enabled)reason='回单分录规则已停用，请启用后重试';
  else if(!Number.isFinite(businessDate(voucher.date)))reason='凭证日期无效，请人工复核';
  else if(!voucher.entries?.length)reason='凭证缺少逐行分录，请补录摘要、科目及借贷金额后复核';
  else if(voucher.autoMatchBlockedReasons?.some(value=>/借贷合计|续页/.test(value)))reason='原始分录金额或续页异常，请人工复核';
  else if(voucher.entries.some(entry=>!entryMoney(entry)))reason='存在零金额、双边金额或无效分录，请人工复核';
  else if(voucher.entries.some(entry=>entryMoney(entry)!.cents<0)&&voucher.businessType!=='red-letter')reason='负数分录尚未标识红字业务，请人工复核';
  else if(!voucher.entries.some(entry=>subjectAccounts(entry.account).length))reason='凭证科目未读取到收付款账号或至少4位尾号，请人工复核';
  else {
   try{
    const debit=voucher.entries.reduce((sum,entry)=>sum+amountCents(entry.debit),0),credit=voucher.entries.reduce((sum,entry)=>sum+amountCents(entry.credit),0);
    if(!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit)||debit!==credit||debit!==amountCents(voucher.amount))reason='分录借贷合计与凭证金额不一致，请核对原件';
   }catch{reason='凭证金额无效，请核对原件';}
  }
  if(reason){blocked.set(voucher.id,reason);continue;}
  for(const [entryIndex,entry] of voucher.entries!.entries()){
   const money=entryMoney(entry)!;
   if(!subjectAccounts(entry.account).length)continue;
   const allocated=entryAllocatedCents(voucher,entryIndex,documents);
   const remaining=money.cents-allocated;
   if(remaining===0)continue;
   const key=`${voucher.id}/${entryIndex}`;
   entryNodes.set(key,{key,voucher,entryIndex,side:money.side,remaining});
  }
 }
 for(const document of documents){
  if(document.type!=='bank'||!configuredTypes.has(document.type))continue;
  let reason='';
  if(document.documentStatus==='void')reason='回单已作废，不参与匹配';
  else if(!rule.enabled)reason='回单分录规则已停用';
  else if(document.extractionStatus==='pending'&&document.sourceKind!=='pdf-text')reason='回单字段尚未复核，请对照原件补录并保存';
  let remaining=0;
  // 候选凭证可以只包含本轮未完成记录，但余额必须扣除所有凭证（含已完成、
  // 其他期间及人工分摊）的占用，否则旧回单会重新进入候选并制造歧义或争用。
  try{
   const original=amountCents(document.amount);
   remaining=documentRemainingCents(document,allocationVouchers);
   if(original<0&&document.documentStatus!=='red-letter')reason='负数回单尚未标识红字业务，请人工复核';
   if(remaining&&Math.sign(remaining)!==Math.sign(original)||Math.abs(remaining)>Math.abs(original))reason='回单历史分摊已超额或金额方向异常，请人工复核';
  }catch{reason='回单金额无效，请人工复核';}
  const date=businessDate(document.date);
  if(!reason&&(!remaining||!Number.isFinite(date)))reason='回单剩余金额或业务日期缺失，请人工复核';
  if(reason){documentOutcomes.set(document.id,reason);continue;}
  if(!remaining)continue;
  documentNodes.set(document.id,{document,remaining});
  let accountCandidate=false,dateCandidate=false,partyIssue='';
  for(const node of entryNodes.values()){
   if(Math.sign(node.remaining)!==Math.sign(remaining))continue;
   const account=entryAccount(document,node.side);
   if(!accountInSubject(account,node.voucher.entries![node.entryIndex]!.account))continue;
   accountCandidate=true;
   if(Math.abs(date-businessDate(node.voucher.date))/86400000>=RECEIPT_DATE_WINDOW)continue;
   dateCandidate=true;
   const issue=entryCounterpartyIssue(node.voucher,node.entryIndex,document,node.side);
   if(issue){partyIssue=issue;candidateIssues.set(node.voucher.id,issue);continue;}
   connect(node.key,document.id);
  }
  if(!adjacency.get(document.id)?.size)documentOutcomes.set(document.id,partyIssue||(accountCandidate&&!dateCandidate?'回单与凭证日期差达到或超过30天，请人工复核':'金额可分摊，但对应方向的收付款账号或尾号未在科目中命中'));
 }
 const visited=new Set<string>(),linksByVoucher=new Map<string,EntryAttachment[]>();
 // 按单据输入顺序遍历，保持旧版结果稳定，同时不以顺序决定有歧义的分配。
 for(const document of documents){
  if(!documentNodes.has(document.id)||visited.has(document.id))continue;
  const entryKeys=new Set<string>(),documentIds=new Set<string>(),queue=[document.id];
  visited.add(document.id);
  while(queue.length){
   const key=queue.shift()!;const neighbours=adjacency.get(key)||[];
   for(const next of neighbours){
    if(visited.has(next))continue;visited.add(next);queue.push(next);
    if(entryNodes.has(next))entryKeys.add(next);else documentIds.add(next);
   }
  }
  // 起点单据本身也必须计入分量。
  documentIds.add(document.id);
  for(const key of adjacency.get(document.id)||[])if(entryNodes.has(key))entryKeys.add(key);
  const entries=[...entryKeys].map(key=>entryNodes.get(key)!),docs=[...documentIds].map(id=>documentNodes.get(id)!);
  if(!entries.length)continue;
  const proposed:{node:EntryNode;document:SourceDocument;cents:number}[]=[];
  let ambiguous=false,partial=false;
  if(entries.length===1&&docs.length===1){
   const entry=entries[0]!,doc=docs[0]!;
   if(Math.abs(doc.remaining)<=Math.abs(entry.remaining))proposed.push({node:entry,document:doc.document,cents:doc.remaining});
   else {ambiguous=true;partial=true;}
  }else if(entries.length===1){
   const entry=entries[0]!,target=Math.abs(entry.remaining),capacity=docs.reduce((sum,doc)=>sum+Math.abs(doc.remaining),0);
   if(!Number.isSafeInteger(capacity))ambiguous=true;
   else if(capacity<target)for(const doc of docs)proposed.push({node:entry,document:doc.document,cents:doc.remaining});
   else if(docs.length<=20){
    // 单张整额与多张组合一起搜索；不能先选整额而漏掉40+60等替代完整解。
    const solutions:DocumentNode[][]=[],sorted=[...docs].sort((left,right)=>Math.abs(right.remaining)-Math.abs(left.remaining));
    const suffix=Array(sorted.length+1).fill(0) as number[];
    for(let i=sorted.length-1;i>=0;i--)suffix[i]=suffix[i+1]!+Math.abs(sorted[i]!.remaining);
    const visit=(index:number,total:number,chosen:DocumentNode[])=>{
     if(solutions.length>1||total>target||total+suffix[index]!<target)return;
     if(total===target){solutions.push(chosen);return;}
     if(index===sorted.length)return;
     visit(index+1,total+Math.abs(sorted[index]!.remaining),[...chosen,sorted[index]!]);
     visit(index+1,total,chosen);
    };
    visit(0,0,[]);
    if(solutions.length===1)for(const doc of solutions[0]!)proposed.push({node:entry,document:doc.document,cents:doc.remaining});
    else {ambiguous=true;partial=solutions.length===0;}
   }else ambiguous=true;
  }else if(docs.length===1){
   const doc=docs[0]!,target=entries.reduce((sum,entry)=>sum+Math.abs(entry.remaining),0);
   if(Number.isSafeInteger(target)&&Math.abs(doc.remaining)===target)for(const entry of entries)proposed.push({node:entry,document:doc.document,cents:entry.remaining});
   else {ambiguous=true;partial=Math.abs(doc.remaining)>target;}
  }else ambiguous=true;
  if(ambiguous){
   const reason=partial?'回单需要部分分摊，缺少明确分配依据，请人工确认金额':entries.length>1?'金额、账号、客商及日期命中多条分录，分摊方案不唯一，请人工复核':'同一分录存在多种回单分摊组合，请人工确认';
   for(const doc of docs)documentOutcomes.set(doc.document.id,reason);
   for(const entry of entries)candidateIssues.set(entry.voucher.id,reason);
  }else for(const {node,document:doc,cents} of proposed){
   const links=linksByVoucher.get(node.voucher.id)||[];
   links.push({entryIndex:node.entryIndex,documentId:doc.id,side:node.side,ruleId:'R09',allocatedAmount:centsToAmount(cents),relationType:'settlement'});
   linksByVoucher.set(node.voucher.id,links);
  }
 }
 const matches:EntryMatch[]=[];
 const outcomes=vouchers.map(voucher=>{
  const generated=linksByVoucher.get(voucher.id)||[];
  const links=[...(voucher.entryAttachments||[]),...generated];
  const complete=attachmentCoverage(voucher,links,documents);
  if(generated.length)matches.push({voucherId:voucher.id,documentIds:[...new Set(links.map(link=>link.documentId))],entryAttachments:links,complete,ruleId:'R09',confidence:100});
  return {voucherId:voucher.id,matched:complete,ruleId:'R09',reason:blocked.get(voucher.id)||(complete?'已按唯一整份余额方案核对金额、客商、收付方向、账号及日期':links.length?'部分分录已关联，其余分录或剩余金额请人工复核':candidateIssues.get(voucher.id)||'未找到唯一的回单分摊方案，请人工复核')};
 });
 return {matches,outcomes,documentOutcomes:[...documentOutcomes].map(([documentId,reason])=>({documentId,reason}))};
}
