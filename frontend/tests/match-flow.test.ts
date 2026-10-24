import {resetTestState} from './fixtures/demo-state';
import 'fake-indexeddb/auto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {nextTick} from 'vue';
import {useArchiveStore} from '../src/store';
import type {DocumentDraft,VoucherDraft,VoucherPdfMetadata} from '../src/store';
import type {MatchRule,SourceDocument} from '../src/types';
import {collectionStatus,collectionStatusLabel} from '../src/matchWorkflow';

const memory=new Map<string,string>();
vi.stubGlobal('localStorage',{getItem:(key:string)=>memory.get(key)||null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)});
let store=useArchiveStore();
const period='2026-06';
const payer='合成付款企业有限公司';
const file=(name='synthetic.pdf')=>new File(['%PDF-1.7\nSynthetic matching flow fixture'],name,{type:'application/pdf'});
function values(no='流程-1',amount='100.00',supplier=payer,date='2026-06-01'){
 return {no,period,date,summary:'合成收款业务',supplier,amount};
}
function pdfVoucher(no='流程-1',amount='100.00',supplier=payer,date='2026-06-01'):VoucherDraft{
 const metadata:VoucherPdfMetadata={sourceKind:'pdf-text',sourcePages:[1],company:'合成核算主体有限公司',entries:[{summary:'合成收款业务',account:'1002 银行存款',debit:amount,credit:'0.00'},{summary:'合成收款业务',account:'1122 应收账款',debit:'0.00',credit:amount}],reviewReasons:['原件附件数为空，请核对实际附件数量']};
 return {file:file(),values:values(no,amount,supplier,date),metadata};
}
function pdfDocument(number='FLOW-INV-1',options:Partial<SourceDocument>&{amount?:number}={}):DocumentDraft{
 const fields:DocumentDraft['fields']={type:'invoice',payerName:payer,payeeName:'合成收款企业有限公司',supplier:payer,date:'2026-06-01',amount:'100.00',number,sourceKind:'pdf-text',sourcePages:[1],extractionStatus:'pending',seal:false,reviewReasons:['请对照原件核验字段'],...options};
 return {file:file(`${number}.pdf`),fields};
}
function enableRules(ids:string[]){for(const rule of store.state.rules)store.updateRule(rule.id,{enabled:ids.includes(rule.id)});}
function rule(id:string,patch:Partial<MatchRule>){store.updateRule(id,patch);}
function voucher(no='流程-1'){return store.state.vouchers.find(row=>row.no===no)!;}
function document(number='FLOW-INV-1'){return store.state.documents.find(row=>row.number===number)!;}
function groups(){return (store.state.payerGroups||[]).filter(group=>group.period===period);}
async function importPair(){await store.importMixedBatch([pdfVoucher()],[pdfDocument()]);}
beforeEach(()=>{
 resetTestState(store);
 // 旧实现的reset在root本轮同步修复中；每例保持干净以精确定位具体业务失败。
 delete store.state.lastMatchRun;
 store.state.payerGroups=[];
 enableRules(['R05']);
});

