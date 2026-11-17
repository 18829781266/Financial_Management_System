import 'fake-indexeddb/auto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {useArchiveStore} from '../src/store';
import {authState} from '../src/auth';
import {loadFile,removeFiles,saveFiles} from '../src/fileStorage';
import {invoiceArchiveIssue} from '../src/invoicePolicy';
import type {InvoiceCarrier} from '../src/types';

const memory=new Map<string,string>();
vi.stubGlobal('localStorage',{getItem:(key:string)=>memory.get(key)||null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)});
const store=useArchiveStore();
// These fixtures exercise storage/header/hash guards, not PDF semantic validity.
const pdf=(name='synthetic.pdf')=>new File(['%PDF-1.7\nSynthetic archive safety fixture'],name,{type:'application/pdf'});
const values=(no='记-1')=>({no,period:'2026-06',date:'2026-06-01',summary:'合成归档安全验收',supplier:'合成交易企业',amount:100});
const request=(start='记-1',end=start)=>({period:'2026-06',startVoucherNo:start,endVoucherNo:end});
async function pair(carrier:InvoiceCarrier='paper',seal=true){
 await store.importVoucherBatch([{file:pdf(),values:values()}]);
 const document=await store.addDocument(pdf('invoice.pdf'),{type:'invoice',number:'INV-1',date:'2026-06-01',supplier:'合成交易企业',payerName:'合成交易企业',amount:100,seal,invoiceCarrier:carrier,extractionStatus:'reviewed'});
 const voucher=store.state.vouchers[0]!;
 store.manualMatch(voucher.id,[document.id],'已核对合成凭证、金额、日期及交易对象');
 return {voucher,document};
}
beforeEach(async()=>{
 await store.resetData();
 authState.user={id:'reviewer-1',username:'qa-reviewer',displayName:'验收复核员',role:'SUPER_ADMIN',createdAt:'2026-06-01'};
});

describe('分类发票归档策略',()=>{
 it.each(['digital','electronic'] as const)('%s无可见章但有电子原件及人工核验依据可以归档',async carrier=>{
  const {document}=await pair(carrier,false);
  expect(()=>store.generateArchive(request())).toThrow('人工查验或验签依据');
  store.updateDocument(document.id,{...document,invoiceVerification:'passed',invoiceVerificationBasis:'人工核对查验平台结果与原件号码、金额、日期一致，2026-06-02'});
  expect(document.invoiceCheckedBy).toBe('qa-reviewer');expect(document.invoiceCheckedAt).toBeTruthy();expect(document.seal).toBe(false);
  await store.validateArchiveOriginals(request());
  const archive=store.generateArchive(request());
  expect(archive.status).toBe('locked');expect(archive.voucherIds).toEqual([store.state.vouchers[0]!.id]);expect(archive.records).toHaveLength(2);
 });
 it('纸质发票仍须核验印章，不以电子票策略放行',async()=>{
  const {document}=await pair('paper',false);
  expect(()=>store.generateArchive(request())).toThrow('未确认发票章');
  store.confirmSeal(document.id);expect(store.generateArchive(request()).status).toBe('locked');
 });
 it('旧seal=true记录的载体仍为未知，不能自动迁移成数电或纸票',async()=>{
  const {document}=await pair('unknown',true);
  expect(invoiceArchiveIssue(document)).toContain('载体待确认');
  expect(()=>store.generateArchive(request())).toThrow('载体待确认');
  expect(()=>store.confirmSeal(document.id)).toThrow('明确纸质载体');
 });
 it('核验未通过即使纸票已核章也禁止正式归档',async()=>{
  const {document}=await pair();
  store.updateDocument(document.id,{...document,invoiceVerification:'failed',invoiceVerificationBasis:'人工查验结果与票面金额不一致'});
  expect(()=>store.generateArchive(request())).toThrow('人工核验未通过');
 });
 it('核验通过必须有依据，失败保存不会改写原记录',async()=>{
  const {document}=await pair('digital',false);
  expect(()=>store.updateDocument(document.id,{...document,invoiceVerification:'passed',invoiceVerificationBasis:' '})).toThrow('人工核验依据');
  expect(document.invoiceVerification).toBe('pending');expect(document.invoiceCheckedAt).toBeUndefined();
 });
 it('导入字段不能直接伪造人工查验完成状态',async()=>{
  const doc=await store.addDocument(pdf(),{type:'invoice',number:'IMPORT-1',supplier:'合成交易企业',amount:100,date:'2026-06-01',invoiceCarrier:'digital',invoiceVerification:'passed',invoiceVerificationBasis:'输入文件自称通过'});
  expect(doc.invoiceVerification).toBe('pending');expect(doc.invoiceCheckedAt).toBeUndefined();expect(invoiceArchiveIssue(doc)).toContain('人工查验');
 });
 it('已核验的未关联发票修改关键票面字段后必须重新核验',async()=>{
  const document=await store.addDocument(pdf(),{type:'invoice',number:'INV-EDIT',supplier:'合成交易企业',date:'2026-06-01',amount:100,invoiceCarrier:'digital'});
  store.updateDocument(document.id,{...document,invoiceVerification:'passed',invoiceVerificationBasis:'人工核对查验结果'});
  expect(document.invoiceVerification).toBe('passed');
  store.updateDocument(document.id,{...document,number:'INV-EDIT-NEW'});
  expect(document.invoiceVerification).toBe('pending');expect(document.invoiceCheckedAt).toBeUndefined();expect(invoiceArchiveIssue(document)).toContain('人工查验');
 });
});

