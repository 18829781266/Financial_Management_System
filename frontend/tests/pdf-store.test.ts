import {resetTestState} from './fixtures/demo-state';
import 'fake-indexeddb/auto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {useArchiveStore} from '../src/store';
import type {VoucherDraft,VoucherPdfMetadata} from '../src/store';
import {voucherInputIssues} from '../src/voucherValidation';
import {loadFile} from '../src/fileStorage';
vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{},removeItem:()=>{}});
const store=useArchiveStore();
const file=(name='synthetic.pdf')=>new File(['%PDF-1.7\nsynthetic fixture'],name,{type:'application/pdf'});
const values=(amount:unknown='100.00')=>({no:'测试-1',period:'2026-06',date:'2026-06-01',summary:'测试往来',supplier:'测试客户有限公司',amount});
const metadata=(amount='100.00'):VoucherPdfMetadata=>({sourceKind:'pdf-text',sourcePages:[1],company:'测试主体有限公司',entries:[{summary:'测试往来',account:'应收账款',debit:amount,credit:'0.00'},{summary:'测试往来',account:'收入',debit:'0.00',credit:amount}],reviewReasons:['原件附件数未注明']});
const draft=(amount='100.00'):VoucherDraft=>({file:file(),values:values(amount),metadata:metadata(amount)});
const document=(number='INV-SYNTHETIC')=>({file:file('invoice.pdf'),fields:{type:'invoice' as const,supplier:'测试客户有限公司',date:'2026-06-01',amount:'100.00',number,seal:true}});
beforeEach(()=>{resetTestState(store);store.updateRule('R08',{enabled:false});});
describe('文字 PDF 凭证的真实金额与人工复核保护',()=>{
 it('按实际辅助科目识别多个往来，不依赖提示文案',async()=>{
  const input=draft();input.metadata!.reviewReasons=['包含 2 个往来客商，不能自动指定单一客商'];input.metadata!.entries=[{summary:'收款',account:'1002 银行存款',debit:'100.00',credit:'0.00'},{summary:'收款',account:'1122 应收账款_0001.甲公司',debit:'0.00',credit:'60.00'},{summary:'收款',account:'1122 应收账款_0002.乙公司',debit:'0.00',credit:'40.00'}];
  await store.importVoucherBatch([input]);const v=store.state.vouchers.at(-1)!;expect(v.autoMatchBlockedReasons).toContain('包含多个往来对象，需人工分配附件');store.updateVoucher(v.id,values());await store.addDocumentBatch([document()]);expect((await store.autoMatch('2026-06')).matched).toBe(0);
 });
 it('允许合法零净额、空客商且不假定附件数',async()=>{
  const input=draft('0.00');input.values.supplier='';input.metadata!.entries=[{summary:'利息',account:'存款',debit:'10.00',credit:'0.00'},{summary:'利息',account:'费用',debit:'-10.00',credit:'0.00'}];
  await store.importVoucherBatch([input]);const v=store.state.vouchers.at(-1)!;
  expect(v.amount).toBe(0);expect(v.supplier).toBe('');expect(v.expectedAttachments).toBeUndefined();expect(v.reviewStatus).toBe('pending');expect(v.entries?.[1]?.debit).toBe('-10.00');expect(v.autoMatchBlockedReasons).toHaveLength(2);
  expect(await loadFile(v.fileId!)).toBeDefined();
 });
 it('普通结构化数据仍拒绝零额和空客商，values中伪造sourceKind不放宽',async()=>{
  await expect(store.importVoucherBatch([{values:{...values(0),supplier:'',sourceKind:'pdf-text'}}])).rejects.toThrow('客商');expect(store.state.vouchers).toHaveLength(12);
 });
 it('只有带来源影像的PDF元数据才能走宽松通道',async()=>{
  await expect(store.importVoucherBatch([{values:values(0),metadata:metadata('0.00')}])).rejects.toThrow('影像');
 });
 it('宽松通道仍拒绝空值、科学计数法及三位小数',async()=>{
  for(const amount of ['', '1e2', '100.001'])await expect(store.importVoucherBatch([{...draft(),values:values(amount)}])).rejects.toThrow();expect(store.state.vouchers).toHaveLength(12);
 });
 it('来源续页与分录得到保留，不把通用附件提示永久阻断自动匹配',async()=>{
  const input=draft();input.metadata!.sourcePages=[1,2];await store.importVoucherBatch([input]);const v=store.state.vouchers.at(-1)!;
  expect(v.sourcePages).toEqual([1,2]);expect(v.entries).toHaveLength(2);expect(v.autoMatchBlockedReasons).toEqual([]);
  await store.addDocumentBatch([document()]);expect((await store.autoMatch('2026-06')).matched).toBe(1);expect(v.reviewStatus).toBe('pending');
  store.updateVoucher(v.id,values());expect(v.reviewStatus).toBe('reviewed');expect(v.reviewReasons).toEqual([]);expect((await store.autoMatch('2026-06')).matched).toBe(0);expect(v.status).toBe('matched');
 });
 it('复核前拒绝手工关联和归档',async()=>{
  await store.importVoucherBatch([draft()]);const v=store.state.vouchers.at(-1)!;const docs=await store.addDocumentBatch([document()]);
  expect(()=>store.manualMatch(v.id,[docs[0]!.id],'核对')).toThrow('尚待复核');v.status='matched';v.documentIds=[docs[0]!.id];
  expect(()=>store.generateArchive({period:'2026-06',startVoucherNo:v.no,endVoucherNo:v.no})).toThrow('尚待复核');
 });
 it('零净额复核后保留0，禁止将原始总额改为0.01凑成正数',async()=>{
  await store.importVoucherBatch([draft('0.00')]);const v=store.state.vouchers.at(-1)!;
  expect(()=>store.updateVoucher(v.id,values('0.01'))).toThrow('不能直接改写');expect(v.amount).toBe(0);
  store.updateVoucher(v.id,{...values('0.00'),supplier:''});expect(v.reviewStatus).toBe('reviewed');expect(v.autoMatchBlockedReasons?.length).toBeGreaterThan(0);
  expect(()=>store.manualMatch(v.id,['d012'],'核对')).toThrow('按分录人工处理');
 });
 it('正数金额但包含红字或多个客商时，复核后仍不自动匹配',async()=>{
  const input=draft();input.metadata!.reviewReasons=['存在多个客商，需核对往来'];input.metadata!.entries=[{summary:'调整',account:'费用',debit:'110.00',credit:'0.00'},{summary:'冲减',account:'费用',debit:'-10.00',credit:'0.00'},{summary:'应付',account:'应付账款',debit:'0.00',credit:'100.00'}];
  await store.importVoucherBatch([input]);const v=store.state.vouchers.at(-1)!;store.updateVoucher(v.id,values());expect(v.autoMatchBlockedReasons).toHaveLength(2);
  await store.addDocumentBatch([document()]);expect((await store.autoMatch('2026-06')).matched).toBe(0);expect(v.status).toBe('pending');
 });
 it('借贷不平衡的提取结果作为待复核保留且不自动匹配',async()=>{
  const input=draft();input.metadata!.entries[1]!.credit='99.00';await store.importVoucherBatch([input]);const v=store.state.vouchers.at(-1)!;expect(v.autoMatchBlockedReasons).toContain('分录借贷合计与凭证金额不一致，请核对原件');store.updateVoucher(v.id,values());expect(()=>store.manualMatch(v.id,['d012'],'核对')).toThrow('分录借贷合计');
 });
 it('预览选项不放弃日期或金额格式检查',()=>{
  const issues=voucherInputIssues({...values('1e2'),date:'2026-02-30',supplier:''},{requireDate:true,allowIncompletePdf:true});expect(issues.map(x=>x.field)).toEqual(['date','amount']);
 });
});
describe('混合压缩包的批次原子性与原始单据复核',()=>{
 it('一次导入凭证和原始单据，双方都有持久化影像',async()=>{
  expect(await store.importMixedBatch([draft()],[document()])).toEqual({vouchers:1,documents:1});expect(await loadFile(store.state.vouchers.at(-1)!.fileId!)).toBeDefined();expect(await loadFile(store.state.documents[0]!.fileId!)).toBeDefined();
 });
 it('单据重号使整个混合批次不写入凭证',async()=>{
  await expect(store.importMixedBatch([draft()],[document(),document()])).rejects.toThrow('已存在');expect(store.state.vouchers).toHaveLength(12);expect(store.state.documents).toHaveLength(12);
 });
 it('单据文件损坏使整个混合批次不写入任意一方',async()=>{
  const d=document();d.file=new File(['not a PDF'],'broken.pdf');await expect(store.importMixedBatch([draft()],[d])).rejects.toThrow('内容有效');expect(store.state.vouchers).toHaveLength(12);expect(store.state.documents).toHaveLength(12);
 });
 it('未提取日期保留为空，不能把上传日期当业务日期',async()=>{
  const docs=await store.addDocumentBatch([{file:file(),fields:{sourceKind:'pdf-text',extractionStatus:'pending',reviewReasons:['日期待核对']}}]);expect(docs[0]?.date).toBe('');expect(docs[0]?.extractionStatus).toBe('pending');expect(docs[0]?.reviewReasons).toContain('未提取到业务日期，请核对原件');
 });
 it('提取字段完整仍保持显式待复核，人工核对后清理原因',async()=>{
  const input=document();const docs=await store.addDocumentBatch([{...input,fields:{...input.fields,sourceKind:'pdf-text',sourcePages:[2],extractionStatus:'pending',reviewReasons:['请核对发票字段']}}]);const doc=docs[0]!;
  expect(doc.extractionStatus).toBe('pending');expect(doc.sourcePages).toEqual([2]);store.updateDocument(doc.id,input.fields);expect(doc.extractionStatus).toBe('reviewed');expect(doc.reviewReasons).toEqual([]);
 });
});
