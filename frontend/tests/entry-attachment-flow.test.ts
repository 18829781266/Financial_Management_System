import 'fake-indexeddb/auto';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {nextTick} from 'vue';
import {useArchiveStore} from '../src/store';
import {collectionStatus} from '../src/matchWorkflow';
import {visibleArchiveGroups} from '../src/nameAssociation';

const memory=new Map<string,string>();
vi.stubGlobal('localStorage',{getItem:(key:string)=>memory.get(key)||null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)});
let store=useArchiveStore();
const image=(name='receipt.pdf')=>new File(['%PDF-1.7\nTest-only receipt'],name,{type:'application/pdf'});
const entries=()=>[{summary:'第一笔收款',account:'1002 银行存款_尾号3325',debit:'100.00',credit:'0.00'},{summary:'第二笔收款',account:'1002 银行存款_尾号7788',debit:'200.00',credit:'0.00'},{summary:'往来结转',account:'2202 应付账款',debit:'0.00',credit:'300.00'}];
async function addVoucher(no='记-1',date='2026-09-30'){
 await store.importVouchers(new File([JSON.stringify([{no,period:date.slice(0,7),date,summary:'两笔收款',supplier:'测试付款人',amount:'300.00',entries:entries()}])],'vouchers.json',{type:'application/json'}));
 return store.state.vouchers.find(v=>v.no===no)!;
}
async function addDocument(number='B1',amount=100,payeeAccount='04536101040033325',date='2026-10-01',remarks='原有备注'){
 return store.addDocument(image(`${number}.pdf`),{number,type:'bank',supplier:'测试付款人',payerName:'测试付款人',payeeName:'测试收款人',date,amount,payeeAccount,remarks,accountVersion:1,extractionStatus:'reviewed'});
}
beforeEach(async()=>{await store.resetData();await nextTick();});

