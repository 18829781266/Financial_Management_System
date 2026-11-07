import {computeMatchPlan} from './matchPlanCore';
import type {MatchEvaluationInput,MatchEvaluationResponse} from './matchPlanCore';

// 纯规则计算在独立线程执行，避免大量名称比较或汇总搜索阻塞列表、滚动和按钮。
self.onmessage=(event:MessageEvent<MatchEvaluationInput>)=>{
 let response:MatchEvaluationResponse;
 try{response={ok:true,plan:computeMatchPlan(event.data)};}
 catch{response={ok:false,message:'匹配计算失败，请检查凭证及规则配置后重试；本次未修改关联'};}
 self.postMessage(response);
};
