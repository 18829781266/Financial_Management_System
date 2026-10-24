import {describe,expect,it} from 'vitest';
import {evaluateRules} from '../src/matchingEngine';
import type {Voucher,SourceDocument,MatchRule} from '../src/types';

type PartyFields={payerName?:string;payeeName?:string};
type Conditions={partyField?:'payerName'|'payeeName'|'either';documentTypes?:SourceDocument['type'][];requireDate?:boolean;requireAmount?:boolean};
type ConfigurableRule=MatchRule&{conditions?:Conditions};
const voucher=(patch:Partial<Voucher>={}):Voucher=>({id:'v-1',no:'记-1',period:'2026-06',date:'2026-06-01',summary:'合成销售业务',supplier:'测试付款方有限公司',amount:100,status:'pending',documentIds:[],...patch});
const doc=(patch:Partial<SourceDocument>&PartyFields={}):SourceDocument&PartyFields=>({id:'d-1',name:'合成单据.pdf',type:'invoice',supplier:'测试付款方有限公司',payerName:'测试付款方有限公司',payeeName:'测试收款方有限公司',amount:100,date:'2026-06-01',number:'INV-1',seal:false,status:'pending',extractionStatus:'reviewed',...patch});
const rule=(patch:Partial<ConfigurableRule>={}):ConfigurableRule=>({id:'R05',name:'名称金额日期',description:'合成规则配置',priority:5,enabled:true,threshold:85,tolerance:0.05,dateWindow:7,matchType:'fuzzy',...patch});
const exact=(patch:Partial<ConfigurableRule>={})=>rule({id:'R01',matchType:'exact',priority:1,threshold:95,...patch});
const aggregate=(patch:Partial<ConfigurableRule>={})=>rule({id:'R07',matchType:'aggregate',priority:7,threshold:90,...patch});
const documentIds=(result:ReturnType<typeof evaluateRules>)=>result.matches.flatMap(match=>match.documentIds);
const balance=(amount='100.00')=>[{summary:'合成销售',account:'1122 应收账款',debit:amount,credit:'0.00'},{summary:'合成销售',account:'6001 营业收入',debit:'0.00',credit:amount}];

describe('配置驱动的匹配执行',()=>{
 it.each([{id:'R01',field:'invoiceNo',type:'invoice'},{id:'R02',field:'contractNo',type:'contract'},{id:'R03',field:'bankNo',type:'bank'},{id:'R04',field:'approvalNo',type:'approval'}] as const)('$id读取对应业务标识',({id,field,type})=>{
  const result=evaluateRules([voucher({[field]:'SYNTHETIC-ID'})],[doc({type,number:'SYNTHETIC-ID'})],[exact({id})]);
  expect(result.matches).toHaveLength(1);expect(result.matches[0]?.ruleId).toBe(id);
 });
 it('按配置优先级选择规则，而不是写死R01最先执行',()=>{
  const v=voucher({invoiceNo:'EXACT-ID'}),ds=[doc({id:'fuzzy'}),doc({id:'exact',number:'EXACT-ID',payerName:'另一个付款方有限公司',supplier:'另一个付款方有限公司'})];
  const first=evaluateRules([v],ds,[exact({priority:9}),rule({priority:1})]);
  expect(first.matches).toHaveLength(1);expect(first.matches[0]?.ruleId).toBe('R05');expect(documentIds(first)).toEqual(['fuzzy']);
  const reordered=evaluateRules([v],ds,[exact({priority:1}),rule({priority:9})]);
  expect(reordered.matches[0]?.ruleId).toBe('R01');expect(documentIds(reordered)).toEqual(['exact']);
 });
 it('停用规则不参与匹配，返回可解释结果',()=>{
  const result=evaluateRules([voucher()],[doc()],[rule({enabled:false})]);
  expect(result.matches).toEqual([]);expect(result.outcomes[0]?.reason).toMatch(/启用|停用|规则/);
 });
 it('matchType修改确实改变策略，R01改模糊时无需发票号码一致',()=>{
  const result=evaluateRules([voucher({invoiceNo:'DIFFERENT'})],[doc()], [exact({matchType:'fuzzy'})]);
  expect(documentIds(result)).toEqual(['d-1']);
 });
 it('非R01编号也能用配置的汇总策略执行',()=>{
  const result=evaluateRules([voucher()],[doc({id:'a',amount:60}),doc({id:'b',amount:40})],[rule({id:'CUSTOM-AGGREGATE',matchType:'aggregate'})]);
  expect(documentIds(result).sort()).toEqual(['a','b']);
 });
 it('百分百阈值下完全一致可以取得100分，不存在人为97分上限',()=>{
  const result=evaluateRules([voucher()],[doc()],[rule({threshold:100})]);
  expect(result.matches).toHaveLength(1);expect(result.matches[0]?.confidence).toBe(100);
 });
 it('名称后缀归一仍支持模糊匹配',()=>{
  const result=evaluateRules([voucher({supplier:'阿里云'})],[doc({payerName:'阿里云计算有限公司'})],[rule({threshold:85})]);
  expect(result.matches).toHaveLength(1);
 });
 it('未匹配结果给出具体名称原因',()=>{
  const result=evaluateRules([voucher()],[doc({payerName:'完全不同的企业'})],[rule()]);
  expect(result.matches).toEqual([]);expect(result.outcomes[0]?.reason).toMatch(/付款人|名称|客商/);
 });
 it('配置的单据类型覆盖默认规则类型',()=>{
  const result=evaluateRules([voucher()],[doc({type:'bank'})],[rule({conditions:{documentTypes:['bank']}})]);
  expect(result.matches).toHaveLength(1);
 });
});

