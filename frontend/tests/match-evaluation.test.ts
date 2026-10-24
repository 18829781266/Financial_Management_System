import {afterEach,describe,expect,it,vi} from 'vitest';
import {computeMatchPlan} from '../src/matchPlanCore';
import {evaluateMatchPlan} from '../src/matchEvaluation';
import {evaluateRules} from '../src/matchingEngine';
import {evaluateNameAssociations} from '../src/nameAssociation';
import {testSeed} from './fixtures/demo-state';
import type {MatchEvaluationInput,MatchEvaluationResponse} from '../src/matchPlanCore';

function input():MatchEvaluationInput{
 const state=testSeed();
 return {vouchers:state.vouchers,documents:state.documents,rules:state.rules,time:'2026-10-23 18:00:00'};
}
afterEach(()=>vi.unstubAllGlobals());

describe('匹配计划的后台计算与提交隔离',()=>{
 it('财务优先再做名称关联，与顺序执行结果一致且不改输入',()=>{
  const source=input(),before=JSON.stringify(source),plan=computeMatchPlan(source);
  const sequential=JSON.parse(before) as MatchEvaluationInput;
  const financial=evaluateRules(sequential.vouchers,sequential.documents,sequential.rules);
  for(const match of financial.matches){
   const voucher=sequential.vouchers.find(v=>v.id===match.voucherId)!;
   voucher.status='matched';voucher.documentIds=[...match.documentIds];
   for(const id of match.documentIds)sequential.documents.find(d=>d.id===id)!.status='matched';
  }
  expect(plan.financial).toEqual(financial);
  expect(plan.names).toEqual(evaluateNameAssociations(sequential.vouchers,sequential.documents,sequential.rules,sequential.time));
  expect(JSON.stringify(source)).toBe(before);
  expect(plan.financial.matches).toHaveLength(4);
 });
 it('没有Worker时回退保持相同的金额容差、汇总和歧义处理',async()=>{
  vi.stubGlobal('Worker',undefined);const source=input();
  expect(await evaluateMatchPlan(source.vouchers,source.documents,source.rules,source.time)).toEqual(computeMatchPlan(source));
 });
 it('真实消息协议完成计算后仅返回完整计划并释放worker',async()=>{
  const terminate=vi.fn();
  class WorkingWorker{
   onmessage:((event:{data:MatchEvaluationResponse})=>void)|null=null;
   onerror:unknown;onmessageerror:unknown;
   terminate=terminate;
   postMessage(data:MatchEvaluationInput){queueMicrotask(()=>this.onmessage?.({data:{ok:true,plan:computeMatchPlan(data)}}));}
  }
  vi.stubGlobal('Worker',WorkingWorker);const source=input();
  expect(await evaluateMatchPlan(source.vouchers,source.documents,source.rules,source.time)).toEqual(computeMatchPlan(source));
  expect(terminate).toHaveBeenCalledTimes(1);
 });
 it('worker失败和消息投递失败都释放资源且不改业务输入',async()=>{
  for(const failOnPost of [false,true]){
   const terminate=vi.fn();
   class FailingWorker{
    onmessage:unknown;onerror:(()=>void)|null=null;onmessageerror:unknown;
    terminate=terminate;
    postMessage(){if(failOnPost)throw new Error('clone failed');queueMicrotask(()=>this.onerror?.());}
   }
   vi.stubGlobal('Worker',FailingWorker);const source=input(),before=JSON.stringify(source);
   await expect(evaluateMatchPlan(source.vouchers,source.documents,source.rules,source.time)).rejects.toThrow('本次未修改关联');
   expect(terminate).toHaveBeenCalledTimes(1);expect(JSON.stringify(source)).toBe(before);
  }
 });
});
