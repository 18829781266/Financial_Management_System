import 'fake-indexeddb/auto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {nextTick} from 'vue';
import {useArchiveStore} from '../src/store';
import type {EntryAllocationInput,VoucherEntry} from '../src/types';

const memory=new Map<string,string>();
vi.stubGlobal('localStorage',{getItem:(key:string)=>memory.get(key)||null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)});
const store=useArchiveStore();
const file=(name:string)=>new File(['%PDF-1.7\nSynthetic allocation scenario'],name,{type:'application/pdf'});
const account='622200003325';

async function addVoucher(no:string,amounts:number[],date='2026-09-30',businessType:'normal'|'red-letter'='normal'){
 const total=amounts.reduce((sum,amount)=>sum+amount,0);
 const entries:VoucherEntry[]=[
  ...amounts.map((amount,index)=>({summary:`银行分录${index+1}`,account:'1002 银行存款_尾号3325',debit:amount.toFixed(2),credit:'0.00'})),
  {summary:'往来对方科目',account:'2202 应付账款',debit:'0.00',credit:total.toFixed(2)},
 ];
 await store.importVouchers(new File([JSON.stringify([{no,period:date.slice(0,7),date,summary:'分摊场景测试',supplier:'合成测试客商',amount:total.toFixed(2),businessType,entries}])],`${no}.json`,{type:'application/json'}));
 return store.state.vouchers.find(voucher=>voucher.no===no)!;
}
async function addBank(no:string,amount:number,date='2026-10-01',documentStatus:'normal'|'red-letter'|'void'='normal'){
 return store.addDocument(file(`${no}.pdf`),{number:no,type:'bank',supplier:'合成测试客商',payerName:'合成测试客商',payeeName:'合成测试收款方',payerAccount:account,payeeAccount:account,date,amount:amount.toFixed(2),documentStatus,extractionStatus:'reviewed'});
}
async function addContract(no:string){
 return store.addDocument(file(`${no}.pdf`),{number:no,type:'contract',supplier:'合成测试客商',payerName:'合成测试客商',date:'2026-08-01',amount:'999999.00',extractionStatus:'reviewed'});
}
function allocation(documentId:string,allocatedAmount:string):EntryAllocationInput{return {documentId,allocatedAmount,relationType:'settlement'};}

beforeEach(async()=>{
 await store.resetData();await nextTick();
 for(const rule of store.state.rules)store.updateRule(rule.id,{enabled:rule.id==='R09'});
});