describe('金额与日期条件对精确和模糊规则均生效',()=>{
 it('允许0.01元尾差，超过配置绝对容差不关联',()=>{
  expect(evaluateRules([voucher()],[doc({amount:100.01})],[rule({tolerance:0.01})]).matches).toHaveLength(1);
  const failed=evaluateRules([voucher()],[doc({amount:100.02})],[rule({tolerance:0.01})]);
  expect(failed.matches).toHaveLength(0);expect(failed.outcomes[0]?.reason).toMatch(/金额|容差/);
 });
 it('精确发票号同样遵守金额容差',()=>{
  const result=evaluateRules([voucher({invoiceNo:'INV-1'})],[doc({amount:101})],[exact({tolerance:0.05})]);
  expect(result.matches).toHaveLength(0);expect(result.outcomes[0]?.reason).toMatch(/金额|容差/);
 });
 it('精确规则执行dateWindow，调整为30天后才能跨本月29天匹配',()=>{
  const v=voucher({invoiceNo:'INV-1'}),d=doc({date:'2026-06-30'});
  const small=evaluateRules([v],[d],[exact({dateWindow:7})]);
  expect(small.matches).toHaveLength(0);expect(small.outcomes[0]?.reason).toMatch(/日期|窗口|天/);
  expect(evaluateRules([v],[d],[exact({dateWindow:30})]).matches).toHaveLength(1);
 });
 it('0天窗口只接受同一天',()=>{
  expect(evaluateRules([voucher({invoiceNo:'INV-1'})],[doc()],[exact({dateWindow:0})]).matches).toHaveLength(1);
  expect(evaluateRules([voucher({invoiceNo:'INV-1'})],[doc({date:'2026-06-02'})],[exact({dateWindow:0})]).matches).toHaveLength(0);
 });
 it('关闭日期窗口可匹配同期间不同日，但不能跨会计期间',()=>{
  const r=exact({dateWindow:0,conditions:{requireDate:false}}),v=voucher({invoiceNo:'INV-1'});
  expect(evaluateRules([v],[doc({date:'2026-06-30'})],[r]).matches).toHaveLength(1);
  expect(evaluateRules([v],[doc({date:'2026-07-01'})],[r]).matches).toHaveLength(0);
 });
 it('显式关闭金额校验后该配置被执行',()=>{
  const result=evaluateRules([voucher({invoiceNo:'INV-1'})],[doc({amount:120})],[exact({conditions:{requireAmount:false}})]);
  expect(result.matches).toHaveLength(1);
 });
 it('同付款人但金额和日期不同不会仅凭名字全匹配',()=>{
  const result=evaluateRules([voucher()],[doc({id:'wrong-amount',amount:200}),doc({id:'wrong-date',date:'2026-06-30'})],[rule()]);
  expect(result.matches).toHaveLength(0);expect(result.outcomes[0]?.reason).toBeTruthy();
 });
});

