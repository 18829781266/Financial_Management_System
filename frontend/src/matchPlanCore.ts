import {evaluateRules} from './matchingEngine';
import {evaluateNameAssociations} from './nameAssociation';
import type {RuleEvaluation} from './matchingEngine';
import type {MatchRule,NameAssociation,SourceDocument,Voucher} from './types';

export interface MatchEvaluationInput {vouchers:Voucher[];documents:SourceDocument[];rules:MatchRule[];time:string}
export interface MatchPlan {financial:RuleEvaluation;names:NameAssociation[]}
export type MatchEvaluationResponse={ok:true;plan:MatchPlan}|{ok:false;message:string};

/**
 * 纯计算阶段与正式提交分离。先算金额关联，再在独立视图中标记已消费的原件，
 * 最后计算企业名称关联，保持现有“财务匹配优先”的顺序，绝不修改传入记录。
 */
export function computeMatchPlan(input:MatchEvaluationInput):MatchPlan {
 const financial=evaluateRules(input.vouchers,input.documents,input.rules);
 const byVoucher=new Map(financial.matches.map(match=>[match.voucherId,match]));
 const consumed=new Set(financial.matches.flatMap(match=>match.documentIds));
 const vouchers=input.vouchers.map(voucher=>{
  const match=byVoucher.get(voucher.id);
  return match?{...voucher,status:'matched' as const,documentIds:[...match.documentIds],ruleId:match.ruleId,confidence:match.confidence}:voucher;
 });
 const documents=input.documents.map(document=>consumed.has(document.id)?{...document,status:'matched' as const}:document);
 return {financial,names:evaluateNameAssociations(vouchers,documents,input.rules,input.time)};
}
