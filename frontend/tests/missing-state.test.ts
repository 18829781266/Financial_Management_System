import 'fake-indexeddb/auto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {nextTick} from 'vue';
import {useArchiveStore} from '../src/store';
import {completeVoucherReview} from '../src/reviewCompletion';
import {visibleArchiveGroups} from '../src/nameAssociation';
import type {Voucher} from '../src/types';

const memory=new Map<string,string>();
vi.stubGlobal('localStorage',{getItem:(key:string)=>memory.get(key)||null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)});
let store=useArchiveStore();
const company='缺失标记回归合成企业有限公司',bank='合成银行股份有限公司';
const file=(name:string)=>new File(['%PDF-1.7\nSynthetic missing-state regression'],name,{type:'application/pdf'});
function values(no:string,amount:string,date='2026-09-01'){
 return {no,period:date.slice(0,7),date,summary:'合成银行付款',supplier:bank,amount,entries:[
  {summary:'合成费用',account:'6603 财务费用',debit:amount,credit:'0.00'},
  {summary:'合成付款',account:'1002 银行存款_尾号3325',debit:'0.00',credit:amount},
 ]};
}
async function voucher(no:string,amount:string,date='2026-09-01'){
 await store.importVoucherBatch([{file:file(no+'.pdf'),values:values(no,amount,date)}]);
 return store.state.vouchers.find(item=>item.no===no)!;
}
async function receipt(number:string,amount:string,date='2026-09-01'){
 return store.addDocument(file(number+'.pdf'),{number,type:'bank',supplier:company,payerName:company,payeeName:bank,payerAccount:'622200003325',date,amount,partyVersion:2,accountVersion:1,extractionStatus:'reviewed'});
}
function onlyRules(...ids:string[]){for(const rule of store.state.rules)store.updateRule(rule.id,{enabled:ids.includes(rule.id)});}
function remainsMissing(item:Voucher,reason:string){
 expect(item.status).toBe('missing');expect(item.missingReason).toBe(reason);expect(item.matchReviewRequired).toBe(true);
 expect(item.nameAssociationIds||[]).toEqual([]);
}
beforeEach(async()=>{await store.resetData();await nextTick();onlyRules('R09');});