describe('客商按原件付款人语义执行',()=>{
 it('默认使用付款人，不能按legacy supplier的收款人值匹配',()=>{
  const d=doc({supplier:'测试收款方有限公司'});
  expect(evaluateRules([voucher()],[d],[rule()]).matches).toHaveLength(1);
  expect(evaluateRules([voucher({supplier:'测试收款方有限公司'})],[d],[rule()]).matches).toHaveLength(0);
 });
 it('显式空付款人不能拿收款人或旧supplier替代',()=>{
  const d=doc({payerName:'',payeeName:'测试付款方有限公司',supplier:'测试付款方有限公司'});
  expect(evaluateRules([voucher()],[d],[rule()]).matches).toHaveLength(0);
 });
 it('旧对象没有payerName字段时兼容原supplier',()=>{
  const d=doc();delete d.payerName;
  expect(evaluateRules([voucher()],[d],[rule()]).matches).toHaveLength(1);
 });
 it('付款人是本企业时也保留本企业，不能自动换成外部收款人',()=>{
  const d=doc({payerName:'本企业有限公司',payeeName:'外部供应商有限公司',supplier:'外部供应商有限公司'});
  expect(evaluateRules([voucher({supplier:'本企业有限公司'})],[d],[rule()]).matches).toHaveLength(1);
  expect(evaluateRules([voucher({supplier:'外部供应商有限公司'})],[d],[rule()]).matches).toHaveLength(0);
 });
 it('显式配置收款人或任一方后才允许按收款方关联',()=>{
  const v=voucher({supplier:'测试收款方有限公司'}),d=doc();
  expect(evaluateRules([v],[d],[rule({conditions:{partyField:'payeeName'}})]).matches).toHaveLength(1);
  expect(evaluateRules([v],[d],[rule({conditions:{partyField:'either'}})]).matches).toHaveLength(1);
 });
});

describe('汇总匹配与重复关联保护',()=>{
 it('唯一多张发票汇总按整数分匹配',()=>{
  const result=evaluateRules([voucher({amount:100.01})],[doc({id:'a',amount:60.01}),doc({id:'b',amount:40}),doc({id:'c',amount:17})],[aggregate({tolerance:0,threshold:100})]);
  expect(documentIds(result).sort()).toEqual(['a','b']);expect(result.matches[0]?.confidence).toBe(100);
 });
 it('发票与银行回单不能混合相加伪造汇总匹配',()=>{
  const result=evaluateRules([voucher()],[doc({id:'invoice',amount:60}),doc({id:'bank',type:'bank',amount:40})],[aggregate({conditions:{documentTypes:['invoice','bank']}})]);
  expect(result.matches).toHaveLength(0);
 });
 it('配置银行回单类型后允许同类多回单汇总',()=>{
  const result=evaluateRules([voucher()],[doc({id:'a',type:'bank',amount:60}),doc({id:'b',type:'bank',amount:40})],[aggregate({conditions:{documentTypes:['bank']}})]);
  expect(documentIds(result).sort()).toEqual(['a','b']);
 });
 it('存在多个等价汇总组合时留给人工确认',()=>{
  const result=evaluateRules([voucher()],[doc({id:'a',amount:60}),doc({id:'b',amount:60}),doc({id:'c',amount:40})],[aggregate()]);
  expect(result.matches).toHaveLength(0);expect(result.outcomes[0]?.reason).toMatch(/多个|歧义|不唯一|复核|人工确认/);
 });
 it('同一精确规则有多个候选后不能由后续模糊规则擅自挑一个',()=>{
  const result=evaluateRules([voucher({invoiceNo:'INV-1'})],[doc({id:'a'}),doc({id:'b',payerName:'不同付款方'})],[exact(),rule()]);
  expect(result.matches).toHaveLength(0);expect(result.outcomes[0]?.reason).toMatch(/多个|歧义|不唯一|复核|人工确认/);
 });
 it('两个凭证争用同一张单据时双方均留给人工',()=>{
  const result=evaluateRules([voucher({id:'v-1',invoiceNo:'INV-1'}),voucher({id:'v-2',no:'记-2',invoiceNo:'INV-1'})],[doc()],[exact(),rule()]);
  expect(result.matches).toHaveLength(0);expect(result.outcomes).toHaveLength(2);expect(result.outcomes.every(outcome=>outcome.reason.length>0)).toBe(true);
 });
 it('高优先级认领后低优先级不能再次关联同一单据',()=>{
  const result=evaluateRules([voucher({id:'v-1',invoiceNo:'INV-1'}),voucher({id:'v-2',no:'记-2'})],[doc()],[exact(),rule()]);
  expect(result.matches).toHaveLength(1);expect(result.matches[0]?.voucherId).toBe('v-1');expect(documentIds(result)).toEqual(['d-1']);
 });
 it('已匹配的单据和凭证不会重新认领',()=>{
  const result=evaluateRules([voucher(),voucher({id:'done',status:'matched',documentIds:['already']})],[doc({status:'matched'})],[rule()]);
  expect(result.matches).toHaveLength(0);expect(result.outcomes.map(outcome=>outcome.voucherId)).toEqual(['v-1']);
 });
 it('附件数量配置与汇总张数不一致不能通过',()=>{
  const result=evaluateRules([voucher({expectedAttachments:3})],[doc({id:'a',amount:60}),doc({id:'b',amount:40})],[aggregate()]);
  expect(result.matches).toHaveLength(0);
 });
});

