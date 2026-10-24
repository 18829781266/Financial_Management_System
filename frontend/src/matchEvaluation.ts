import {computeMatchPlan} from './matchPlanCore';
import type {MatchEvaluationInput,MatchEvaluationResponse,MatchPlan} from './matchPlanCore';
import type {MatchRule,SourceDocument,Voucher} from './types';

export type {MatchPlan} from './matchPlanCore';

/** 调用方提交普通数据快照；计算结束前不写状态，因此计算失败不会留下半批关联。 */
export async function evaluateMatchPlan(vouchers:Voucher[],documents:SourceDocument[],rules:MatchRule[],time:string):Promise<MatchPlan> {
 const input:MatchEvaluationInput={vouchers,documents,rules,time};
 if(typeof Worker==='undefined'){
  // 非浏览器和不支持Worker的环境保持相同规则结果，并先让出一次事件循环更新忙碌提示。
  await new Promise<void>(resolve=>setTimeout(resolve,0));
  return computeMatchPlan(input);
 }
 let worker:Worker;
 try{worker=new Worker(new URL('./matchEvaluation.worker.ts',import.meta.url),{type:'module',name:'langchao-match'});}
 catch{throw new Error('无法启动匹配计算，请检查浏览器设置后重试；本次未修改关联');}
 return new Promise<MatchPlan>((resolve,reject)=>{
  let settled=false;
  const finish=(error?:Error,plan?:MatchPlan)=>{
   if(settled)return;settled=true;
   clearTimeout(timeout);worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();
   if(error)reject(error);else resolve(plan!);
  };
  const timeout=setTimeout(()=>finish(new Error('匹配计算超时，请缩小期间或候选范围后重试；本次未修改关联')),30000);
  worker.onmessage=(event:MessageEvent<MatchEvaluationResponse>)=>{
   const response=event.data;
   if(response?.ok&&Array.isArray(response.plan?.financial?.matches)&&Array.isArray(response.plan?.financial?.outcomes)&&Array.isArray(response.plan?.names))finish(undefined,response.plan);
   else finish(new Error(response?.ok===false?response.message:'匹配计算结果无法读取，请重试；本次未修改关联'));
  };
  worker.onerror=()=>finish(new Error('匹配计算失败，请刷新页面后重试；本次未修改关联'));
  worker.onmessageerror=()=>finish(new Error('匹配计算结果无法读取，请重试；本次未修改关联'));
  try{worker.postMessage(input);}
  catch{finish(new Error('匹配数据无法读取，请刷新页面后重试；本次未修改关联'));}
 });
}
