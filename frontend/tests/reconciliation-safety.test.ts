import 'fake-indexeddb/auto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {nextTick} from 'vue';
import {evaluateEntryAttachments,receiptEntryRule} from '../src/entryAttachments';
import {evaluateRules} from '../src/matchingEngine';
import {computeMatchPlan} from '../src/matchPlanCore';
import {documentAllocatedCents,documentRemainingCents} from '../src/evidenceRelations';
import {useArchiveStore} from '../src/store';
import type {MatchRule,SourceDocument,Voucher} from '../src/types';

const party='合成甲方有限公司',own='合成核算主体有限公司',account='622200003325';
const receiptRule=receiptEntryRule();
function voucher(id='v-1',amounts=[100],side:'debit'|'credit'='debit'):Voucher {
 const total=amounts.reduce((sum,value)=>sum+value,0);
 return {id,no:id,period:'2026-10',date:'2026-10-01',summary:'合成核对业务',supplier:party,company:own,amount:total,status:'pending',reviewStatus:'reviewed',documentIds:[],entries:[
  ...amounts.map(amount=>({summary:'合成银行分录',account:`1002 银行存款_账号${account}`,debit:side==='debit'?amount.toFixed(2):'0.00',credit:side==='credit'?amount.toFixed(2):'0.00'})),
  {summary:'合成对方科目',account:'1122 应收账款',debit:side==='credit'?total.toFixed(2):'0.00',credit:side==='debit'?total.toFixed(2):'0.00'},
 ]};
}
function bank(id='d-1',amount=100):SourceDocument {
 return {id,name:id+'.pdf',type:'bank',number:id,date:'2026-10-02',amount,supplier:party,payerName:party,payeeName:own,payerAccount:account,payeeAccount:account,seal:false,status:'pending',extractionStatus:'reviewed'};
}
function whole(id='v-whole',amount=150):Voucher {const result=voucher(id,[amount]);delete result.entries;return result;}
const wholeRule=(id='R06'):MatchRule=>({id,name:'合成整单回单规则',description:'合成测试',enabled:true,priority:2,threshold:100,tolerance:0,dateWindow:7,matchType:id==='R03'?'exact':'fuzzy'});
const evaluate=(vs:Voucher[],ds:SourceDocument[],all=vs)=>evaluateEntryAttachments(vs,ds,receiptRule,all);
function partialPrior(document:SourceDocument,cents='100.00'):Voucher {
 const prior=voucher('prior',[150]);
 prior.documentIds=[document.id];prior.entryAttachments=[{entryIndex:0,documentId:document.id,side:'debit',ruleId:'MANUAL',allocatedAmount:cents,relationType:'settlement'}];
 return prior;
}