describe('正式归档原件存在性与入库指纹',()=>{
 it('入库计算实际原件摘要和大小，不信任外部提供的摘要',async()=>{
  const {voucher,document}=await pair();
  expect(voucher.sourceHash).toMatch(/^[a-f0-9]{64}$/);expect(document.sourceHash).toBe(voucher.sourceHash);expect(document.sourceSize).toBe(pdf().size);expect(document.sourceHashMode).toBe('ingested');
  expect(await loadFile(document.fileId!)).toBeTruthy();
 });
 it('只有fileId但Blob已经丢失时预检失败，且不留下档案和锁定',async()=>{
  const {voucher,document}=await pair();await removeFiles([document.fileId!]);
  await expect(store.validateArchiveOriginals(request())).rejects.toThrow('原始文件已丢失');
  expect(store.state.archives).toEqual([]);expect(store.isVoucherLocked(voucher)).toBe(false);
 });
 it('没有凭证原件不能以结构化整理页替代',async()=>{
  const {voucher}=await pair();delete voucher.fileId;
  await expect(store.validateArchiveOriginals(request())).rejects.toThrow('缺少上传原件');
  expect(()=>store.generateArchive(request())).toThrow('缺少上传原件');expect(store.state.archives).toEqual([]);
 });
 it('同键内容被替换，即使大小相同也会因摘要不同拒绝归档',async()=>{
  const {document}=await pair();
  const original=await loadFile(document.fileId!),bytes=new Uint8Array(await original!.arrayBuffer());bytes[bytes.length-1]^=1;
  await saveFiles([{id:document.fileId!,file:new Blob([bytes])}]);
  await expect(store.validateArchiveOriginals(request())).rejects.toThrow('摘要或大小');expect(store.state.archives).toHaveLength(0);
 });
 it('历史原件首次登记当前基线并留痕，不伪称原始入库已校验',async()=>{
  const {voucher,document}=await pair();
  for(const row of [voucher,document]){delete row.sourceHash;delete row.sourceSize;delete row.sourceHashMode;}
  await store.validateArchiveOriginals(request());
  expect(voucher.sourceHashMode).toBe('legacy-registered');expect(document.sourceHashMode).toBe('legacy-registered');expect(store.state.logs[0]?.detail).toContain('不代表已验证登记前');
 });
 it('多条记录引用同一文件时逐条核验摘要，不让后一条覆盖前一条校验',async()=>{
  const {voucher,document}=await pair();voucher.fileId=document.fileId;voucher.sourceHash='0'.repeat(64);
  await expect(store.validateArchiveOriginals(request())).rejects.toThrow('摘要或大小');
 });
 it('后续原件丢失时不登记前面历史原件的半套基线',async()=>{
  const {voucher,document}=await pair();delete voucher.sourceHash;await removeFiles([document.fileId!]);
  await expect(store.validateArchiveOriginals(request())).rejects.toThrow('原始文件已丢失');expect(voucher.sourceHash).toBeUndefined();
 });
 it('无外部附件豁免不豁免记账凭证自身原件',async()=>{
  await store.importVoucherBatch([{values:values()}]);const voucher=store.state.vouchers[0]!;
  Object.assign(voucher,{status:'matched',noAttachmentRequired:true,attachmentExemptionReason:'合成内部结转无外部附件'});
  expect(()=>store.generateArchive(request())).toThrow('不豁免记账凭证原件');
 });
});

describe('锁定范围与档案成员快照',()=>{
 it('归档记1和记3后拒绝向1..3补导记2，整个混合批次回滚',async()=>{
  await store.importVoucherBatch([{file:pdf('1.pdf'),values:values('记-1')},{file:pdf('3.pdf'),values:values('记-3')}]);
  for(const voucher of store.state.vouchers)Object.assign(voucher,{status:'matched',noAttachmentRequired:true,attachmentExemptionReason:'合成内部结转'});
  await store.validateArchiveOriginals(request('记-1','记-3'));
  const archive=store.generateArchive(request('记-1','记-3')),before=store.state.lastImportSequence;
  await expect(store.importMixedBatch([{file:pdf('4.pdf'),values:values('记-4')},{file:pdf('2.pdf'),values:values('记-2')}],[{file:pdf('document.pdf'),fields:{type:'bank',number:'NEW-D',supplier:'合成交易企业',date:'2026-06-01',amount:100}}])).rejects.toThrow('已归档的锁定范围');
  expect(store.state.vouchers.map(voucher=>voucher.no)).toEqual(['记-1','记-3']);expect(store.state.documents).toEqual([]);expect(store.state.lastImportSequence).toBe(before);expect(archive.records?.map(record=>record.no)).toEqual(['记-1','记-3']);
  const oldSummary=archive.records![0]!.summary;store.state.vouchers[0]!.summary='模拟外部更改工作区';expect(archive.records![0]!.summary).toBe(oldSummary);
  await store.importVoucherBatch([{file:pdf('4.pdf'),values:values('记-4')}]);expect(store.isVoucherLocked(store.state.vouchers.at(-1)!)).toBe(false);
 });
});
