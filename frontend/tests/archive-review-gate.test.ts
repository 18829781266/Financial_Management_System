import 'fake-indexeddb/auto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {nextTick} from 'vue';
import {authState} from '../src/auth';
import {loadFile} from '../src/fileStorage';
import {useArchiveStore} from '../src/store';

const memory=new Map<string,string>();
vi.stubGlobal('localStorage',{
 getItem:(key:string)=>memory.get(key)||null,
 setItem:(key:string,value:string)=>memory.set(key,value),
 removeItem:(key:string)=>memory.delete(key),
});
const store=useArchiveStore();
const period='2026-09';
const payer='合成归档复核付款企业';
// These fixtures test archive gates and original-file identity, not PDF rendering.
const pdf=(name:string)=>new File([`%PDF-1.7\nSynthetic review gate original: ${name}`],name,{type:'application/pdf'});
const values=(no='记-16')=>({no,period,date:period+'-01',summary:'合成收款凭证',supplier:payer,amount:'100.00',expectedAttachments:'1'});
const request=(no='记-16')=>({period,startVoucherNo:no,endVoucherNo:no});

async function associatedPendingReceipt(){
 await store.importVoucherBatch([{
  file:pdf('凭证原件.pdf'),values:values(),
  metadata:{
   sourceKind:'pdf-text',sourcePages:[1],company:'合成核算主体',
   entries:[
    {summary:'合成银行收款',account:'1002 银行存款_尾号3325',debit:'100.00',credit:'0.00'},
    {summary:'合成银行收款',account:'1122 应收账款',debit:'0.00',credit:'100.00'},
   ],
   reviewReasons:['请对照原件核对凭证字段'],
  },
 }]);
 const document=await store.addDocument(pdf('待字段复核银行回单.pdf'),{
  type:'bank',number:'REVIEW-BANK-1',supplier:payer,payerName:payer,payeeName:'合成收款主体',
  date:period+'-01',amount:100,payeeAccount:'04536101040033325',accountVersion:1,
  sourceKind:'pdf-text',sourcePages:[1],extractionStatus:'pending',reviewReasons:['请核对原件字段'],
 });
 for(const rule of store.state.rules)rule.enabled=rule.id==='R09';
 await store.autoMatch(period);
 const voucher=store.state.vouchers[0]!;
 expect(voucher.status).toBe('matched');expect(voucher.documentIds).toEqual([document.id]);
 expect(document.status).toBe('matched');expect(document.extractionStatus).toBe('pending');
 return {voucher,document};
}

async function internalVoucher(withOriginal=true){
 await store.importVoucherBatch([{
  ...(withOriginal?{file:pdf('内部计提凭证原件.pdf')}:{}),
  values:{...values('记-内部'),summary:'合成内部计提',expectedAttachments:''},
 }]);
 return store.state.vouchers[0]!;
}

beforeEach(async()=>{
 await store.resetData();await nextTick();
 authState.user={id:'archive-review-qa',username:'archive-reviewer',displayName:'合成归档复核员',role:'SUPER_ADMIN',createdAt:'2026-09-01'};
});

