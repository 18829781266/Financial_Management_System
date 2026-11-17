import 'fake-indexeddb/auto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {nextTick} from 'vue';
import {useArchiveStore} from '../src/store';
import {completeVoucherReview} from '../src/reviewCompletion';
import {collectionStatus} from '../src/matchWorkflow';
import {visibleArchiveGroups} from '../src/nameAssociation';

const memory=new Map<string,string>();
vi.stubGlobal('localStorage',{getItem:(key:string)=>memory.get(key)||null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)});
let store=useArchiveStore();
const bank='合成开户银行股份有限公司';
const customer='合成核算企业有限公司';
const file=(name='合成回单.pdf')=>new File(['%PDF-1.7\nSynthetic review completion fixture'],name,{type:'application/pdf'});
const feeValues=(no='记-24',date='2026-09-01',supplier='待确认往来对象',amount='93.50')=>({no,period:date.slice(0,7),date,summary:'手续费',supplier,amount,entries:[{summary:'手续费',account:'6603 财务费用',debit:amount,credit:'0.00'},{summary:'支付手续费',account:'1002 银行存款_尾号3325',debit:'0.00',credit:amount}]});
async function fee(no='记-24',date='2026-09-01',amount='93.50'){
 await store.importVoucherBatch([{file:file(no+'.pdf'),values:feeValues(no,date,'待确认往来对象',amount)}]);
 return store.state.vouchers.find(v=>v.no===no)!;
}
async function receipt(number='FEE-1',date='2026-09-01',amount='93.50'){
 return store.addDocument(file(number+'.pdf'),{number,type:'bank',supplier:customer,payerName:customer,payeeName:bank,payerAccount:'622200003325',date,amount,partyVersion:2,accountVersion:1,extractionStatus:'reviewed'});
}
function onlyRules(...ids:string[]){for(const rule of store.state.rules)store.updateRule(rule.id,{enabled:ids.includes(rule.id)});}
async function partialTwoAttachments(){
 const values={no:'记-部分',period:'2026-09',date:'2026-09-01',summary:'合成两笔付款',supplier:bank,amount:'300.00',expectedAttachments:'2',entries:[
  {summary:'第一笔付款',account:'1002 银行存款_尾号3325',debit:'0.00',credit:'100.00'},
  {summary:'第二笔付款',account:'1002 银行存款_尾号7788',debit:'0.00',credit:'200.00'},
  {summary:'合计费用',account:'6603 财务费用',debit:'300.00',credit:'0.00'},
 ]};
 await store.importVoucherBatch([{file:file('两笔付款.pdf'),values}]);
 const voucher=store.state.vouchers.find(v=>v.no===values.no)!;
 const first=await receipt('PART-A','2026-09-01','100.00');
 const second=await store.addDocument(file('PART-B.pdf'),{number:'PART-B',type:'bank',supplier:customer,payerName:customer,payeeName:bank,payerAccount:'622200009999',date:'2026-09-01',amount:'200.00',partyVersion:2,accountVersion:1,extractionStatus:'reviewed'});
 await store.autoMatch(voucher.period);
 expect(voucher.status).toBe('pending');expect(voucher.documentIds).toEqual([first.id]);expect(voucher.expectedAttachments).toBe(2);
 return {voucher,first,second,values};
}
beforeEach(async()=>{await store.resetData();await nextTick();onlyRules('R09');});