describe('采集、规则、状态与工作稿的完整数据流',()=>{
 it('字段完整且借贷平衡的文字PDF可匹配，复核状态独立保留',async()=>{
  await importPair();const v=voucher(),d=document();
  expect(v.reviewStatus).toBe('pending');expect(d.extractionStatus).toBe('pending');expect(d.partyVersion).toBe(2);
  const result=await store.autoMatch(period);
  expect(result).toEqual({matched:1,remaining:0,grouped:1});
  expect(v.status).toBe('matched');expect(d.status).toBe('matched');expect(v.documentIds).toEqual([d.id]);
  expect(v.reviewStatus).toBe('pending');expect(d.extractionStatus).toBe('pending');
  expect(v.lastMatchReason).toContain('R05');expect(store.state.lastMatchRun?.outcomes).toEqual([expect.objectContaining({voucherId:v.id,matched:true,ruleId:'R05'})]);
  expect(groups()[0]?.voucherIds).toEqual([v.id]);expect(groups()[0]?.documentIds).toEqual([d.id]);expect(d.payerGroupId).toBe(groups()[0]?.id);
 });
 it('档案只纳入实际匹配发票，同付款人未关联回单留在复核池',async()=>{
  await store.importMixedBatch([pdfVoucher()],[pdfDocument(),pdfDocument('FLOW-BANK-1',{type:'bank'}),pdfDocument('FLOW-BANK-2',{type:'bank',amount:500})]);
  const result=await store.autoMatch(period);const v=voucher();
  expect(result.matched).toBe(1);expect(groups()).toHaveLength(1);expect(groups()[0]?.documentIds).toEqual([document().id]);
  expect(v.documentIds).toEqual([document().id]);expect(document('FLOW-BANK-1').status).toBe('pending');expect(document('FLOW-BANK-2').status).toBe('pending');
  expect(groups()[0]?.voucherIds).toEqual([v.id]);
 });
 it('原始分录不平衡时进入复核，未关联单据不进入档案',async()=>{
  const input=pdfVoucher();input.metadata!.entries[1]!.credit='99.00';
  await store.importMixedBatch([input],[pdfDocument()]);const result=await store.autoMatch(period);
  expect(result.matched).toBe(0);expect(result.grouped).toBe(0);expect(voucher().status).toBe('pending');expect(voucher().lastMatchReason).toContain('分录借贷合计');expect(groups()).toEqual([]);expect(collectionStatus(document())).toBe('review');
 });
 it('没有付款人的单据不冒用收款人归集或匹配',async()=>{
  await store.importMixedBatch([pdfVoucher()],[pdfDocument('UNKNOWN-PAYER',{payerName:'',supplier:'',payeeName:payer})]);
  expect((await store.autoMatch(period)).matched).toBe(0);expect(groups()).toEqual([]);expect(collectionStatus(document('UNKNOWN-PAYER'))).toBe('review');expect(document('UNKNOWN-PAYER').supplier).toBe('');expect(document('UNKNOWN-PAYER').payerName).toBe('');
 });
 it('未命中时保留具体日期原因，调整已保存日期规则后真实执行',async()=>{
  await store.importMixedBatch([pdfVoucher()],[pdfDocument('LATE-INVOICE',{date:'2026-06-30'})]);
  rule('R05',{dateWindow:7});expect((await store.autoMatch(period)).matched).toBe(0);expect(voucher().lastMatchReason).toContain('7 天');
  rule('R05',{dateWindow:30});expect((await store.autoMatch(period)).matched).toBe(1);expect(store.state.lastMatchRun?.rules.find(row=>row.id==='R05')?.dateWindow).toBe(30);
 });
 it('匹配运行保存规则快照，后续改配置不会改写已执行记录',async()=>{
  await importPair();await store.autoMatch(period);const recorded=store.state.lastMatchRun!.rules.find(row=>row.id==='R05')!;
  rule('R05',{enabled:false,dateWindow:30});expect(recorded.enabled).toBe(true);expect(recorded.dateWindow).toBe(7);expect(store.state.rules.find(row=>row.id==='R05')?.enabled).toBe(false);
 });
});