describe('文字提取提示与自动匹配状态分离',()=>{
 it('完整且平衡的文字PDF即使请复核，也可以执行规则并保留原复核标记',()=>{
  const v=voucher({sourceKind:'pdf-text',reviewStatus:'pending',entries:balance(),sourcePages:[1],reviewReasons:['请核对实际附件数量']}),d=doc({sourceKind:'pdf-text',extractionStatus:'pending',sourcePages:[1],reviewReasons:['文字提取不核验印章']});
  const result=evaluateRules([v],[d],[rule()]);
  expect(result.matches).toHaveLength(1);expect(v.reviewStatus).toBe('pending');expect(d.extractionStatus).toBe('pending');expect(v.status).toBe('pending');expect(d.status).toBe('pending');
 });
 it('非文字PDF通道的未复核字段仍需补录',()=>{
  expect(evaluateRules([voucher()],[doc({extractionStatus:'pending'})],[rule()]).matches).toHaveLength(0);
  expect(evaluateRules([voucher({reviewStatus:'pending'})],[doc()],[rule()]).matches).toHaveLength(0);
 });
 it('缺日期、编号或金额的原件不会被名称规则强行匹配',()=>{
  for(const d of [doc({date:''}),doc({number:''}),doc({amount:0})])expect(evaluateRules([voucher()],[d],[rule()]).matches).toHaveLength(0);
 });
 it('关闭日期窗口也不允许无效会计日期通过',()=>{
  const result=evaluateRules([voucher({invoiceNo:'INV-1'})],[doc({date:'2026-06-31'})],[exact({conditions:{requireDate:false}})]);
  expect(result.matches).toHaveLength(0);
 });
 it('零净额、原负分录、借贷不平衡及显式专项限制均受保护',()=>{
  const cases=[voucher({amount:0}),voucher({sourceKind:'pdf-text',reviewStatus:'pending',entries:[{summary:'冲销',account:'费用',debit:'110.00',credit:'0.00'},{summary:'冲销',account:'费用',debit:'-10.00',credit:'0.00'},{summary:'冲销',account:'银行',debit:'0.00',credit:'100.00'}]}),voucher({sourceKind:'pdf-text',reviewStatus:'pending',entries:balance('99.00')}),voucher({autoMatchBlockedReasons:['多个往来对象需人工分配']})];
  for(const v of cases){const result=evaluateRules([v],[doc()],[rule()]);expect(result.matches).toHaveLength(0);expect(result.outcomes[0]?.reason).toBeTruthy();}
 });
 it('输出包含每张待处理凭证的结果，且不修改任何输入集合或字段',()=>{
  const vs=[voucher(),voucher({id:'unmatched',supplier:'其他企业'})],ds=[doc()],rs=[rule()];const before=JSON.stringify({vs,ds,rs});
  const result=evaluateRules(vs,ds,rs);
  expect(result.outcomes).toHaveLength(2);expect(result.outcomes.find(outcome=>outcome.voucherId==='v-1')?.matched).toBe(true);expect(result.outcomes.find(outcome=>outcome.voucherId==='unmatched')?.matched).toBe(false);expect(JSON.stringify({vs,ds,rs})).toBe(before);
 });
});
