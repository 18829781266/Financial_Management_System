import {evaluateRules} from './matchingEngine';
import type {RuleEvaluation,RuleMatch} from './matchingEngine';
import {evaluateNameAssociations} from './nameAssociation';
import {evaluateEntryAttachments,RECEIPT_RULE_ID,requiredReceiptEntries,subjectAccounts} from './entryAttachments';
import {documentRemainingCents,isReferenceDocument} from './evidenceRelations';
import type {EntryAttachment} from './types';
import type {MatchRule,NameAssociation,SourceDocument,Voucher} from './types';

export interface MatchEvaluationInput {vouchers:Voucher[];documents:SourceDocument[];rules:MatchRule[];time:string}
export interface UnifiedRuleMatch extends RuleMatch {entryAttachments?:EntryAttachment[];complete?:boolean}
export interface UnifiedEvaluation extends RuleEvaluation {matches:UnifiedRuleMatch[];documentOutcomes?:{documentId:string;reason:string}[]}
export interface MatchPlan {financial:UnifiedEvaluation;names:NameAssociation[]}
export type MatchEvaluationResponse={ok:true;plan:MatchPlan}|{ok:false;message:string};

function projectedDocuments(vouchers:Voucher[],documents:SourceDocument[]):SourceDocument[] {
 return documents.map(document=>{
  if(isReferenceDocument(document))return document;
  try{return {...document,status:documentRemainingCents(document,vouchers)===0?'matched' as const:'pending' as const};}catch{return document;}
 });
}

/**
 * 统一计划：R09 只负责分录级银行证据，R01—R07 继续处理整凭证财务证据。
 * 两类结果按凭证合并，不再以“存在 R09”为理由互斥；全程不修改输入。
 */
export function computeMatchPlan(input:MatchEvaluationInput):MatchPlan {
 const receiptRule=input.rules.find(rule=>rule.id===RECEIPT_RULE_ID);
 const entryVouchers=receiptRule?input.vouchers.filter(voucher=>voucher.entries?.some(entry=>subjectAccounts(entry.account).length)&&voucher.status!=='matched'):[];
 const entries=receiptRule?evaluateEntryAttachments(entryVouchers,input.documents,receiptRule,input.vouchers):undefined;
 const entryByVoucher=new Map((entries?.matches||[]).map(match=>[match.voucherId,match]));
 const snapshots=input.vouchers.map(voucher=>{
  const match=entryByVoucher.get(voucher.id);
  if(!match)return voucher;
  return {...voucher,status:'pending' as const,documentIds:[...new Set(match.documentIds)],entryAttachments:match.entryAttachments,ruleId:match.ruleId,confidence:match.confidence};
 });
 const afterEntries=projectedDocuments(snapshots,input.documents);
 const generalRules=input.rules.filter(rule=>rule.id!==RECEIPT_RULE_ID);
 const general=evaluateRules(snapshots,afterEntries,generalRules);
 const generalByVoucher=new Map<string,RuleMatch[]>();
 for(const match of general.matches)generalByVoucher.set(match.voucherId,[...(generalByVoucher.get(match.voucherId)||[]),match]);
 const mergedMatches:UnifiedRuleMatch[]=[];
 const mergedSnapshots=input.vouchers.map(voucher=>{
  const entry=entryByVoucher.get(voucher.id),others=generalByVoucher.get(voucher.id),other=others?.at(-1);
  if(!entry&&!others?.length)return voucher;
  const documentIds=[...new Set([...(entry?.documentIds||voucher.documentIds),...(others||[]).flatMap(match=>match.documentIds)])];
  const merged:UnifiedRuleMatch={
   voucherId:voucher.id,documentIds,ruleId:other?.ruleId||entry?.ruleId||'R09',confidence:other?.confidence??entry?.confidence??100,
   ...(entry?{entryAttachments:entry.entryAttachments,complete:entry.complete}:{}),
  };
  mergedMatches.push(merged);
  return {...voucher,status:'matched' as const,documentIds,entryAttachments:entry?.entryAttachments||voucher.entryAttachments,ruleId:merged.ruleId,confidence:merged.confidence};
 });
 const finalDocuments=projectedDocuments(mergedSnapshots,input.documents).map(document=>general.matches.some(match=>match.documentIds.includes(document.id))?{...document,status:'matched' as const}:document);
 const outcomes=input.vouchers.filter(voucher=>voucher.status==='pending'||entryByVoucher.has(voucher.id)||generalByVoucher.has(voucher.id)).map(voucher=>{
  const merged=mergedMatches.find(match=>match.voucherId===voucher.id),entryOutcome=entries?.outcomes.find(outcome=>outcome.voucherId===voucher.id),other=general.outcomes.find(outcome=>outcome.voucherId===voucher.id);
  if(merged){
   const reasons=[entryOutcome?.reason,other?.reason].filter((value,index,array)=>value&&array.indexOf(value)===index);
   return {voucherId:voucher.id,matched:true,ruleId:merged.ruleId,reason:reasons.join('；')||'已建立原始单据关联'};
  }
  return entryOutcome||other||{voucherId:voucher.id,matched:false,reason:'未找到符合当前规则的唯一候选'};
 });
 // 名称归集只说明单位归属，不伪造财务附件关系。可执行分录核验的银行凭证禁止名称兜底；
 // 含红字的专项复核凭证仍可归集名称；启用分录规则但缺少分录时必须先补录，不能直接名称归档。
 const nameVouchers=mergedSnapshots.filter(voucher=>{
  // 已成立金额关系的凭证只进入财务证据组，不能被后续名称组改写归集口径。
  if(voucher.status==='matched')return false;
  if(voucher.autoMatchBlockedReasons?.some(reason=>reason.includes('红字')))return true;
  if(receiptRule?.enabled&&!voucher.entries?.length)return false;
  return !requiredReceiptEntries(voucher).length;
 });
 const financialDocumentIds=new Set(mergedMatches.flatMap(match=>match.documentIds));
 const nameDocuments=finalDocuments.filter(document=>!financialDocumentIds.has(document.id));
 const names=evaluateNameAssociations(nameVouchers,nameDocuments,input.rules,input.time);
 return {financial:{matches:mergedMatches,outcomes,documentOutcomes:entries?.documentOutcomes||[]},names};
}
