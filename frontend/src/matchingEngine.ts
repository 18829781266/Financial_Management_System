import {amountCents} from './money';
import {normalizeSupplier,supplierSimilarity} from './matchUtils';
import type {MatchRule,SourceDocument,Voucher} from './types';

type DocumentType=SourceDocument['type'];
interface RuleConditions {partyField?:'payerName'|'payeeName'|'either';documentTypes?:DocumentType[];requireDate?:boolean;requireAmount?:boolean}
type ConfiguredRule=MatchRule&{conditions?:RuleConditions};
type NamedDocument=SourceDocument&{payerName?:string;payeeName?:string;bankNo?:string};
export interface RuleMatch {voucherId:string;documentIds:string[];ruleId:string;confidence:number}
export interface RuleOutcome {voucherId:string;matched:boolean;reason:string;ruleId?:string}
export interface RuleEvaluation {matches:RuleMatch[];outcomes:RuleOutcome[]}
interface Diagnostic {stage:number;reason:string;ruleId?:string}
interface CandidateResult {docs:SourceDocument[];confidence:number;diagnostic:Diagnostic;ambiguous?:boolean}
interface ScoredDocument {doc:SourceDocument;score:number;partyKey:string}
const types:DocumentType[]=['invoice','bank','contract','approval'];
const identifierRules:Record<string,{field:'invoiceNo'|'contractNo'|'bankNo'|'approvalNo';label:string;type:DocumentType}>={
 R01:{field:'invoiceNo',label:'发票号码',type:'invoice'},R02:{field:'contractNo',label:'合同编号',type:'contract'},R03:{field:'bankNo',label:'银行流水号',type:'bank'},R04:{field:'approvalNo',label:'审批单号',type:'approval'},
};
const fail=(rule:MatchRule,stage:number,reason:string,ambiguous=false):CandidateResult=>({docs:[],confidence:0,diagnostic:{stage,reason,ruleId:rule.id},ambiguous});
function dateTime(value:string):number {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return NaN;
 const time=Date.parse(`${value}T00:00:00Z`);
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time:NaN;
}
function positiveCents(value:unknown):number {try{const cents=amountCents(value);return cents>0?cents:NaN;}catch{return NaN;}}
function voucherIssue(voucher:Voucher):string|undefined {
 if(voucher.autoMatchBlockedReasons?.length)return voucher.autoMatchBlockedReasons.join('；');
 if(!Number.isFinite(positiveCents(voucher.amount)))return '零净额、负净额或无效金额凭证需按分录人工处理';
 if(!voucher.no.trim()||!voucher.summary.trim()||!voucher.supplier.trim())return '凭证字段尚不完整，请核对凭证号、摘要和客商名称';
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(voucher.period)||!Number.isFinite(dateTime(voucher.date))||!voucher.date.startsWith(voucher.period))return '凭证日期或会计期间无效，请复核';
 if(voucher.reviewStatus==='pending'&&voucher.sourceKind!=='pdf-text')return '凭证字段尚待复核，请先补齐并核对原件';
 if(voucher.sourceKind==='pdf-text'){
  if(!voucher.entries?.length)return '文字凭证缺少可核对的原始分录，请复核';
  let debit=0,credit=0;
  try{
   for(const entry of voucher.entries){
    const dr=amountCents(entry.debit),cr=amountCents(entry.credit);
    if(dr<0||cr<0)return '含红字或负数分录，请人工核对抵销关系';
    debit+=dr;credit+=cr;
   }
  }catch{return '原始分录金额无效，请复核';}
  if(!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit)||debit!==credit||debit!==amountCents(voucher.amount))return '分录借贷合计与凭证金额不一致，请核对原件';
  if(voucher.reviewReasons?.some(reason=>/续页.*(?:缺失|重复|不连续)|(?:缺失|重复|不连续).*续页/.test(reason)))return '凭证续页不完整，请复核原件后重新导入';
 }
 return undefined;
}
function documentIssue(doc:SourceDocument):string|undefined {
 if(doc.extractionStatus==='pending'&&doc.sourceKind!=='pdf-text')return '单据字段尚待补录复核';
 if(!Number.isFinite(positiveCents(doc.amount))||!Number.isFinite(dateTime(doc.date))||!doc.number.trim())return '单据金额、编号或业务日期尚不完整，请复核';
 if(doc.sourceKind==='pdf-text'&&doc.reviewReasons?.some(reason=>/未可靠读取|金额.*不一致|字段.*(?:有歧义|缺失)/.test(reason)))return '单据存在未可靠读取的字段，请核对原件';
 return undefined;
}
function ruleIssue(rule:ConfiguredRule):string|undefined {
 if(!Number.isFinite(rule.priority)||rule.priority<1||!Number.isFinite(rule.threshold)||rule.threshold<0||rule.threshold>100||!Number.isInteger(rule.dateWindow)||rule.dateWindow<0||rule.dateWindow>366||!['exact','fuzzy','aggregate'].includes(rule.matchType))return '规则的优先级、阈值、日期窗口或匹配策略无效';
 if(typeof rule.tolerance!=='number'||!Number.isFinite(rule.tolerance))return '规则金额容差无效';
 try{if(amountCents(rule.tolerance)<0)return '规则金额容差不能为负数';}catch{return '规则金额容差无效';}
 if(rule.conditions?.documentTypes!==undefined&&!rule.conditions.documentTypes.length)return '请至少选择一种规则单据类型';
 if(rule.conditions?.documentTypes?.some(type=>!types.includes(type)))return '规则单据类型无效';
 if(rule.conditions?.partyField&&!['payerName','payeeName','either'].includes(rule.conditions.partyField))return '规则名称字段无效';
 return undefined;
}
function ruleTypes(rule:ConfiguredRule):DocumentType[]{
 if(rule.conditions?.documentTypes?.length)return [...new Set(rule.conditions.documentTypes)];
 return identifierRules[rule.id]?[identifierRules[rule.id]!.type]:rule.id==='R06'?['bank']:rule.id==='R05'||rule.matchType==='aggregate'?['invoice']:types;
}
function partyNames(doc:NamedDocument,field:RuleConditions['partyField']):string[]{
 // 显式空付款人代表“未提取”，不能以收款人或旧客商值替代；旧记录没有该字段时才兼容 supplier。
 const payer=doc.payerName===undefined?doc.supplier:doc.payerName;
 if(field==='payeeName')return doc.payeeName?.trim()?[doc.payeeName.trim()]:[];
 if(field==='either')return [...new Set([payer,doc.payeeName||''].map(value=>value.trim()).filter(Boolean))];
 return payer.trim()?[payer.trim()]:[];
}
function scoreParty(voucher:Voucher,doc:SourceDocument,rule:ConfiguredRule,exact=false):ScoredDocument {
 let score=0,partyKey='';
 for(const party of partyNames(doc,rule.conditions?.partyField)){
  const value=exact?(voucher.supplier.trim()===party?100:0):supplierSimilarity(voucher.supplier,party);
  if(value>score||!partyKey){score=value;partyKey=normalizeSupplier(party);}
 }
 return {doc,score,partyKey};
}
function fitsDate(voucher:Voucher,doc:SourceDocument,rule:ConfiguredRule):boolean {
 return rule.conditions?.requireDate===false||Math.abs(dateTime(voucher.date)-dateTime(doc.date))/86400000<=rule.dateWindow;
}
function fitsAmount(voucher:Voucher,doc:SourceDocument,rule:ConfiguredRule):boolean {
 // 始终以整数“分”计算，0.01 尾差不会受二进制浮点减法影响。
 return rule.conditions?.requireAmount===false||Math.abs(amountCents(voucher.amount)-amountCents(doc.amount))<=amountCents(rule.tolerance);
}
function findSingle(voucher:Voucher,pool:SourceDocument[],rule:ConfiguredRule):CandidateResult {
 const identifier=rule.matchType==='exact'?identifierRules[rule.id]:undefined;
 let named:ScoredDocument[];
 if(identifier){
  const value=voucher[identifier.field]?.trim();
  if(!value)return fail(rule,1,`${rule.id}：凭证缺少${identifier.label}，继续其他规则`);
  named=pool.filter(doc=>doc.number===value||(identifier.field==='bankNo'&&(doc as NamedDocument).bankNo===value)).map(doc=>({doc,score:100,partyKey:''}));
  if(!named.length)return fail(rule,2,`${rule.id}：没有${identifier.label}一致的候选单据`);
 }else{
  const exact=rule.matchType==='exact';
  named=pool.map(doc=>scoreParty(voucher,doc,rule,exact)).filter(item=>item.partyKey&&(exact?item.score===100:item.score>=rule.threshold));
  if(!named.length)return fail(rule,2,`${rule.id}：配置的${rule.conditions?.partyField==='payeeName'?'收款人':rule.conditions?.partyField==='either'?'付款人或收款人':'付款人'}名称未达到${exact?'精确一致':`${rule.threshold}%相似度`}`);
 }
 const amountMatched=named.filter(item=>fitsAmount(voucher,item.doc,rule));
 if(!amountMatched.length)return fail(rule,3,`${rule.id}：候选金额超出 ${rule.tolerance.toFixed(2)} 元容差`);
 const dateMatched=amountMatched.filter(item=>fitsDate(voucher,item.doc,rule));
 if(!dateMatched.length)return fail(rule,4,`${rule.id}：候选日期超出 ${rule.dateWindow} 天窗口，请检查规则日期配置`);
 if(voucher.expectedAttachments!==undefined&&voucher.expectedAttachments!==1)return fail(rule,5,`${rule.id}：凭证要求 ${voucher.expectedAttachments} 份附件，单张匹配不满足附件数`);
 if(dateMatched.length>1)return fail(rule,6,`${rule.id}：存在 ${dateMatched.length} 份等价候选，需人工确认`,true);
 const candidate=dateMatched[0]!;
 if(candidate.score<rule.threshold)return fail(rule,5,`${rule.id}：置信度未达到 ${rule.threshold}% 阈值`);
 return {docs:[candidate.doc],confidence:candidate.score,diagnostic:{stage:7,reason:`已按 ${rule.id} ${rule.name} 建立关联`,ruleId:rule.id}};
}
function amountCombinations(candidates:ScoredDocument[],voucher:Voucher,rule:ConfiguredRule):{solutions:ScoredDocument[][];reason?:string}{
 const count=voucher.expectedAttachments;
 if(rule.conditions?.requireAmount===false){
  const enough=candidates.length>=2&&(count===undefined||count===candidates.length);
  return {solutions:enough?[candidates]:[]};
 }
 if(candidates.length>22)return {solutions:[],reason:'同名同类候选超过 22 份，请缩小日期窗口或单据类型后重试'};
 const target=amountCents(voucher.amount),tolerance=amountCents(rule.tolerance);
 const sorted=[...candidates].sort((a,b)=>amountCents(b.doc.amount)-amountCents(a.doc.amount));
 const amounts=sorted.map(item=>amountCents(item.doc.amount)),suffix=Array(sorted.length+1).fill(0) as number[];
 for(let index=sorted.length-1;index>=0;index--)suffix[index]=suffix[index+1]!+amounts[index]!;
 if(!Number.isSafeInteger(suffix[0]))return {solutions:[],reason:'候选金额合计超出可精确处理范围，请拆分后重试'};
 const solutions:ScoredDocument[][]=[];
 const visit=(index:number,sum:number,chosen:ScoredDocument[])=>{
  if(solutions.length>1||sum>target+tolerance||sum+suffix[index]!<target-tolerance||(count!==undefined&&chosen.length>count))return;
  if(index===sorted.length){
   if(chosen.length>=2&&(count===undefined||count===chosen.length)&&Math.abs(sum-target)<=tolerance)solutions.push([...chosen]);
   return;
  }
  visit(index+1,sum+amounts[index]!,[...chosen,sorted[index]!]);
  visit(index+1,sum,chosen);
 };
 visit(0,0,[]);return {solutions};
}
function findAggregate(voucher:Voucher,pool:SourceDocument[],rule:ConfiguredRule):CandidateResult {
 const named=pool.map(doc=>scoreParty(voucher,doc,rule)).filter(item=>item.partyKey&&item.score>=rule.threshold);
 if(!named.length)return fail(rule,2,`${rule.id}：没有名称达到 ${rule.threshold}% 相似度的汇总候选`);
 const dated=named.filter(item=>fitsDate(voucher,item.doc,rule));
 if(!dated.length)return fail(rule,4,`${rule.id}：汇总候选超出 ${rule.dateWindow} 天日期窗口`);
 // 发票与银行回单可能证明同一笔业务，严禁把两种影像金额相加而重复计算。
 // 同时按标准化后的真实匹配主体分组，不把两个相似但不同的付款人凑成一笔。
 const groups=new Map<string,ScoredDocument[]>();
 for(const item of dated){const key=`${item.doc.type}/${item.partyKey}`;groups.set(key,[...(groups.get(key)||[]),item]);}
 const solutions:ScoredDocument[][]=[];let limitReason='';
 for(const group of groups.values()){
  const result=amountCombinations(group,voucher,rule);solutions.push(...result.solutions);
  if(result.reason)limitReason=result.reason;
  if(solutions.length>1)break;
 }
 if(solutions.length>1)return fail(rule,6,`${rule.id}：存在多个同名同类汇总组合，需人工确认`,true);
 // 任何组因规模无法完整搜索，都不能据另一组的唯一结果就误判为全局唯一解。
 if(limitReason)return fail(rule,5,`${rule.id}：${limitReason}`,true);
 if(!solutions.length)return fail(rule,3,`${rule.id}：没有同一名称、同一类型且满足金额容差与附件数的汇总组合`);
 const selected=solutions[0]!;
 return {docs:selected.map(item=>item.doc),confidence:Math.min(...selected.map(item=>item.score)),diagnostic:{stage:7,reason:`已按 ${rule.id} ${rule.name} 汇总关联 ${selected.length} 份单据`,ruleId:rule.id}};
}
/**
 * 策略 + 优先责任链的纯规则执行器。只返回计划，不修改凭证、单据、配置或复核标记。
 * 自动关联与“按付款人归集”不同：自动关联必须满足已启用规则及其金额、日期、类型和唯一性条件。
 */