describe('编辑字段后完成复核与电子档案同步',()=>{
 it('手续费补全真实往来对象后，保存完成动作提交唯一回单并持久化档案成员',async()=>{
  const voucher=await fee(),doc=await receipt();
  await store.autoMatch(voucher.period);
  expect(collectionStatus(voucher)).toBe('review');expect(voucher.documentIds).toEqual([]);
  store.updateVoucher(voucher.id,feeValues(voucher.no,voucher.date,bank));
  expect(voucher.reviewStatus).toBe('reviewed');expect(collectionStatus(voucher)).toBe('review');
  const result=await completeVoucherReview(store,voucher.id);
  expect(result.completed).toBe(true);expect(result.voucher.id).toBe(voucher.id);expect(collectionStatus(voucher)).toBe('matched');
  expect(voucher.documentIds).toEqual([doc.id]);expect(voucher.entryAttachments?.[0]?.entryIndex).toBe(1);
  expect(visibleArchiveGroups(store.state).some(g=>g.voucherIds.includes(voucher.id)&&g.documentIds.includes(doc.id))).toBe(true);
  expect(store.state.archives).toEqual([]);
  await nextTick();vi.resetModules();store=(await import('../src/store')).useArchiveStore();
  const restored=store.state.vouchers.find(v=>v.id===voucher.id)!;
  expect(collectionStatus(restored)).toBe('matched');expect(restored.documentIds).toEqual([doc.id]);
  expect(visibleArchiveGroups(store.state).some(g=>g.voucherIds.includes(restored.id))).toBe(true);
 });
 it('40.80元手续费同样按实际金额与方向完成，不使用固定金额或手工改成功',async()=>{
  const voucher=await fee('记-18','2026-09-01','40.80'),doc=await receipt('FEE-40','2026-09-01','40.80');
  store.updateVoucher(voucher.id,feeValues(voucher.no,voucher.date,bank,'40.80'));
  const result=await completeVoucherReview(store,voucher.id);
  expect(result.completed).toBe(true);expect(voucher.amount).toBe(40.8);expect(voucher.documentIds).toEqual([doc.id]);
 });
 it('同额同账号的歧义回单不会因保存字段而被任选，继续提供真实复核原因',async()=>{
  const voucher=await fee();await receipt('SAME-A');await receipt('SAME-B');
  store.updateVoucher(voucher.id,feeValues(voucher.no,voucher.date,bank));
  const result=await completeVoucherReview(store,voucher.id);
  expect(result.completed).toBe(false);expect(collectionStatus(voucher)).toBe('review');expect(result.reason).toMatch(/唯一|歧义|多|复核/);
  expect(voucher.documentIds).toEqual([]);expect(voucher.noAttachmentRequired).not.toBe(true);expect(store.state.archives).toEqual([]);
 });
 it('按照复核后凭证实际期间匹配，不使用旧期间或修改另一期间的待复核凭证',async()=>{
  const voucher=await fee('记-跨期','2026-09-30'),other=await fee('记-保留','2026-09-01','40.80');
  other.matchReviewRequired=true;other.lastMatchReason='另一期间原有复核原因';
  await receipt('OCT-FEE','2026-10-20');
  store.updateVoucher(voucher.id,feeValues(voucher.no,'2026-10-20',bank));
  const before=JSON.stringify(other),match=vi.spyOn(store,'autoMatch');
  const result=await completeVoucherReview(store,voucher.id);
  expect(result.completed).toBe(true);expect(match).toHaveBeenCalledWith('2026-10');expect(JSON.stringify(other)).toBe(before);
  match.mockRestore();
 });
 it('已按保存客商进入唯一同期企业组时直接完成，保留名称关联与财务附件的区别',async()=>{
  onlyRules('R08');
  await store.importVoucherBatch([{file:file(),values:{no:'名称-原',period:'2026-09',date:'2026-09-01',summary:'合成名称归集',supplier:customer,amount:'100.00'}}]);
  await store.addDocument(file('公司原件.pdf'),{number:'NAME-1',type:'invoice',supplier:customer,payerName:customer,payeeName:'合成交易方',date:'2026-09-01',amount:'999.00',extractionStatus:'reviewed',seal:true,invoiceCarrier:'paper'});
  await store.autoMatch('2026-09');
  await store.importVoucherBatch([{file:file(),values:{no:'名称-补',period:'2026-09',date:'2026-09-01',summary:'补录往来对象',supplier:'原有错误对象',amount:'40.80'}}]);
  const voucher=store.state.vouchers.find(v=>v.no==='名称-补')!;
  store.updateVoucher(voucher.id,{no:voucher.no,period:voucher.period,date:voucher.date,summary:voucher.summary,supplier:customer,amount:'40.80'});
  expect(collectionStatus(voucher)).toBe('matched');
  const match=vi.spyOn(store,'autoMatch'),result=await completeVoucherReview(store,voucher.id);
  expect(result.completed).toBe(true);expect(match).not.toHaveBeenCalled();expect(voucher.status).toBe('pending');expect(voucher.documentIds).toEqual([]);
  expect(visibleArchiveGroups(store.state).some(g=>g.voucherIds.includes(voucher.id))).toBe(true);match.mockRestore();
 });
 it('无候选时继续复核，不自动豁免附件或生成正式册',async()=>{
  const voucher=await fee();store.updateVoucher(voucher.id,feeValues(voucher.no,voucher.date,bank));
  const result=await completeVoucherReview(store,voucher.id);
  expect(result.completed).toBe(false);expect(result.reason).not.toBe('');expect(voucher.documentIds).toEqual([]);expect(voucher.noAttachmentRequired).not.toBe(true);expect(store.state.archives).toEqual([]);
 });
 it('正式锁定或已不存在的凭证被拒绝，不重新匹配',async()=>{
  const voucher=await fee();
  store.state.archives.push({id:'locked',title:'合成锁定册',period:voucher.period,startVoucherNo:voucher.no,endVoucherNo:voucher.no,voucherIds:[voucher.id],voucherCount:1,pageCount:1,amount:voucher.amount,status:'locked',createdAt:'2026-11-12'});
  const match=vi.spyOn(store,'autoMatch');
  await expect(completeVoucherReview(store,voucher.id)).rejects.toThrow('归档锁定');
  await expect(completeVoucherReview(store,'missing-id')).rejects.toThrow('已不存在');expect(match).not.toHaveBeenCalled();match.mockRestore();
 });
 it('重试匹配失败会向编辑界面抛出原错误，不能返回已完成',async()=>{
  const voucher=await fee(),before=JSON.stringify(voucher);
  const autoMatch=vi.fn().mockRejectedValue(new Error('合成持久化或匹配失败'));
  await expect(completeVoucherReview({state:store.state,isVoucherLocked:store.isVoucherLocked,autoMatch},voucher.id)).rejects.toThrow('合成持久化或匹配失败');
  expect(autoMatch).toHaveBeenCalledWith(voucher.period);expect(JSON.stringify(voucher)).toBe(before);
 });
 it('已关联1份而预计2份的部分分录可重新保存字段，继续完成第二笔人工关联',async()=>{
  const {voucher,first,second,values}=await partialTwoAttachments();
  expect(()=>store.updateVoucher(voucher.id,{...values,summary:'复核两笔付款'})).not.toThrow();
  expect(voucher.expectedAttachments).toBe(2);expect(voucher.documentIds).toEqual([first.id]);
  store.reconcileEntryAllocations(voucher.id,1,[{documentId:second.id,allocatedAmount:'200.00',relationType:'settlement'}],'已核对第二笔原件，确认科目账号尾号与回单存在人工例外');
  const result=await completeVoucherReview(store,voucher.id);
  expect(result.completed).toBe(true);expect(voucher.documentIds).toEqual([first.id,second.id]);expect(voucher.expectedAttachments).toBe(2);
  expect(visibleArchiveGroups(store.state).some(g=>g.voucherIds.includes(voucher.id)&&g.documentIds.includes(first.id)&&g.documentIds.includes(second.id))).toBe(true);
 });
 it('已完成匹配的凭证仍不能把附件总数改为与实际关联不一致',async()=>{
  const {voucher,second,values}=await partialTwoAttachments();
  store.reconcileEntryAllocations(voucher.id,1,[{documentId:second.id,allocatedAmount:'200.00',relationType:'settlement'}],'核对第二笔合成回单');
  expect(voucher.status).toBe('matched');
  expect(()=>store.updateVoucher(voucher.id,{...values,expectedAttachments:'1'})).toThrow('附件数必须与当前关联单据一致');
  expect(voucher.expectedAttachments).toBe(2);expect(voucher.documentIds).toHaveLength(2);
 });
 it('部分匹配仍拒绝把预计附件总数缩减到已有关联数量以下',async()=>{
  const values={no:'记-三笔',period:'2026-09',date:'2026-09-01',summary:'合成三笔付款',supplier:bank,amount:'350.00',expectedAttachments:'3',entries:[
   {summary:'第一笔',account:'1002 银行存款_尾号3325',debit:'0.00',credit:'100.00'},
   {summary:'第二笔',account:'1002 银行存款_尾号7788',debit:'0.00',credit:'200.00'},
   {summary:'第三笔',account:'1002 银行存款_尾号9999',debit:'0.00',credit:'50.00'},
   {summary:'合计费用',account:'6603 财务费用',debit:'350.00',credit:'0.00'},
  ]};
  await store.importVoucherBatch([{file:file('三笔付款.pdf'),values}]);
  const first=await receipt('THREE-A','2026-09-01','100.00');
  const second=await store.addDocument(file('THREE-B.pdf'),{number:'THREE-B',type:'bank',supplier:customer,payerName:customer,payeeName:bank,payerAccount:'622200007788',date:'2026-09-01',amount:'200.00',partyVersion:2,accountVersion:1,extractionStatus:'reviewed'});
  await store.autoMatch(values.period);const voucher=store.state.vouchers.find(v=>v.no===values.no)!;
  expect(voucher.documentIds).toHaveLength(2);expect(voucher.status).toBe('pending');
  expect(()=>store.updateVoucher(voucher.id,{...values,expectedAttachments:'1'})).toThrow('附件数不能少于当前已关联单据数');
  expect(voucher.expectedAttachments).toBe(3);expect(new Set(voucher.documentIds)).toEqual(new Set([first.id,second.id]));expect(collectionStatus(voucher)).toBe('review');
 });
});