describe('逐行回单关联的完整数据流',()=>{
 it('JSON导入保留逐行分录，成功关联及备注持久化，刷新重跑不重复',async()=>{
  const v=await addVoucher(),d1=await addDocument(),d2=await addDocument('B2',200,'622200007788');
  expect(v.entries).toHaveLength(3);expect(collectionStatus(v)).toBe('pending');
  expect(await store.autoMatch('2026-09')).toEqual({matched:1,remaining:0,grouped:1});
  expect(v.status).toBe('matched');expect(v.entryAttachments?.map(link=>[link.entryIndex,link.documentId])).toEqual([[1,d2.id],[0,d1.id]]);expect(d1.remarks).toContain('记-1');expect(d1.remarks).toContain('原有备注');expect(d1.matchedEntryIndex).toBe(0);
  await nextTick();vi.resetModules();store=(await import('../src/store')).useArchiveStore();
  expect((await store.autoMatch('2026-09')).matched).toBe(0);
  const restored=store.state.documents.find(d=>d.id===d1.id)!;expect(restored.remarks!.split('\n')).toHaveLength(2);expect(store.state.vouchers[0]!.entryAttachments).toHaveLength(2);expect(visibleArchiveGroups(store.state)[0]?.period).toBe('2026-09');
  expect(store.state.lastMatchRun?.newlyAssociatedDocuments).toBe(0);
 });
 it('部分关联只展示实际命中的分录，未命中凭证与单据进入复核',async()=>{
  const v=await addVoucher(),d1=await addDocument(),d2=await addDocument('WRONG',200,'622200009999');
  const result=await store.autoMatch('2026-09');expect(result.remaining).toBe(1);expect(v.entryAttachments).toHaveLength(1);expect(collectionStatus(v)).toBe('review');expect(collectionStatus(d1)).toBe('matched');expect(collectionStatus(d2)).toBe('review');expect(d2.lastMatchReason).toContain('账号');expect(v.documentIds).toEqual([d1.id]);expect(visibleArchiveGroups(store.state)[0]?.documentIds).toEqual([d1.id]);
 });
 it('金额与账号不符不能被企业名称规则兜底',async()=>{
  const v=await addVoucher(),d=await addDocument('BAD',300,'622200009999');await store.autoMatch();expect(v.documentIds).toEqual([]);expect(d.status).toBe('pending');expect(store.state.nameAssociations).toEqual([]);
 });
 it('R09运行不匹配也不改写非银行单据的状态和复核原因',async()=>{
  const v=await addVoucher();
  const invoice=await store.addDocument(image('invoice.pdf'),{number:'INV-1',type:'invoice',supplier:'测试付款人',payerName:'测试付款人',payeeName:'测试收款人',date:'2026-10-01',amount:100,payeeAccount:'04536101040033325',seal:true,extractionStatus:'reviewed'});
  invoice.matchReviewRequired=false;invoice.lastMatchReason='发票原有复核说明';
  await store.autoMatch('2026-09');
  expect(v.documentIds).toEqual([]);expect(invoice.status).toBe('pending');expect(invoice.matchReviewRequired).toBe(false);expect(invoice.lastMatchReason).toBe('发票原有复核说明');expect(invoice.matchedVoucherNo).toBeUndefined();
 });
 it('人工复核只修改指定摘要，账号日期例外留痕并回写备注',async()=>{
  const v=await addVoucher(),d1=await addDocument(),d2=await addDocument('MANUAL',200,'622200009999','2026-11-01');await store.autoMatch();
  store.reconcileEntry(v.id,1,[d2.id],'核对原件确认该科目未印账号，跨月补回单');
  expect(v.entryAttachments).toHaveLength(2);expect(v.documentIds).toContain(d1.id);expect(v.status).toBe('matched');expect(d2.matchedEntryIndex).toBe(1);expect(d2.remarks).toContain(v.no);
  await store.autoMatch();expect(v.entryAttachments?.find(link=>link.entryIndex===1)?.ruleId).toBe('MANUAL');expect(v.status).toBe('matched');
 });
 it('人工复核不能用凭证总额覆盖分录金额、不能重复消费其他行回单',async()=>{
  const v=await addVoucher(),d1=await addDocument(),d2=await addDocument('TOTAL',300);await store.autoMatch();
  expect(()=>store.reconcileEntry(v.id,1,[d2.id],'人工确认')).toThrow('本条分录金额');expect(()=>store.reconcileEntry(v.id,1,[d1.id],'人工确认')).toThrow('其他分录');
 });
 it('解绑清理分录关系和自动备注，保留原有用户备注',async()=>{
  const v=await addVoucher(),d=await addDocument();await store.autoMatch();store.unmatchVoucher(v.id,'重新核对');
  expect(v.entryAttachments).toEqual([]);expect(d.remarks).toBe('原有备注');expect(d.matchedVoucherNo).toBeUndefined();expect(d.status).toBe('pending');expect(v.documentIds).toEqual([]);
 });
 it('重新匹配清理旧名称归集，不清空上传数据或原备注',async()=>{
  const v=await addVoucher(),d=await addDocument('OLD',300,'622200009999');
  store.state.nameAssociations=[{id:'old-name',associationType:'name',basis:'company',ruleId:'R08',confidence:100,payerName:'测试付款人',period:v.period,documentIds:[d.id],voucherIds:[v.id],updatedAt:'2026-10-27'}];v.nameAssociationIds=['old-name'];d.nameAssociationIds=['old-name'];
  await store.autoMatch();expect(store.state.nameAssociations).toEqual([]);expect(v.documentIds).toEqual([]);expect(collectionStatus(d)).toBe('review');expect(store.state.documents).toHaveLength(1);expect(d.remarks).toBe('原有备注');
 });
 it('已锁定档案的附件关系及备注保持不变',async()=>{
  const v=await addVoucher(),d1=await addDocument(),d2=await addDocument('B2',200,'622200007788');await store.autoMatch();
  store.state.archives=[{id:'locked',title:'测试锁定册',period:v.period,startVoucherNo:v.no,endVoucherNo:v.no,voucherCount:1,pageCount:5,amount:300,createdAt:'2026-10-27',status:'locked'}];
  const before=JSON.stringify({v,d1,d2});await store.autoMatch();expect(JSON.stringify({v,d1,d2})).toBe(before);expect(()=>store.reconcileEntry(v.id,0,[d1.id],'重绑')).toThrow('锁定');
 });
 it('停用规则后没有名称回退或新增关联',async()=>{
  const v=await addVoucher(),d=await addDocument();store.updateRule('R09',{enabled:false});await store.autoMatch();expect(v.documentIds).toEqual([]);expect(d.status).toBe('pending');expect(v.lastMatchReason).toContain('停用');
 });
 it('选定期间时仍识别相邻期间的竞争分录，不能按月份掩盖歧义',async()=>{
  const v=await addVoucher('记-9','2026-09-30'),other=await addVoucher('记-10','2026-10-01'),receipt=await addDocument();
  await store.autoMatch('2026-09');expect(v.documentIds).toEqual([]);expect(other.documentIds).toEqual([]);expect(receipt.lastMatchReason).toContain('多条分录');expect(other.matchReviewRequired).toBe(false);
 });
 it('暂停规则保留已有关联和备注，不能解除已完成记录',async()=>{
  const v=await addVoucher(),d=await addDocument();await addDocument('B2',200,'622200007788');await store.autoMatch();const before=JSON.stringify({links:v.entryAttachments,remarks:d.remarks});
  store.updateRule('R09',{enabled:false});await store.autoMatch();expect(JSON.stringify({links:v.entryAttachments,remarks:d.remarks})).toBe(before);expect(v.status).toBe('matched');
 });
 it('逐行规则不能关闭金额日期条件或放宽成尾差容忍',()=>{
  expect(()=>store.updateRule('R09',{tolerance:0.01})).toThrow('固定');expect(()=>store.updateRule('R09',{dateWindow:31})).toThrow('固定');expect(()=>store.updateRule('R09',{conditions:{requireAmount:false}})).toThrow('固定');
 });
 it('旧版刷新升级加入R09，下次匹配按新条件重新核对',async()=>{
  const v=await addVoucher(),d=await addDocument('BOTH',300,'622200009999');v.status='matched';v.ruleId='R06';v.documentIds=[d.id];d.status='matched';
  await nextTick();const saved=JSON.parse(memory.get('langchao-cloud-demo-v1')!);saved.rules=saved.rules.filter((r:{id:string})=>r.id!=='R09');memory.set('langchao-cloud-demo-v1',JSON.stringify(saved));vi.resetModules();store=(await import('../src/store')).useArchiveStore();
  expect(store.state.rules.find(rule=>rule.id==='R09')?.enabled).toBe(true);await store.autoMatch();expect(store.state.vouchers[0]!.documentIds).toEqual([]);expect(store.state.documents[0]!.status).toBe('pending');
 });
});