describe('可视化规则配置真正参与执行',()=>{
 it('默认按付款人比较，显式改成收款人后才按收款方关联',async()=>{
  const target='合成目标企业有限公司';
  await store.importMixedBatch([pdfVoucher('流程-1','100.00',target)],[pdfDocument('PAYEE-ONLY',{payerName:'另一付款企业有限公司',supplier:'另一付款企业有限公司',payeeName:target})]);
  rule('R05',{conditions:{partyField:'payerName'}});expect((await store.autoMatch(period)).matched).toBe(0);
  rule('R05',{conditions:{partyField:'payeeName'}});expect((await store.autoMatch(period)).matched).toBe(1);expect(voucher().ruleId).toBe('R05');
 });
 it('策略由matchType决定，名称精确模式不会偷偷继续按模糊名称命中',async()=>{
  await store.importMixedBatch([pdfVoucher()],[pdfDocument('SHORT-NAME',{payerName:'合成付款企业',supplier:'合成付款企业'})]);
  rule('R05',{matchType:'exact'});expect((await store.autoMatch(period)).matched).toBe(0);
  rule('R05',{matchType:'fuzzy',threshold:100});expect((await store.autoMatch(period)).matched).toBe(1);expect(voucher().confidence).toBe(100);
 });
 it('更改优先级决定发票与回单的先后，而非固定按规则ID执行',async()=>{
  enableRules(['R05','R06']);
  await store.importMixedBatch([pdfVoucher()],[pdfDocument(),pdfDocument('PRIORITY-BANK',{type:'bank'})]);
  rule('R05',{priority:20});rule('R06',{priority:1});
  expect((await store.autoMatch(period)).matched).toBe(1);expect(voucher().ruleId).toBe('R06');expect(voucher().documentIds).toEqual([document('PRIORITY-BANK').id]);expect(document().status).toBe('pending');
 });
 it('金额与日期开关按已保存配置执行，归档仍独立校验金额',async()=>{
  await store.importMixedBatch([pdfVoucher()],[pdfDocument('OTHER-AMOUNT-DATE',{amount:200,date:'2026-06-30'})]);
  rule('R05',{dateWindow:1,conditions:{requireAmount:true,requireDate:true}});expect((await store.autoMatch(period)).matched).toBe(0);expect(voucher().lastMatchReason).toContain('金额');
  rule('R05',{conditions:{requireAmount:false,requireDate:true}});expect((await store.autoMatch(period)).matched).toBe(0);expect(voucher().lastMatchReason).toContain('日期');
  rule('R05',{conditions:{requireAmount:false,requireDate:false}});expect((await store.autoMatch(period)).matched).toBe(1);
  store.updateVoucher(voucher().id,values());store.updateDocument(document('OTHER-AMOUNT-DATE').id,{...pdfDocument('OTHER-AMOUNT-DATE',{amount:200,date:'2026-06-30'}).fields,seal:true});
  expect(()=>store.generateArchive({period,startVoucherNo:'流程-1',endVoucherNo:'流程-1'})).toThrow('金额不一致');
 });
 it('跨类型金额不能凑汇总，同类银行回单可按配置汇总',async()=>{
  enableRules(['R07']);
  rule('R07',{conditions:{documentTypes:['invoice','bank']}});
  await store.importMixedBatch([pdfVoucher()],[pdfDocument('INV-40',{amount:40}),pdfDocument('BANK-60',{type:'bank',amount:60})]);
  expect((await store.autoMatch(period)).matched).toBe(0);expect(groups()).toEqual([]);
  await store.addDocumentBatch([pdfDocument('BANK-40',{type:'bank',amount:40})]);
  expect((await store.autoMatch(period)).matched).toBe(1);expect(new Set(voucher().documentIds)).toEqual(new Set([document('BANK-60').id,document('BANK-40').id]));expect(document('INV-40').status).toBe('pending');
 });
});