describe('附件字段复核与无外部附件确认的正式归档边界',()=>{
 it('已匹配银行回单仍待字段复核时阻断正式生成，不留下档案或锁定',async()=>{
  const {voucher,document}=await associatedPendingReceipt();
  expect(()=>store.generateArchive(request())).toThrow('存在尚待复核的附件');
  expect(store.state.archives).toEqual([]);expect(store.isVoucherLocked(voucher)).toBe(false);
  expect(voucher.documentIds).toEqual([document.id]);expect(document.extractionStatus).toBe('pending');
 });

 it('保持关键字段不变保存单据复核后，可正式归档并引用原凭证及回单',async()=>{
  const {voucher,document}=await associatedPendingReceipt();
  const documentFileId=document.fileId,voucherFileId=voucher.fileId,links=JSON.stringify(voucher.entryAttachments);
  store.updateDocument(document.id,{...document});
  expect(document.extractionStatus).toBe('reviewed');expect(document.reviewReasons).toEqual([]);
  expect(document.fileId).toBe(documentFileId);expect(voucher.documentIds).toEqual([document.id]);
  expect(JSON.stringify(voucher.entryAttachments)).toBe(links);
  await store.validateArchiveOriginals(request());
  const archive=store.generateArchive(request());
  expect(archive.status).toBe('locked');expect(archive.voucherIds).toEqual([voucher.id]);
  expect(archive.records?.map(record=>[record.kind,record.recordId,record.fileId])).toEqual([
   ['voucher',voucher.id,voucherFileId],['document',document.id,documentFileId],
  ]);
  expect(await loadFile(documentFileId!)).toBeTruthy();expect(await loadFile(voucherFileId!)).toBeTruthy();
  expect(store.isVoucherLocked(voucher)).toBe(true);
 });

 it('只保存凭证字段复核不会替代所关联回单的原件字段复核',async()=>{
  const {voucher,document}=await associatedPendingReceipt();
  store.updateVoucher(voucher.id,values());
  expect(voucher.reviewStatus).toBe('reviewed');expect(voucher.status).toBe('matched');
  expect(document.extractionStatus).toBe('pending');expect(document.reviewReasons).not.toEqual([]);
  expect(()=>store.generateArchive(request())).toThrow('存在尚待复核的附件');
  expect(store.state.archives).toEqual([]);
 });

 it('真正零附件凭证填写业务依据确认后可以生成，档案只引用自身原件',async()=>{
  const voucher=await internalVoucher();
  expect(voucher.documentIds).toEqual([]);
  store.confirmAttachmentExemption(voucher.id,'月末内部折旧计提，已核对内部计算表编号INTERNAL-01');
  expect(voucher.noAttachmentRequired).toBe(true);expect(voucher.attachmentReviewRequired).toBe(false);
  expect(voucher.evidenceStatus).toBe('not-required');
  await store.validateArchiveOriginals(request(voucher.no));
  const archive=store.generateArchive(request(voucher.no));
  expect(archive.records).toHaveLength(1);
  expect(archive.records?.[0]).toMatchObject({kind:'voucher',recordId:voucher.id,fileId:voucher.fileId});
 });

 it('零附件确认不会豁免记账凭证自身原件',async()=>{
  const voucher=await internalVoucher(false);
  store.confirmAttachmentExemption(voucher.id,'内部计提，无外部原始单据');
  expect(()=>store.generateArchive(request(voucher.no))).toThrow('不豁免记账凭证原件');
  expect(store.state.archives).toEqual([]);
 });

 it('已标记缺失的凭证不能通过无外部附件确认绕过补件',async()=>{
  const voucher=await internalVoucher();
  store.markMissing(voucher.id,'客户尚未提供应有的银行回单');
  expect(()=>store.confirmAttachmentExemption(voucher.id,'直接确认无需附件')).toThrow('附件缺失不能使用无外部附件豁免');
  expect(voucher.status).toBe('missing');expect(voucher.missingReason).toBe('客户尚未提供应有的银行回单');
  expect(voucher.noAttachmentRequired).not.toBe(true);expect(store.state.archives).toEqual([]);
 });

 it('已关联真实待复核附件时不能改成无附件豁免来绕过字段门禁',async()=>{
  const {voucher,document}=await associatedPendingReceipt();
  expect(()=>store.confirmAttachmentExemption(voucher.id,'忽略待复核回单')).toThrow('已关联外部附件的凭证不能使用附件豁免');
  expect(voucher.noAttachmentRequired).not.toBe(true);expect(voucher.documentIds).toEqual([document.id]);
  expect(document.extractionStatus).toBe('pending');
  expect(()=>store.generateArchive(request())).toThrow('存在尚待复核的附件');
  expect(store.state.archives).toEqual([]);
 });
});