describe('回单自动关联的主体、金额与唯一性安全边界',()=>{
 it('同一企业银行账号不能代替外部客商核对',()=>{
  const v=voucher(),d=bank();d.payerName='合成乙方有限公司';
  const result=evaluate([v],[d]);
  expect(result.matches).toEqual([]);expect(result.outcomes[0]?.reason).toContain('客商不一致');expect(result.documentOutcomes[0]?.reason).toContain('客商');
 });
 it('收款核付款人，付款核收款人，不混用角色',()=>{
  const credit=voucher('pay',[100],'credit'),d=bank();d.payerName=own;d.payeeName=party;
  expect(evaluate([credit],[d]).matches[0]?.complete).toBe(true);
  d.payerName=party;d.payeeName='合成乙方有限公司';
  expect(evaluate([credit],[d]).matches).toEqual([]);
 });
 it('分录辅助客商与凭证总客商冲突时转人工',()=>{
  const v=voucher();v.entries![0]!.counterparty='合成乙方有限公司';
  expect(evaluate([v],[bank()]).outcomes[0]?.reason).toContain('客商不一致');
  v.entries![0]!.counterparty=party;
  expect(evaluate([v],[bank()]).matches[0]?.complete).toBe(true);
 });
 it('可靠往来科目的多个辅助客商不能被总客商覆盖',()=>{
  const v=voucher();v.entries![1]!.account='1122 应收账款_0001.合成乙方有限公司';
  expect(evaluate([v],[bank()]).matches).toEqual([]);
  v.entries![1]!.account='1122 应收账款_0001.'+party;
  expect(evaluate([v],[bank()]).matches[0]?.complete).toBe(true);
 });
 it('只有核算主体或缺失外部付款人的回单不自动确认',()=>{
  const v=voucher();v.supplier=own;
  expect(evaluate([v],[bank()]).outcomes[0]?.reason).toContain('外部往来客商');
  v.supplier=party;const d=bank();d.payerName='';
  expect(evaluate([v],[d]).outcomes[0]?.reason).toContain('付款人缺失');
 });
 it('不把集团或公司后缀不同的法律主体当作同名',()=>{
  const v=voucher(),d=bank();d.payerName='合成甲方集团有限公司';
  expect(evaluate([v],[d]).matches).toEqual([]);
  d.payerName=' 合成甲方有限公司 ';
  expect(evaluate([v],[d]).matches[0]?.complete).toBe(true);
 });
 it('显式指定交易流水时不能被同额同名的另一流水替换',()=>{
  const v=voucher(),d=bank();v.entries![0]!.bankNo='FLOW-A';d.bankNo='FLOW-B';
  expect(evaluate([v],[d]).outcomes[0]?.reason).toContain('流水或回单标识');
  d.bankNo='FLOW-A';expect(evaluate([v],[d]).matches[0]?.complete).toBe(true);
 });
 it('单张100与40加60同时成立，必须判为两个完整解',()=>{
  const result=evaluate([voucher()],[bank('full',100),bank('part-a',40),bank('part-b',60)]);
  expect(result.matches).toEqual([]);expect(result.outcomes[0]?.reason).toContain('多种回单分摊组合');
 });
 it('唯一整份组合可自动匹配，不截取额外大额回单',()=>{
  const result=evaluate([voucher()],[bank('a',40),bank('b',60),bank('unneeded',200)]);
  expect(result.matches[0]?.complete).toBe(true);expect(result.matches[0]?.documentIds.sort()).toEqual(['a','b']);
 });
 it('同额两份回单仍不按输入顺序认领',()=>{
  expect(evaluate([voucher()],[bank('first',100),bank('second',100)]).matches).toEqual([]);
 });
 it('100元分录不擅自从150元回单截取100元',()=>{
  const result=evaluate([voucher()],[bank('large',150)]);
  expect(result.matches).toEqual([]);expect(result.outcomes[0]?.reason).toContain('部分分摊');
 });
 it('150元回单完整覆盖100加50两条分录时仍支持自动分摊',()=>{
  const result=evaluate([voucher('split',[100,50])],[bank('full-150',150)]);
  expect(result.matches[0]?.complete).toBe(true);expect(result.matches[0]?.entryAttachments.map(link=>link.allocatedAmount)).toEqual(['100.00','50.00']);
 });
 it('大额回单超过所有候选分录合计，不能自动默取所需部分',()=>{
  const result=evaluate([voucher('split',[100,50])],[bank('large-200',200)]);
  expect(result.matches).toEqual([]);expect(result.outcomes[0]?.reason).toContain('部分分摊');
 });
 it('纯引擎拒绝未标识红字的负额凭证和负额回单',()=>{
  const v=voucher('red',[-100]),d=bank('red-d',-100);
  expect(evaluate([v],[d]).outcomes[0]?.reason).toContain('未标识红字');
  v.businessType='red-letter';expect(evaluate([v],[d]).documentOutcomes[0]?.reason).toContain('未标识红字');
  d.documentStatus='red-letter';expect(evaluate([v],[d]).matches[0]?.complete).toBe(true);
 });
 it('异常历史超额分摊不能制造反向可用余额',()=>{
  const d=bank(),prior=partialPrior(d,'150.00');
  const result=evaluate([voucher('new',[50])],[d],[prior,voucher('new',[50])]);
  expect(result.matches).toEqual([]);expect(result.documentOutcomes[0]?.reason).toContain('历史分摊已超额');
 });
 it('计算候选不修改输入对象和既有手工关系',()=>{
  const vs=[voucher()],ds=[bank('full',100),bank('a',40),bank('b',60)],before=JSON.stringify({vs,ds});
  evaluate(vs,ds);expect(JSON.stringify({vs,ds})).toBe(before);
 });
});