describe('复核、删除与档案工作稿持续同步',()=>{
 it('已匹配PDF可核对相同字段，关联关系保留，关键字段更改必须先解绑',async()=>{
  await importPair();await store.autoMatch(period);const v=voucher(),d=document(),relation=[...v.documentIds];
  expect(()=>store.updateVoucher(v.id,values())).not.toThrow();expect(v.reviewStatus).toBe('reviewed');expect(v.status).toBe('matched');expect(v.documentIds).toEqual(relation);
  expect(()=>store.updateDocument(d.id,pdfDocument().fields)).not.toThrow();expect(d.extractionStatus).toBe('reviewed');expect(d.status).toBe('matched');
  expect(()=>store.updateVoucher(v.id,{...values(),supplier:'变更客商有限公司'})).toThrow('解除匹配');
  expect(()=>store.updateDocument(d.id,{...pdfDocument().fields,payerName:'变更付款人有限公司'})).toThrow('解除匹配');
  expect(v.documentIds).toEqual(relation);expect(d.payerName).toBe(payer);
 });
 it('复核提示与匹配成功分离，但正式归档仍要求复核与印章',async()=>{
  await importPair();await store.autoMatch(period);const request={period,startVoucherNo:'流程-1',endVoucherNo:'流程-1'};
  expect(()=>store.generateArchive(request)).toThrow('尚待复核');
  store.updateVoucher(voucher().id,values());expect(()=>store.generateArchive(request)).toThrow('尚待复核');
  store.updateDocument(document().id,pdfDocument().fields);expect(()=>store.generateArchive(request)).toThrow('发票章');
  store.confirmSeal(document().id);expect(store.generateArchive(request).status).toBe('locked');expect(store.isVoucherLocked(voucher())).toBe(true);expect(groups()[0]?.voucherIds).toEqual([voucher().id]);
 });
 it('解除后凭证及单据进入请复核，电子档案移除整组',async()=>{
  await importPair();await store.autoMatch(period);const v=voucher(),d=document();store.unmatchVoucher(v.id,'合成测试重新核验');
  expect(v.status).toBe('pending');expect(d.status).toBe('pending');expect(collectionStatus(v)).toBe('review');expect(collectionStatus(d)).toBe('review');expect(groups()).toEqual([]);
 });
 it('删除已关联单据释放匹配组，工作稿不留下删除引用',async()=>{
  await store.importMixedBatch([pdfVoucher()],[pdfDocument(),pdfDocument('SURVIVING-BANK',{type:'bank'})]);await store.autoMatch(period);
  const removed=document().id,remaining=document('SURVIVING-BANK').id;await store.deleteDocuments([removed]);
  expect(voucher().status).toBe('pending');expect(voucher().documentIds).toEqual([]);expect(groups()).toEqual([]);expect(collectionStatus(store.state.documents.find(d=>d.id===remaining)!)).toBe('review');expect(groups().flatMap(group=>group.documentIds)).not.toContain(removed);
 });
 it('删除未归档凭证后释放单据且工作稿凭证引用同步删除',async()=>{
  await importPair();await store.autoMatch(period);const id=voucher().id,d=document();await store.deleteVouchers([id]);
  expect(d.status).toBe('pending');expect(collectionStatus(d)).toBe('review');expect(groups()).toEqual([]);
 });
 it('未关联单据复核并改付款人后仍不在电子档案展示',async()=>{
  enableRules([]);await store.addDocumentBatch([pdfDocument()]);await store.autoMatch(period);const d=document();
  store.updateDocument(d.id,{...pdfDocument().fields,payerName:'合成新付款企业有限公司',supplier:'合成新付款企业有限公司'});
  expect(groups()).toEqual([]);expect(d.payerGroupId).toBeUndefined();expect(d.payerName).toBe('合成新付款企业有限公司');expect(d.extractionStatus).toBe('reviewed');expect(collectionStatus(d)).toBe('review');
 });
 it('归集与运行结果持久化，刷新恢复后再次运行不重复消费',async()=>{
  await importPair();await store.autoMatch(period);await nextTick();
  const saved=JSON.parse(memory.get('langchao-cloud-demo-v1')!);expect(saved.payerGroups.filter((group:{period:string})=>group.period===period)).toHaveLength(1);expect(saved.lastMatchRun.matched).toBe(1);expect(saved.lastMatchRun.outcomes[0].matched).toBe(true);
  vi.resetModules();store=(await import('../src/store')).useArchiveStore();
  expect(groups()).toHaveLength(1);expect(voucher().status).toBe('matched');expect(document().status).toBe('matched');expect(store.state.lastMatchRun?.groupCount).toBe(1);
  expect((await store.autoMatch(period)).matched).toBe(0);expect(voucher().documentIds).toEqual([document().id]);expect(groups()[0]?.voucherIds).toEqual([voucher().id]);
 });
 it('清空数据删除匹配运行和工作稿',async()=>{
  await importPair();await store.autoMatch(period);await store.resetData();expect(store.state.lastMatchRun).toBeUndefined();expect(store.state.payerGroups).toEqual([]);
 });
});