describe('附件缺失是明确标记，不受其他凭证复核重算覆盖',()=>{
 it('标记两张缺失后保存并完成第三张，两张原缺失及原因保留并可刷新恢复',async()=>{
  const first=await voucher('记-缺失甲','93.50'),second=await voucher('记-缺失乙','40.80'),reviewed=await voucher('记-复核丙','125.65');
  const firstDoc=await receipt('MISSING-A','93.50'),secondDoc=await receipt('MISSING-B','40.80'),thirdDoc=await receipt('REVIEW-C','125.65');
  store.markMissing(first.id,'甲原件待客户补交');store.markMissing(second.id,'乙回单待银行补打');
  store.updateVoucher(reviewed.id,{...values(reviewed.no,'125.65'),summary:'已核对丙的原件'});
  const result=await completeVoucherReview(store,reviewed.id);
  expect(result.completed).toBe(true);expect(reviewed.documentIds).toEqual([thirdDoc.id]);
  remainsMissing(first,'甲原件待客户补交');remainsMissing(second,'乙回单待银行补打');
  expect(first.documentIds).toEqual([]);expect(second.documentIds).toEqual([]);
  expect(firstDoc.status).toBe('pending');expect(secondDoc.status).toBe('pending');
  expect(visibleArchiveGroups(store.state).some(group=>group.voucherIds.includes(first.id)||group.voucherIds.includes(second.id))).toBe(false);
  await nextTick();vi.resetModules();store=(await import('../src/store')).useArchiveStore();
  remainsMissing(store.state.vouchers.find(item=>item.id===first.id)!,'甲原件待客户补交');
  remainsMissing(store.state.vouchers.find(item=>item.id===second.id)!,'乙回单待银行补打');
  expect(store.state.vouchers.find(item=>item.id===reviewed.id)!.documentIds).toEqual([thirdDoc.id]);
 });
 it('同额同账号缺失凭证不会在评估上下文竞争待复核凭证的唯一回单',async()=>{
  const missing=await voucher('记-缺失竞争','100.00'),reviewed=await voucher('记-正常竞争','100.00'),doc=await receipt('ONLY-CANDIDATE','100.00');
  store.markMissing(missing.id,'已确认该笔另需原件');
  const result=await completeVoucherReview(store,reviewed.id);
  expect(result.completed).toBe(true);expect(reviewed.documentIds).toEqual([doc.id]);
  remainsMissing(missing,'已确认该笔另需原件');expect(missing.documentIds).toEqual([]);
 });
 it('按期间及全量重复匹配不重置缺失，也不为缺失凭证自动建立名称关联',async()=>{
  onlyRules('R08');
  await store.importVoucherBatch([{file:file('名称待补.pdf'),values:{no:'名称待补',period:'2026-09',date:'2026-09-01',summary:'原件待补',supplier:company,amount:'100.00'}}]);
  const missing=store.state.vouchers[0]!;store.markMissing(missing.id,'需客户提供原始单据');
  await store.addDocument(file('同名原件.pdf'),{number:'NAME-PENDING',type:'invoice',supplier:company,payerName:company,payeeName:'合成供货商有限公司',date:'2026-09-01',amount:'999.00',extractionStatus:'reviewed',seal:true,invoiceCarrier:'paper'});
  const other=await voucher('另一期间缺失','70.00','2026-10-01');store.markMissing(other.id,'十月原件待交');
  for(const period of ['2026-09',undefined,'2026-09',undefined]){
   await store.autoMatch(period);
   remainsMissing(missing,'需客户提供原始单据');remainsMissing(other,'十月原件待交');
   expect(missing.documentIds).toEqual([]);expect(other.documentIds).toEqual([]);
   expect(store.state.nameAssociations?.some(group=>group.voucherIds.includes(missing.id)||group.voucherIds.includes(other.id))).toBe(false);
  }
 });
 it('编辑缺失凭证自身的普通字段时保留缺失状态和原始原因',async()=>{
  const missing=await voucher('记-自身编辑','100.00');store.markMissing(missing.id,'已向客户催交原件');
  store.updateVoucher(missing.id,{...values(missing.no,'100.00'),summary:'仅更正摘要，不代表附件补齐'});
  remainsMissing(missing,'已向客户催交原件');expect(missing.summary).toBe('仅更正摘要，不代表附件补齐');
  const result=await completeVoucherReview(store,missing.id);
  expect(result.completed).toBe(false);remainsMissing(missing,'已向客户催交原件');
 });
 it('明确恢复待匹配后才重新进入自动匹配池并按原规则完成关联',async()=>{
  const missing=await voucher('记-恢复','100.00'),doc=await receipt('RESTORE-MATCH','100.00');
  store.markMissing(missing.id,'原件待补');await store.autoMatch(missing.period);
  remainsMissing(missing,'原件待补');expect(missing.documentIds).toEqual([]);
  store.restoreMissing(missing.id);expect(missing.status).toBe('pending');expect(missing.missingReason).toBeUndefined();
  await store.autoMatch(missing.period);
  expect(missing.status).toBe('matched');expect(missing.documentIds).toEqual([doc.id]);
 });
 it('原有明确人工补齐原件并关联的操作仍可完成缺失凭证',async()=>{
  onlyRules();
  await store.importVoucherBatch([{file:file('人工补齐.pdf'),values:{no:'记-人工补齐',period:'2026-09',date:'2026-09-01',summary:'合成普通费用',supplier:company,amount:'100.00'}}]);
  const missing=store.state.vouchers[0]!;
  const doc=await store.addDocument(file('人工原件.pdf'),{number:'MANUAL-RESTORE',type:'invoice',supplier:company,payerName:company,payeeName:'合成供应方',date:'2026-09-01',amount:'100.00',extractionStatus:'reviewed',invoiceCarrier:'paper',seal:true});
  store.markMissing(missing.id,'等待客户补件');
  store.manualMatch(missing.id,[doc.id],'客户已补交发票，原件金额及业务核对一致');
  expect(missing.status).toBe('matched');expect(missing.missingReason).toBeUndefined();expect(missing.documentIds).toEqual([doc.id]);
 });
 it('缺失凭证已经确认的部分分摊继续占用金额，其他凭证只能消费剩余额度',async()=>{
  const partialValues={...values('记-部分缺失','150.00'),entries:[
   {summary:'合成费用',account:'6603 财务费用',debit:'150.00',credit:'0.00'},
   {summary:'已核对第一笔',account:'1002 银行存款_尾号3325',debit:'0.00',credit:'100.00'},
   {summary:'待补第二笔原件',account:'1002 银行存款_尾号7788',debit:'0.00',credit:'50.00'},
  ]};
  await store.importVoucherBatch([{file:file('部分缺失.pdf'),values:partialValues}]);
  const missing=store.state.vouchers[0]!,doc=await receipt('SHARED-REMAINING','150.00');
  store.reconcileEntryAllocations(missing.id,1,[{documentId:doc.id,allocatedAmount:'100.00',relationType:'settlement'}],'已核对本回单中第一笔100元，剩余50元另属其他业务');
  expect(missing.status).toBe('pending');expect(doc.remainingAmount).toBe('50.00');
  store.markMissing(missing.id,'第二笔原件待客户补交');
  const priorLinks=JSON.stringify(missing.entryAttachments);
  store.updateVoucher(missing.id,{...partialValues,summary:'仅补充摘要，第二笔仍缺原件'});
  remainsMissing(missing,'第二笔原件待客户补交');expect(JSON.stringify(missing.entryAttachments)).toBe(priorLinks);
  const remainder=await voucher('记-剩余额度','50.00');
  await store.autoMatch('2026-09');
  remainsMissing(missing,'第二笔原件待客户补交');expect(JSON.stringify(missing.entryAttachments)).toBe(priorLinks);
  expect(remainder.status).toBe('matched');expect(remainder.entryAttachments?.[0]?.allocatedAmount).toBe('50.00');
  const wrongTotal=await voucher('记-不能再用整额','150.00');
  await store.autoMatch('2026-09');
  expect(wrongTotal.status).toBe('pending');expect(wrongTotal.documentIds).toEqual([]);
  expect(doc.allocatedAmount).toBe('150.00');expect(doc.remainingAmount).toBe('0.00');
 });
});