describe('分录与整凭证规则共享同一份余额',()=>{
 it.each(['R06','R03'])('%s不按原金额重复消耗pending部分分摊回单',id=>{
  const d=bank('receipt',150),prior=partialPrior(d),target=whole();target.bankNo=d.number;
  const result=evaluateRules([prior,target],[d],[wholeRule(id)]);
  expect(result.matches).toEqual([]);expect(documentRemainingCents(d,[prior])).toBe(5000);
 });
 it('不同期间的已有分摊仍排除整单自动匹配',()=>{
  const d=bank('receipt',150),prior=partialPrior(d),target=whole();prior.period='2026-09';prior.date='2026-09-30';
  expect(evaluateRules([prior,target],[d],[wholeRule()]).matches).toEqual([]);
 });
 it('红字回单已分摊部分不能再次以原负总额整单消耗',()=>{
  const d=bank('red',-150);d.documentStatus='red-letter';
  const prior=partialPrior(d,'-100.00');prior.amount=-150;prior.businessType='red-letter';
  const target=whole('red-whole',-150);target.businessType='red-letter';
  expect(evaluateRules([prior,target],[d],[wholeRule()]).matches).toEqual([]);
 });
 it('统一计划不会把150元回单变成100元分摊加150元整单的250元占用',()=>{
  const entry=voucher(),target=whole(),d=bank('receipt',150);
  const plan=computeMatchPlan({vouchers:[entry,target],documents:[d],rules:[receiptRule,wholeRule()],time:'2026-11-11'});
  const snapshots=[entry,target].map(v=>{
   const m=plan.financial.matches.find(match=>match.voucherId===v.id);
   return m?{...v,documentIds:m.documentIds,entryAttachments:m.entryAttachments}:v;
  });
  expect(documentAllocatedCents(d,snapshots)).toBeLessThanOrEqual(15000);
  expect(plan.financial.matches.find(match=>match.voucherId===entry.id)).toBeUndefined();
  expect(plan.financial.matches.find(match=>match.voucherId===target.id)?.documentIds).toEqual([d.id]);
 });
 it('共享合同即使被其他凭证引用仍可继续引用，余额防护不误伤背景资料',()=>{
  const d={...bank('contract',150),type:'contract' as const,status:'matched' as const};
  const prior=whole('prior');prior.status='matched';prior.documentIds=[d.id];
  const target=whole();target.contractNo=d.number;
  const r={...wholeRule(),id:'R02',matchType:'exact' as const};
  expect(evaluateRules([prior,target],[d],[r]).matches[0]?.documentIds).toEqual([d.id]);
 });
});

const memory=new Map<string,string>();
vi.stubGlobal('localStorage',{getItem:(key:string)=>memory.get(key)||null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)});
const store=useArchiveStore();
describe('部分分摊到后续自动匹配的真实存储流',()=>{
 beforeEach(async()=>{await store.resetData();await nextTick();for(const rule of store.state.rules)store.updateRule(rule.id,{enabled:rule.id==='R06'});});
 it('人工100元占用保留后，150元原总额不能被整单规则重新核销',async()=>{
  const first=voucher('stored-partial',[100,60]),second=whole('stored-whole');
  await store.importVouchers(new File([JSON.stringify([first,second])],'synthetic.json',{type:'application/json'}));
  const doc=await store.addDocument(new File(['%PDF-1.7\nSynthetic receipt'],'synthetic.pdf',{type:'application/pdf'}),bank('stored-receipt',150));
  const imported=store.state.vouchers.find(v=>v.no===first.no)!;
  store.reconcileEntryAllocations(imported.id,0,[{documentId:doc.id,allocatedAmount:'100.00'}],'已核对原件，本次仅分摊100元');
  expect(imported.status).toBe('pending');expect(doc.remainingAmount).toBe('50.00');
  await store.autoMatch();
  expect(store.state.vouchers.find(v=>v.no===second.no)?.documentIds).toEqual([]);
  expect(doc.allocatedAmount).toBe('100.00');expect(doc.remainingAmount).toBe('50.00');
  expect(imported.entryAttachments?.[0]?.ruleId).toBe('MANUAL');
 });
});