describe('匹配候选版本与补录后的自动重算判定',()=>{
 it('成功混合导入只递增一次，运行保存版本且不会自行造成再次失效',async()=>{
  expect(store.state.matchDataRevision).toBe(0);
  await importPair();expect(store.state.matchDataRevision).toBe(1);
  await store.autoMatch(period);expect(store.state.lastMatchRun?.dataRevision).toBe(1);expect(store.state.matchDataRevision).toBe(1);
  await store.autoMatch(period);expect(store.state.lastMatchRun?.dataRevision).toBe(1);expect(store.state.matchDataRevision).toBe(1);
 });
 it('失败的字段编辑、重复导入和非法删除不改变匹配候选版本',async()=>{
  await importPair();const revision=store.state.matchDataRevision;
  expect(()=>store.updateVoucher(voucher().id,{...values(),summary:''})).toThrow();expect(store.state.matchDataRevision).toBe(revision);
  expect(()=>store.updateDocument(document().id,{...pdfDocument().fields,amount:'bad amount'})).toThrow();expect(store.state.matchDataRevision).toBe(revision);
  await expect(store.importVoucherBatch([pdfVoucher()])).rejects.toThrow('已存在');expect(store.state.matchDataRevision).toBe(revision);
  await expect(store.deleteDocuments(['missing-document'])).rejects.toThrow('记录已变化');expect(store.state.matchDataRevision).toBe(revision);
 });
 it('补齐缺失付款人会使上轮结果失效，导入序号不变但再次运行能正确命中',async()=>{
  await store.importMixedBatch([pdfVoucher()],[pdfDocument('TO-COMPLETE',{payerName:'',supplier:''})]);
  expect((await store.autoMatch(period)).matched).toBe(0);
  const importSequence=store.state.lastImportSequence,previousRunRevision=store.state.lastMatchRun!.dataRevision;
  store.updateDocument(document('TO-COMPLETE').id,pdfDocument('TO-COMPLETE').fields);
  expect(store.state.lastImportSequence).toBe(importSequence);expect(store.state.matchDataRevision).toBe(previousRunRevision!+1);expect(store.state.lastMatchRun?.dataRevision).toBe(previousRunRevision);
  expect((await store.autoMatch(period)).matched).toBe(1);expect(store.state.lastMatchRun?.dataRevision).toBe(store.state.matchDataRevision);
 });
 it('凭证补录和复核递增版本，相同字段重复保存不反复使结果失效',async()=>{
  await importPair();const initial=store.state.matchDataRevision!;
  store.updateVoucher(voucher().id,values());expect(store.state.matchDataRevision).toBe(initial+1);
  store.updateVoucher(voucher().id,values());expect(store.state.matchDataRevision).toBe(initial+1);
  store.updateDocument(document().id,pdfDocument().fields);expect(store.state.matchDataRevision).toBe(initial+2);
  store.updateDocument(document().id,pdfDocument().fields);expect(store.state.matchDataRevision).toBe(initial+2);
 });
 it('解绑、标记缺失、恢复和删除候选都按成功变更递增版本',async()=>{
  await importPair();await store.autoMatch(period);const initial=store.state.matchDataRevision!;
  store.unmatchVoucher(voucher().id,'合成测试解除');expect(store.state.matchDataRevision).toBe(initial+1);
  store.markMissing(voucher().id,'合成测试缺少附件');expect(store.state.matchDataRevision).toBe(initial+2);
  store.markMissing(voucher().id,'合成测试缺少附件');expect(store.state.matchDataRevision).toBe(initial+2);
  store.restoreMissing(voucher().id);expect(store.state.matchDataRevision).toBe(initial+3);
  await store.deleteDocuments([document().id]);expect(store.state.matchDataRevision).toBe(initial+4);
  await store.deleteVouchers([voucher().id]);expect(store.state.matchDataRevision).toBe(initial+5);
 });
 it('人工关联递增候选版本，规则修改仍由独立规则快照比较',async()=>{
  await importPair();enableRules([]);await store.autoMatch(period);
  store.updateVoucher(voucher().id,values());store.updateDocument(document().id,pdfDocument().fields);
  const before=store.state.matchDataRevision!;store.manualMatch(voucher().id,[document().id],'合成测试人工核对');expect(store.state.matchDataRevision).toBe(before+1);
  const revision=store.state.matchDataRevision;rule('R05',{dateWindow:30});expect(store.state.matchDataRevision).toBe(revision);expect(store.state.lastMatchRun?.rules.find(item=>item.id==='R05')?.dateWindow).toBe(7);
 });
 it('旧存储缺失版本仍可运行并保存新快照，补录后从有效版本继续计数',async()=>{
  await importPair();delete store.state.matchDataRevision;
  await store.autoMatch(period);expect(store.state.lastMatchRun?.dataRevision).toBe(0);
  store.updateVoucher(voucher().id,values());expect(store.state.matchDataRevision).toBe(1);expect(store.state.lastMatchRun?.dataRevision).toBe(0);
  await nextTick();const saved=JSON.parse(memory.get('langchao-cloud-demo-v1')!);expect(saved.matchDataRevision).toBe(1);expect(saved.lastMatchRun.dataRevision).toBe(0);
 });
});