export function evaluateRules(vouchers:Voucher[],documents:SourceDocument[],rules:MatchRule[]):RuleEvaluation {
 const pending=vouchers.filter(voucher=>voucher.status==='pending');
 const outcomes=new Map<string,Diagnostic>(),stopped=new Set<string>(),matched=new Set<string>();
 const used=new Set(vouchers.filter(voucher=>voucher.status==='matched').flatMap(voucher=>voucher.documentIds));
 const matches:RuleMatch[]=[];
 const remember=(voucherId:string,diagnostic:Diagnostic)=>{const previous=outcomes.get(voucherId);if(!previous||diagnostic.stage>previous.stage)outcomes.set(voucherId,diagnostic);};
 for(const voucher of pending){const issue=voucherIssue(voucher);if(issue){stopped.add(voucher.id);outcomes.set(voucher.id,{stage:8,reason:issue});}}
 const enabled=[...rules].filter(rule=>rule.enabled&&rule.conditions?.associationScope!=='party').sort((left,right)=>left.priority-right.priority||left.id.localeCompare(right.id));
 for(const rule of enabled){
  const invalid=ruleIssue(rule);
  if(invalid){for(const voucher of pending)if(!stopped.has(voucher.id)&&!matched.has(voucher.id))remember(voucher.id,{stage:1,reason:`${rule.id}：${invalid}`,ruleId:rule.id});continue;}
  const proposals:{voucher:Voucher;candidate:CandidateResult}[]=[];
  for(const voucher of pending){
   if(stopped.has(voucher.id)||matched.has(voucher.id))continue;
   const allowed=ruleTypes(rule),typed=documents.filter(doc=>doc.status==='pending'&&allowed.includes(doc.type)&&!used.has(doc.id));
   const valid=typed.filter(doc=>!documentIssue(doc));
   const pool=valid.filter(doc=>doc.date.startsWith(voucher.period));
   if(!pool.length){
    const reason=typed.length&&!valid.length?'候选单据字段尚不完整或未可靠提取，请补录复核':valid.length?'没有同一会计期间的候选单据':'没有未关联的对应类型单据';
    remember(voucher.id,{stage:1,reason:`${rule.id}：${reason}`,ruleId:rule.id});continue;
   }
   const candidate=rule.matchType==='aggregate'?findAggregate(voucher,pool,rule):findSingle(voucher,pool,rule);
   remember(voucher.id,candidate.diagnostic);
   if(candidate.ambiguous){stopped.add(voucher.id);continue;}
   if(candidate.docs.length&&candidate.confidence>=rule.threshold)proposals.push({voucher,candidate});
  }
  const counts=new Map<string,number>();for(const proposal of proposals)for(const doc of proposal.candidate.docs)counts.set(doc.id,(counts.get(doc.id)||0)+1);
  for(const {voucher,candidate} of proposals){
   if(candidate.docs.some(doc=>counts.get(doc.id)!>1)){
    stopped.add(voucher.id);outcomes.set(voucher.id,{stage:8,reason:`${rule.id}：同一单据被多张凭证同时命中，需人工确认`,ruleId:rule.id});continue;
   }
   matches.push({voucherId:voucher.id,documentIds:candidate.docs.map(doc=>doc.id),ruleId:rule.id,confidence:Math.round(candidate.confidence*100)/100});
   matched.add(voucher.id);for(const doc of candidate.docs)used.add(doc.id);
   outcomes.set(voucher.id,candidate.diagnostic);
  }
 }
 return {matches,outcomes:pending.map(voucher=>{
  const diagnostic=outcomes.get(voucher.id);
  return {voucherId:voucher.id,matched:matched.has(voucher.id),reason:diagnostic?.reason||(enabled.length?'没有符合当前规则的唯一候选':'没有已启用的匹配规则，请先配置规则'),...(diagnostic?.ruleId?{ruleId:diagnostic.ruleId}:{})};
 })};
}
