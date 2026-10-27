import {describe,it,expect} from 'vitest';
import {accountInSubject,normalizeBankAccount,subjectAccounts,evaluateEntryAttachments,receiptEntryRule,writeReceiptReference,clearReceiptReference} from '../src/entryAttachments';
import {computeMatchPlan} from '../src/matchPlanCore';
import {nameAssociationRule} from '../src/nameAssociation';
import type {SourceDocument,Voucher} from '../src/types';

function voucher(id='v1',date='2026-09-30'):Voucher{return {id,no:`记-${id}`,date,period:date.slice(0,7),summary:'采购与服务',supplier:'付款单位',amount:300,status:'pending',documentIds:[],entries:[{summary:'采购货物',account:'1002 银行存款_尾号3325',debit:'100.00',credit:'0.00'},{summary:'支付服务费',account:'1002 银行存款_尾号7788',debit:'200.00',credit:'0.00'},{summary:'结转往来',account:'2202 应付账款',debit:'0.00',credit:'300.00'}]};}
function doc(id='d1',amount=100,payeeAccount='04536101040033325',date='2026-10-01'):SourceDocument{return {id,name:`${id}.pdf`,type:'bank',supplier:'付款单位',payerName:'付款单位',payeeName:'不同收款单位',amount,payeeAccount,date,number:id,seal:false,status:'pending',extractionStatus:'reviewed'};}
const evaluate=(vs:Voucher[],ds:SourceDocument[])=>evaluateEntryAttachments(vs,ds,receiptEntryRule());

describe('账号与分录金额联合条件',()=>{
 it('保留账号前导零，支持全角、空格、横线和掩码，拒绝短尾号及数值账号',()=>{
  expect(normalizeBankAccount('０４５３ ６１０１-０４００３３３２５')).toBe('04536101040033325');
  expect(normalizeBankAccount('****3325')).toBe('3325');expect(normalizeBankAccount('***325')).toBe('');expect(normalizeBankAccount(4536101040033325)).toBe('');
  expect(subjectAccounts('1002 银行存款')).toEqual([]);expect(accountInSubject('04536101040033325','1002 银行存款_尾号3325')).toBe(true);
 });
 it('两个完整账号不一致时，尾号碰巧相同也不能关联',()=>{
  expect(accountInSubject('04536101040033325','1002 银行存款_99999999040033325')).toBe(false);
  expect(accountInSubject('04536101040033325','1002 银行存款_04536101040033325')).toBe(true);
 });
 it('逐行比较而非凭证合计，跨月回单映射到各自摘要，输入不变',()=>{
  const vs=[voucher()],ds=[doc(),doc('d2',200,'622200007788')],before=JSON.stringify({vs,ds});
  const result=evaluate(vs,ds);expect(result.matches).toHaveLength(1);expect(result.matches[0]!.entryAttachments.map(link=>[link.entryIndex,link.documentId])).toEqual([[0,'d1'],[1,'d2']]);expect(result.matches[0]!.complete).toBe(true);expect(result.outcomes[0]!.matched).toBe(true);expect(JSON.stringify({vs,ds})).toBe(before);
 });
 it('只符合金额、只符合账号或金额相差一分，均不自动绑定',()=>{
  for(const receipt of [doc('wrong-account',100,'622200009999'),doc('wrong-amount',100.01),doc('total-amount',300)])expect(evaluate([voucher()],[receipt]).matches).toEqual([]);
 });
 it('整数分精确处理0.01与含千分位的金额',()=>{
  const v=voucher();v.amount=0.01;v.entries=[{summary:'尾差',account:'1002 银行存款_3325',debit:'0.01',credit:'0.00'},{summary:'尾差',account:'2202 应付账款',debit:'0.00',credit:'0.01'}];
  expect(evaluate([v],[doc('cent',0.01)]).matches[0]!.complete).toBe(true);
 });
 it('日期差29天可匹配，正好30天和无效日期不匹配',()=>{
  expect(evaluate([voucher()],[doc('day29',100,undefined,'2026-10-29')]).matches).toHaveLength(1);
  expect(evaluate([voucher()],[doc('day30',100,undefined,'2026-10-30')]).matches).toHaveLength(0);
  expect(evaluate([voucher()],[doc('invalid',100,undefined,'2026-02-30')]).matches).toHaveLength(0);
 });
 it('缺少账号不得用付款企业相同或流水号代替',()=>{
  const receipt=doc();delete receipt.payeeAccount;receipt.bankNo='04536101040033325';
  const result=evaluate([voucher()],[receipt]);expect(result.matches).toEqual([]);expect(result.documentOutcomes[0]!.reason).toContain('收款账号');
 });
 it('一张回单命中两张凭证或同张凭证两条分录时，均转人工',()=>{
  expect(evaluate([voucher('v1'),voucher('v2')],[doc()]).matches).toEqual([]);
  const v=voucher();v.amount=200;v.entries![1]={...v.entries![0]!};v.entries![2]!.credit='200.00';
  expect(evaluate([v],[doc()]).documentOutcomes[0]!.reason).toContain('多条分录');
 });
 it('两张等价回单争用同一分录时，不按文件顺序任选',()=>{
  const result=evaluate([voucher()],[doc('d1'),doc('d2')]);expect(result.matches).toEqual([]);expect(result.documentOutcomes).toHaveLength(2);expect(result.documentOutcomes.every(outcome=>outcome.reason.includes('多份'))).toBe(true);
 });
 it('部分成功保留真实分录关联，整张凭证仍请复核',()=>{
  const result=evaluate([voucher()],[doc()]);expect(result.matches[0]!.entryAttachments).toHaveLength(1);expect(result.matches[0]!.complete).toBe(false);expect(result.outcomes[0]!.matched).toBe(false);
 });
 it('多往来对象不再阻止符合账号条件的逐行匹配，借贷异常仍阻止',()=>{
  const v=voucher();v.autoMatchBlockedReasons=['包含多个往来对象，需人工分配附件'];expect(evaluate([v],[doc()]).matches).toHaveLength(1);
  v.entries![2]!.credit='299.99';expect(evaluate([v],[doc()]).matches).toEqual([]);
 });
 it('严格模式没有名称回退，停用只暂停匹配',()=>{
  const source=voucher(),receipt=doc();delete receipt.payeeAccount;
  const plan=computeMatchPlan({vouchers:[source],documents:[receipt,doc('d2')],rules:[receiptEntryRule(),nameAssociationRule()],time:'2026-10-27'});expect(plan.names).toEqual([]);
  const disabled={...receiptEntryRule(),enabled:false};expect(evaluateEntryAttachments([source],[doc()],disabled).matches).toEqual([]);
 });
 it('已消费的回单和已人工分配的分录不被重复消费',()=>{
  const v=voucher(),receipt=doc();receipt.status='matched';expect(evaluate([v],[receipt]).matches).toEqual([]);
  v.entryAttachments=[{entryIndex:0,documentId:'manual',side:'debit',ruleId:'MANUAL'}];expect(evaluate([v],[doc()]).matches).toEqual([]);
 });
 it('回单备注回写幂等并保留原备注，解绑清除对应系统行',()=>{
  const d=doc(),v=voucher();d.remarks='客户原备注';writeReceiptReference(d,v,0);writeReceiptReference(d,v,0);expect(d.remarks!.split('\n')).toHaveLength(2);expect(d.remarks).toContain(v.no);expect(d.matchedEntryIndex).toBe(0);
  clearReceiptReference(d);expect(d.remarks).toBe('客户原备注');expect(d.matchedVoucherNo).toBeUndefined();
 });
});