describe('采集后显式运行的三态流程',()=>{
 it('刚导入PDF即使字段待核对也统一显示待匹配，不接受外部状态覆盖',async()=>{
  const draft=pdfDocument();draft.fields.status='matched';draft.fields.matchReviewRequired=true;
  await store.importMixedBatch([pdfVoucher()],[draft]);
  expect(collectionStatus(voucher())).toBe('pending');expect(collectionStatus(document())).toBe('pending');expect(collectionStatusLabel(document())).toBe('待匹配');
  expect(voucher().reviewStatus).toBe('pending');expect(document().extractionStatus).toBe('pending');expect(groups()).toEqual([]);expect(store.state.lastMatchRun).toBeUndefined();
 });
 it('按钮执行后成功关联显示已匹配归档，未命中及孤儿显示请复核',async()=>{
  await store.importMixedBatch([pdfVoucher(),pdfVoucher('流程-2','250.00')],[pdfDocument(),pdfDocument('ORPHAN',{amount:999})]);
  await store.autoMatch(period);
  expect(collectionStatusLabel(voucher())).toBe('已匹配归档');expect(collectionStatusLabel(document())).toBe('已匹配归档');
  expect(collectionStatusLabel(voucher('流程-2'))).toBe('请复核');expect(collectionStatusLabel(document('ORPHAN'))).toBe('请复核');
  expect(document('ORPHAN').lastMatchReason).toContain('人工复核');expect(groups().flatMap(group=>group.documentIds)).toEqual([document().id]);
 });
 it('仅有孤儿单据也在本次执行后进入请复核，其他期间保持待匹配',async()=>{
  await store.addDocumentBatch([pdfDocument('JUNE-ORPHAN'),pdfDocument('JULY-ORPHAN',{date:'2026-07-01'})]);
  await store.importVoucherBatch([{values:{...values('七月-1'),period:'2026-07',date:'2026-07-01'}}]);
  await store.autoMatch(period);
  expect(collectionStatus(document('JUNE-ORPHAN'))).toBe('review');expect(collectionStatus(document('JULY-ORPHAN'))).toBe('pending');expect(collectionStatus(voucher('七月-1'))).toBe('pending');expect(groups()).toEqual([]);
 });
 it('人工复核只是核对字段，必须完成手工关联才进入档案展示',async()=>{
  await importPair();enableRules([]);await store.autoMatch(period);
  store.updateVoucher(voucher().id,values());store.updateDocument(document().id,pdfDocument().fields);
  expect(collectionStatus(voucher())).toBe('review');expect(collectionStatus(document())).toBe('review');expect(groups()).toEqual([]);
  store.manualMatch(voucher().id,[document().id],'原件人工复核一致');
  expect(collectionStatusLabel(voucher())).toBe('已匹配归档');expect(collectionStatusLabel(document())).toBe('已匹配归档');expect(groups()[0]?.documentIds).toEqual([document().id]);
 });
 it('第一次自动匹配之前手工复核关联也能同步电子档案',async()=>{
  await importPair();store.updateVoucher(voucher().id,values());store.updateDocument(document().id,pdfDocument().fields);
  expect(store.state.lastMatchRun).toBeUndefined();expect(groups()).toEqual([]);
  store.manualMatch(voucher().id,[document().id],'人工核对后直接关联');expect(groups()[0]?.voucherIds).toEqual([voucher().id]);expect(collectionStatus(document())).toBe('matched');
 });
 it('上次未命中不污染之后新增采集记录，刷新后各自状态保留',async()=>{
  enableRules([]);await importPair();await store.autoMatch(period);
  await store.importMixedBatch([pdfVoucher('新增-2')],[pdfDocument('NEW-DOC')]);
  expect(collectionStatus(voucher())).toBe('review');expect(collectionStatus(document())).toBe('review');expect(collectionStatus(voucher('新增-2'))).toBe('pending');expect(collectionStatus(document('NEW-DOC'))).toBe('pending');
  await nextTick();vi.resetModules();store=(await import('../src/store')).useArchiveStore();
  expect(collectionStatus(voucher())).toBe('review');expect(collectionStatus(document())).toBe('review');expect(collectionStatus(voucher('新增-2'))).toBe('pending');expect(collectionStatus(document('NEW-DOC'))).toBe('pending');expect(groups()).toEqual([]);
 });
 it('旧存储按已执行批次恢复请复核并移除未关联旧归集，新增记录仍待匹配',async()=>{
  enableRules([]);await importPair();await store.autoMatch(period);await store.addDocumentBatch([pdfDocument('NEW-LEGACY')]);await nextTick();
  const saved=JSON.parse(memory.get('langchao-cloud-demo-v1')!);for(const row of [...saved.vouchers,...saved.documents])delete row.matchReviewRequired;
  saved.payerGroups.push({id:'old-unmatched',period,payerName:payer,documentIds:[document().id,document('NEW-LEGACY').id],voucherIds:[],updatedAt:'old'});memory.set('langchao-cloud-demo-v1',JSON.stringify(saved));
  vi.resetModules();store=(await import('../src/store')).useArchiveStore();
  expect(collectionStatus(voucher())).toBe('review');expect(collectionStatus(document())).toBe('review');expect(collectionStatus(document('NEW-LEGACY'))).toBe('pending');expect(groups()).toEqual([]);expect(document().payerGroupId).toBeUndefined();
 });
 it('旧版跨期间未命中原因不因最近运行覆盖而丢失，缺少outcomes也不清空用户数据',async()=>{
  enableRules([]);await importPair();await store.autoMatch(period);
  const september=pdfVoucher('九月-旧');september.values={...september.values,period:'2026-09',date:'2026-09-01'};
  await store.importMixedBatch([september],[pdfDocument('SEPTEMBER-OLD',{date:'2026-09-01'})]);await store.autoMatch('2026-09');
  await store.importMixedBatch([pdfVoucher('后来新增')],[pdfDocument('LATER-NEW')]);await nextTick();
  const saved=JSON.parse(memory.get('langchao-cloud-demo-v1')!);for(const row of [...saved.vouchers,...saved.documents])delete row.matchReviewRequired;delete saved.lastMatchRun.outcomes;memory.set('langchao-cloud-demo-v1',JSON.stringify(saved));
  vi.resetModules();store=(await import('../src/store')).useArchiveStore();
  expect(voucher('九月-旧')).toBeDefined();expect(collectionStatus(voucher())).toBe('review');expect(collectionStatus(document())).toBe('review');expect(collectionStatus(voucher('后来新增'))).toBe('pending');expect(collectionStatus(document('LATER-NEW'))).toBe('pending');expect(groups()).toEqual([]);
 });

});