describe('凭证据链分摊场景矩阵',()=>{
 it('一对一唯一匹配自动完成，金额与分录保持一致',async()=>{
  const voucher=await addVoucher('一对一',[100]),receipt=await addBank('R-ONE',100);
  expect((await store.autoMatch()).matched).toBe(1);
  expect(voucher.status).toBe('matched');expect(voucher.entryAttachments).toEqual([expect.objectContaining({documentId:receipt.id,allocatedAmount:'100.00'})]);
 });
 it('一条分录多份回单仅在精确组合唯一时自动提交',async()=>{
  const voucher=await addVoucher('一对多',[100]),first=await addBank('R-40',40),second=await addBank('R-60',60);
  await store.autoMatch();
  expect(voucher.status).toBe('matched');expect(new Set(voucher.entryAttachments?.map(link=>link.documentId))).toEqual(new Set([first.id,second.id]));
  expect(voucher.entryAttachments?.map(link=>link.allocatedAmount).sort()).toEqual(['40.00','60.00']);
 });
 it('一张回单可唯一拆分覆盖多条分录',async()=>{
  const voucher=await addVoucher('多对一',[40,60]),receipt=await addBank('R-100',100);
  await store.autoMatch();
  expect(voucher.status).toBe('matched');expect(voucher.entryAttachments).toHaveLength(2);
  expect(voucher.entryAttachments?.every(link=>link.documentId===receipt.id)).toBe(true);expect(receipt.remainingAmount).toBe('0.00');
 });
 it('复杂多对多不自动抢占，人工按每份单据分摊后可完成',async()=>{
  const firstVoucher=await addVoucher('多对多-A',[60,40]),secondVoucher=await addVoucher('多对多-B',[100]);
  const first=await addBank('MM-1',100),second=await addBank('MM-2',100);
  await store.autoMatch();
  expect(firstVoucher.status).toBe('pending');expect(secondVoucher.status).toBe('pending');expect(firstVoucher.entryAttachments||[]).toEqual([]);
  store.reconcileEntryAllocations(firstVoucher.id,0,[allocation(first.id,'60.00')],'核对多对多原件第一笔');
  store.reconcileEntryAllocations(firstVoucher.id,1,[allocation(first.id,'20.00'),allocation(second.id,'20.00')],'核对多对多原件第二笔');
  store.reconcileEntryAllocations(secondVoucher.id,0,[allocation(first.id,'20.00'),allocation(second.id,'80.00')],'核对多对多剩余额度');
  expect(firstVoucher.status).toBe('matched');expect(secondVoucher.status).toBe('matched');expect(first.remainingAmount).toBe('0.00');expect(second.remainingAmount).toBe('0.00');
 });
 it('部分分摊保留剩余额度，后续凭证只能使用余额',async()=>{
  const firstVoucher=await addVoucher('部分-A',[100]),receipt=await addBank('PART-150',150);
  await store.autoMatch();
  expect(firstVoucher.status).toBe('matched');expect(receipt.status).toBe('pending');expect(receipt.allocatedAmount).toBe('100.00');expect(receipt.remainingAmount).toBe('50.00');
  const secondVoucher=await addVoucher('部分-B',[50],'2026-10-02');await store.autoMatch();
  expect(secondVoucher.status).toBe('matched');expect(receipt.remainingAmount).toBe('0.00');expect(receipt.status).toBe('matched');
  expect(()=>store.manualMatch(secondVoucher.id,[receipt.id],'重复整单关联')).toThrow('请选择未归档的待处理凭证');
 });
 it('共享合同可复用到多张凭证且不消耗金额额度',async()=>{
  const firstVoucher=await addVoucher('共享-A',[100]),secondVoucher=await addVoucher('共享-B',[100]);
  const firstReceipt=await addBank('SHARE-R1',100),secondReceipt=await addBank('SHARE-R2',100),contract=await addContract('SHARED-CONTRACT');
  store.reconcileEntryAllocations(firstVoucher.id,0,[allocation(firstReceipt.id,'100.00'),{documentId:contract.id,relationType:'reference'}],'合同与首张凭证共享关联');
  store.reconcileEntryAllocations(secondVoucher.id,0,[allocation(secondReceipt.id,'100.00'),{documentId:contract.id,relationType:'reference'}],'合同与次张凭证共享关联');
  expect(firstVoucher.status).toBe('matched');expect(secondVoucher.status).toBe('matched');expect(contract.status).toBe('matched');expect(contract.allocatedAmount).toBe('0.00');expect(contract.remainingAmount).toBe('999999.00');
  expect(firstVoucher.entryAttachments?.find(link=>link.documentId===contract.id)?.relationType).toBe('reference');expect(secondVoucher.documentIds).toContain(contract.id);
 });
 it('跨期窗口内可自动关联，达到三十天必须转人工',async()=>{
  const inside=await addVoucher('跨期-内',[100],'2026-09-30'),insideReceipt=await addBank('DATE-29',100,'2026-10-29');
  await store.autoMatch();expect(inside.status).toBe('matched');expect(inside.documentIds).toEqual([insideReceipt.id]);
  const outside=await addVoucher('跨期-界',[100],'2026-11-30'),outsideReceipt=await addBank('DATE-30',100,'2026-12-30');
  await store.autoMatch();expect(outside.status).toBe('pending');expect(outsideReceipt.lastMatchReason).toContain('30天');
  store.reconcileEntryAllocations(outside.id,0,[allocation(outsideReceipt.id,'100.00')],'核对原件确认跨期三十天的业务原因');
  expect(outside.status).toBe('matched');expect(outside.entryAttachments?.[0]?.ruleId).toBe('MANUAL');
 });
 it('红字凭证与红字回单同号匹配，普通负额和正负抵销被拒绝',async()=>{
  const voucher=await addVoucher('红字-1',[-100],'2026-09-30','red-letter'),receipt=await addBank('RED-100',-100,'2026-10-01','red-letter');
  await store.autoMatch();expect(voucher.status).toBe('matched');expect(voucher.entryAttachments?.[0]?.allocatedAmount).toBe('-100.00');
  const other=await addVoucher('红字-2',[-100],'2026-10-02','red-letter');
  expect(()=>store.reconcileEntryAllocations(other.id,0,[allocation(receipt.id,'100.00')],'错误正数抵销')).toThrow('同号');
  await expect(addVoucher('普通负额',[-100],'2026-10-03','normal')).rejects.toThrow();
 });
 it('作废单据不能自动或人工建立关系',async()=>{
  const voucher=await addVoucher('作废-1',[100]),receipt=await addBank('VOID-100',100,'2026-10-01','void');
  await store.autoMatch();expect(voucher.status).toBe('pending');expect(voucher.documentIds).toEqual([]);
  expect(()=>store.reconcileEntryAllocations(voucher.id,0,[allocation(receipt.id,'100.00')],'尝试关联作废回单')).toThrow('作废');
 });
 it('同额候选与跨期全局争用均不自动提交',async()=>{
  const voucher=await addVoucher('歧义-1',[100]),other=await addVoucher('歧义-2',[100],'2026-10-01');
  const first=await addBank('DUP-1',100),second=await addBank('DUP-2',100);
  await store.autoMatch('2026-09');expect(voucher.status).toBe('pending');expect(other.status).toBe('pending');
  expect(first.status).toBe('pending');expect(second.status).toBe('pending');expect(voucher.lastMatchReason).toMatch(/歧义|多条分录|候选|唯一/);
 });
 it('解除一张凭证只释放自己的分摊，其他凭证关系保留',async()=>{
  const firstVoucher=await addVoucher('解绑-A',[100]),receipt=await addBank('UNBIND-150',150);
  await store.autoMatch();const secondVoucher=await addVoucher('解绑-B',[50],'2026-10-02');await store.autoMatch();
  expect(receipt.status).toBe('matched');store.unmatchVoucher(firstVoucher.id,'首张凭证重新复核');
  expect(firstVoucher.status).toBe('pending');expect(secondVoucher.status).toBe('matched');expect(secondVoucher.documentIds).toEqual([receipt.id]);
  expect(receipt.allocatedAmount).toBe('50.00');expect(receipt.remainingAmount).toBe('100.00');expect(receipt.status).toBe('pending');
 });
 it('分摊凭证可归档，共享资料不计金额，豁免与附件缺失严格区分',async()=>{
  const voucher=await addVoucher('归档-分摊',[100]),receipt=await addBank('ARCH-150',150),contract=await addContract('ARCH-CONTRACT');
  store.reconcileEntryAllocations(voucher.id,0,[allocation(receipt.id,'100.00'),{documentId:contract.id,relationType:'reference'}],'分摊原件及共享合同已复核');
  const archive=store.generateArchive({period:voucher.period,startVoucherNo:voucher.no,endVoucherNo:voucher.no});
  expect(archive.status).toBe('locked');expect(store.isVoucherLocked(voucher)).toBe(true);
  await store.resetData();const internal=await addVoucher('内部结转',[100]);
  store.confirmAttachmentExemption(internal.id,'月末内部结转，无外部原始单据，内部计算表已核对');
  expect(internal.evidenceStatus).toBe('not-required');expect(store.generateArchive({period:internal.period,startVoucherNo:internal.no,endVoucherNo:internal.no}).status).toBe('locked');
 });
 it('普通附件缺失不能改用无外部附件豁免，部分单据也不能整单重复消费',async()=>{
  const voucher=await addVoucher('缺失-1',[100]),receipt=await addBank('MISS-150',150);
  store.markMissing(voucher.id,'供应商尚未提供银行回单');
  expect(()=>store.confirmAttachmentExemption(voucher.id,'试图把缺失改为豁免')).toThrow('附件缺失');
  store.restoreMissing(voucher.id);store.reconcileEntryAllocations(voucher.id,0,[allocation(receipt.id,'100.00')],'部分付款已核对');
  const other=await addVoucher('整单-重复',[150],'2026-10-02');
  expect(()=>store.manualMatch(other.id,[receipt.id],'试图按原总额重复关联')).toThrow('部分分摊');
 });
 it('分录回单与整凭证发票并存时，两类关系都计入单据使用状态',async()=>{
  const voucher=await addVoucher('混合证据',[100]),receipt=await addBank('MIX-R100',100);
  const invoice=await store.addDocument(file('MIX-INV100.pdf'),{number:'MIX-INV100',type:'invoice',supplier:'合成测试客商',payerName:'合成测试客商',date:'2026-10-01',amount:'100.00',seal:true,extractionStatus:'reviewed'});
  store.updateRule('R05',{enabled:true});await store.autoMatch();
  expect(new Set(voucher.documentIds)).toEqual(new Set([receipt.id,invoice.id]));
  expect(voucher.entryAttachments?.some(link=>link.documentId===receipt.id)).toBe(true);
  expect(invoice.status).toBe('matched');expect(invoice.allocatedAmount).toBe('100.00');expect(invoice.remainingAmount).toBe('0.00');
  store.unmatchVoucher(voucher.id,'验证混合证据同时释放');
  expect(invoice.status).toBe('pending');expect(receipt.status).toBe('pending');
 });
 it('后续自动匹配必须扣除已完成凭证占用的回单额度',async()=>{
  const firstVoucher=await addVoucher('占用-A',[40,60]),usedReceipt=await addBank('OCCUPIED-100',100);
  await store.autoMatch();expect(firstVoucher.status).toBe('matched');expect(usedReceipt.remainingAmount).toBe('0.00');
  const secondVoucher=await addVoucher('占用-B',[100],'2026-10-02'),newReceipt=await addBank('AVAILABLE-100',100,'2026-10-02');
  await store.autoMatch();
  expect(secondVoucher.status).toBe('matched');expect(secondVoucher.documentIds).toEqual([newReceipt.id]);
  expect(secondVoucher.entryAttachments).toEqual([expect.objectContaining({documentId:newReceipt.id,allocatedAmount:'100.00'})]);
  expect(firstVoucher.entryAttachments).toHaveLength(2);expect(usedReceipt.allocatedAmount).toBe('100.00');expect(usedReceipt.remainingAmount).toBe('0.00');
 });
 it('重算自动关系不会移除同一回单仍保留的人工分录关系',async()=>{
  const voucher=await addVoucher('人工自动共存',[40,60]),receipt=await addBank('KEEP-MANUAL',100);
  await store.autoMatch();
  store.reconcileEntryAllocations(voucher.id,0,[allocation(receipt.id,'40.00')],'第一条分录人工确认，第二条仍由自动规则管理');
  expect(voucher.entryAttachments?.map(link=>link.ruleId).sort()).toEqual(['MANUAL','R09']);
  voucher.status='pending';voucher.matchReviewRequired=true;store.updateRule('R09',{enabled:false});
  await store.autoMatch();
  expect(voucher.entryAttachments).toHaveLength(1);expect(voucher.entryAttachments?.[0]?.ruleId).toBe('MANUAL');
  expect(voucher.documentIds).toEqual([receipt.id]);expect(receipt.allocatedAmount).toBe('40.00');expect(receipt.remainingAmount).toBe('60.00');
 });
});
