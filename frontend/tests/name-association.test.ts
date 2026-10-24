import {resetTestState} from './fixtures/demo-state';
import 'fake-indexeddb/auto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {nextTick} from 'vue';
import {evaluateNameAssociations,nameAssociationRule,visibleArchiveGroups} from '../src/nameAssociation';
import {collectionStatus} from '../src/matchWorkflow';
import {useArchiveStore} from '../src/store';
import type {MatchRule,SourceDocument,Voucher} from '../src/types';

const company='合成核算主体有限公司',other='合成交易企业有限公司',period='2026-06';
const time='2026-10-22 12:00:00';
const v=(id='v1',patch:Partial<Voucher>={}):Voucher=>({id,no:id,period,date:period+'-01',company,supplier:other,summary:'合成业务',amount:100,status:'pending',documentIds:[],...patch});
const d=(id='d1',patch:Partial<SourceDocument>={}):SourceDocument=>({id,name:id+'.pdf',type:'bank',payerName:company,payeeName:other,supplier:company,number:id,amount:999,date:period+'-30',status:'pending',seal:false,...patch});
const memory=new Map<string,string>();
vi.stubGlobal('localStorage',{getItem:(key:string)=>memory.get(key)||null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)});
let store=useArchiveStore();
const file=()=>new File(['%PDF-1.7 synthetic'], '合成原件.pdf',{type:'application/pdf'});
const values=(no='名称-1')=>({no,period,date:period+'-01',company,supplier:other,summary:'名称关联测试',amount:100});
const fields=(number='NAME-1',patch:Partial<SourceDocument>={})=>({type:'bank' as const,payerName:company,payeeName:other,supplier:company,date:period+'-30',amount:999,number,seal:false,...patch});
beforeEach(()=>{resetTestState(store);for(const rule of store.state.rules)store.updateRule(rule.id,{enabled:rule.id==='R08'});});

describe('付款人与收款人的企业名称关联',()=>{
 it('付款人23份和收款人13份可以同单位关联，不要求金额或具体日期相等',()=>{
  const docs=Array.from({length:36},(_,i)=>d('d'+i,i<23?{}:{payerName:other,payeeName:company,supplier:other}));
  const result=evaluateNameAssociations([v()],docs,[nameAssociationRule()],time);
  expect(result).toHaveLength(1);expect(result[0]?.documentIds).toHaveLength(36);expect(result[0]?.voucherIds).toEqual(['v1']);expect(result[0]?.basis).toBe('company');expect(result[0]?.confidence).toBe(100);
 });
 it('比较明确单位名称，未用本企业之外的凭证客商阻挡关联',()=>{
  const voucher=v(),doc=d();const result=evaluateNameAssociations([voucher],[doc],[nameAssociationRule()],time);
  expect(result[0]?.payerName).toBe(company);expect(voucher.documentIds).toEqual([]);expect(voucher.status).toBe('pending');expect(doc.status).toBe('pending');
 });
 it('无付款人但收款人明确时使用收款人，不改写付款人字段',()=>{
  const doc=d('interest',{payerName:'',supplier:'',payeeName:company});
  expect(evaluateNameAssociations([v()],[doc],[nameAssociationRule()],time)[0]?.documentIds).toEqual(['interest']);expect(doc.payerName).toBe('');
 });
 it('同名主体跨期间不能混为一组',()=>{
  const result=evaluateNameAssociations([v(),v('v2',{period:'2026-07'})],[d(),d('july',{date:'2026-07-20'})],[nameAssociationRule()],time);
  expect(result).toHaveLength(2);expect(result.find(group=>group.period===period)?.documentIds).toEqual(['d1']);
 });
 it('同时命中两个核算单位时转人工，不挑选付款或收款某一方',()=>{
  expect(evaluateNameAssociations([v(),v('v2',{company:other})],[d()],[nameAssociationRule()],time)).toEqual([]);
 });
 it('无明确单位名称时，支持付款或收款与凭证往来客商关联',()=>{
  const result=evaluateNameAssociations([v('v1',{company:undefined})],[d()],[nameAssociationRule()],time);
  expect(result[0]?.basis).toBe('counterparty');expect(result[0]?.payerName).toBe(other);
 });
 it('遵守付款/收款字段配置、类型和启用开关',()=>{
  const doc=d('payee',{payerName:'第三家企业',payeeName:company});const rule=nameAssociationRule();
  rule.conditions!.partyField='payerName';expect(evaluateNameAssociations([v()],[doc],[rule],time)).toEqual([]);
  rule.conditions!.partyField='payeeName';expect(evaluateNameAssociations([v()],[doc],[rule],time)).toHaveLength(1);
  rule.conditions!.documentTypes=['invoice'];expect(evaluateNameAssociations([v()],[doc],[rule],time)).toEqual([]);
  rule.enabled=false;expect(evaluateNameAssociations([v()],[d()],[rule],time)).toEqual([]);
 });
 it('相似但未达到配置阈值的企业不会误关联，只有名称归一后相同才过100分',()=>{
  expect(evaluateNameAssociations([v()],[d('different',{payerName:'合成核算分公司',payeeName:'其他'})],[nameAssociationRule()],time)).toEqual([]);
  expect(evaluateNameAssociations([v()],[d('suffix',{payerName:'合成核算主体',payeeName:'其他'})],[nameAssociationRule()],time)).toHaveLength(1);
 });
 it('名称规则不会把缺失标记或日期无效记录纳入档案',()=>{
  expect(evaluateNameAssociations([v('v1',{status:'missing'})],[d()],[nameAssociationRule()],time)).toEqual([]);
  expect(evaluateNameAssociations([v()],[d('no-date',{date:''})],[nameAssociationRule()],time)).toEqual([]);
  expect(evaluateNameAssociations([v()],[d('bad-date',{date:period+'-99'})],[nameAssociationRule()],time)).toEqual([]);
 });
 it('没有启用名称用途时，不替代现有金额与日期规则',()=>{
  const rule:MatchRule={...nameAssociationRule(),conditions:{...nameAssociationRule().conditions,associationScope:'voucher'}};
  expect(evaluateNameAssociations([v()],[d()],[rule],time)).toEqual([]);
 });
});

describe('名称关联的状态、档案与凭证金额边界',()=>{
 async function pair(){await store.importVoucherBatch([{values:values()}]);await store.addDocument(file(),fields());return {voucher:store.state.vouchers.find(item=>item.no==='名称-1')!,doc:store.state.documents.find(item=>item.number==='NAME-1')!};}
 it('点击运行前都待匹配，运行后通过名称关联展示，金额关系不伪造',async()=>{
  const {voucher,doc}=await pair();expect(collectionStatus(voucher)).toBe('pending');expect(collectionStatus(doc)).toBe('pending');
  expect(await store.autoMatch(period)).toEqual({matched:1,remaining:0,grouped:1});expect(collectionStatus(voucher)).toBe('matched');expect(collectionStatus(doc)).toBe('matched');
  expect(voucher.status).toBe('pending');expect(voucher.documentIds).toEqual([]);expect(doc.status).toBe('pending');expect(visibleArchiveGroups(store.state)[0]?.associationType).toBe('name');
  expect(store.state.lastMatchRun?.financialMatched).toBe(0);expect(store.state.lastMatchRun?.nameAssociatedDocuments).toBe(1);
  expect(()=>store.generateArchive({period,startVoucherNo:voucher.no,endVoucherNo:voucher.no})).toThrow('尚未完成附件匹配');
 });
 it('同名新批次保持待匹配，只有再次点击才进入原名称组',async()=>{
  await pair();await store.autoMatch(period);const doc=await store.addDocument(file(),fields('NAME-2'));
  expect(collectionStatus(doc)).toBe('pending');expect(store.state.nameAssociations?.[0]?.documentIds).toHaveLength(1);
  expect((await store.autoMatch(period)).matched).toBe(0);expect(collectionStatus(doc)).toBe('matched');expect(store.state.nameAssociations?.[0]?.documentIds).toHaveLength(2);
 });
 it('没有对应名称的原始单据仍请复核，不在企业档案金额及预览集合',async()=>{
  await pair();const orphan=await store.addDocument(file(),fields('ORPHAN',{payerName:'完全不同企业',payeeName:'另一无关主体'}));await store.autoMatch(period);
  expect(collectionStatus(orphan)).toBe('review');expect(store.state.nameAssociations?.[0]?.documentIds).not.toContain(orphan.id);
 });
 it('按字段修改会释放旧名称关联，不会擅自把新主体放入旧企业档案',async()=>{
  const {doc}=await pair();await store.autoMatch(period);store.updateDocument(doc.id,fields('NAME-1',{payerName:'完全不同企业',payeeName:'另一无关主体'}));
  expect(store.state.nameAssociations).toEqual([]);expect(collectionStatus(doc)).toBe('review');
 });
 it('编辑表单未提交单位字段时保留已导入单位名称与关联',async()=>{
  const {voucher}=await pair();await store.autoMatch(period);const next:Record<string,unknown>={...values()};delete next.company;
  store.updateVoucher(voucher.id,next);expect(voucher.company).toBe(company);expect(collectionStatus(voucher)).toBe('matched');expect(store.state.nameAssociations?.[0]?.voucherIds).toContain(voucher.id);
 });
 it('可以解除仅名称关联，凭证及原件回到请复核且档案移除',async()=>{
  const {voucher,doc}=await pair();await store.autoMatch(period);store.unmatchVoucher(voucher.id,'重新确认所属单位');
  expect(collectionStatus(voucher)).toBe('review');expect(collectionStatus(doc)).toBe('review');expect(visibleArchiveGroups(store.state).filter(group=>group.period===period)).toEqual([]);
 });
 it('删除最后的关联凭证或单据不会留下孤立企业档案',async()=>{
  const {voucher,doc}=await pair();await store.autoMatch(period);await store.deleteVouchers([voucher.id]);expect(collectionStatus(doc)).toBe('review');expect(store.state.nameAssociations).toEqual([]);
 });
 it('停用名称规则只在再次执行时解除该规则产生的名称组',async()=>{
  const {doc}=await pair();await store.autoMatch(period);store.updateRule('R08',{enabled:false});expect(collectionStatus(doc)).toBe('matched');
  await store.autoMatch(period);expect(collectionStatus(doc)).toBe('review');expect(store.state.nameAssociations).toEqual([]);
 });
 it('刷新后依据、成员、原始金额及独立关系状态保持',async()=>{
  const {voucher,doc}=await pair();await store.autoMatch(period);await nextTick();vi.resetModules();store=(await import('../src/store')).useArchiveStore();
  expect(store.state.nameAssociations?.[0]?.ruleId).toBe('R08');expect(store.state.nameAssociations?.[0]?.documentIds).toEqual([doc.id]);expect(store.state.vouchers.find(item=>item.id===voucher.id)?.documentIds).toEqual([]);expect(store.state.documents.find(item=>item.id===doc.id)?.amount).toBe(999);
  expect(collectionStatus(store.state.documents.find(item=>item.id===doc.id)!)).toBe('matched');
 });
 it('升级旧规则时追加名称规则但不自动关联，已有数据点击后无需重导',async()=>{
  await pair();await nextTick();const saved=JSON.parse(memory.get('langchao-cloud-demo-v1')!);saved.rules=saved.rules.filter((rule:MatchRule)=>rule.id!=='R08');delete saved.nameAssociations;memory.set('langchao-cloud-demo-v1',JSON.stringify(saved));
  vi.resetModules();store=(await import('../src/store')).useArchiveStore();expect(store.state.rules.find(rule=>rule.id==='R08')?.enabled).toBe(true);expect(store.state.nameAssociations).toEqual([]);
  expect(collectionStatus(store.state.vouchers.find(item=>item.no==='名称-1')!)).toBe('pending');await store.autoMatch(period);expect(store.state.nameAssociations?.[0]?.documentIds).toHaveLength(1);
 });
 it('更改名称字段后刷新保留执行快照，只有重新运行才按新配置重算',async()=>{
  await store.importVoucherBatch([{values:values()}]);const doc=await store.addDocument(file(),fields('PAYEE',{payerName:other,payeeName:company}));await store.autoMatch(period);
  store.updateRule('R08',{conditions:{partyField:'payerName'}});await nextTick();vi.resetModules();store=(await import('../src/store')).useArchiveStore();
  expect(store.state.nameAssociations?.[0]?.partyField).toBe('either');expect(collectionStatus(store.state.documents.find(item=>item.id===doc.id)!)).toBe('matched');
  await store.autoMatch(period);expect(store.state.nameAssociations?.some(group=>group.basis==='company')).toBe(false);
 });
 it('企业名称关联保留红字分录及专项原因，不生成任何财务附件关系',async()=>{
  const metadata={sourceKind:'pdf-text' as const,sourcePages:[1],company,entries:[{summary:'红字',account:'银行存款',debit:'200.00',credit:'0.00'},{summary:'红字',account:'费用',debit:'-100.00',credit:'0.00'},{summary:'对方',account:'往来',debit:'0.00',credit:'100.00'}],reviewReasons:[]};
  await store.importVoucherBatch([{file:file(),values:values(),metadata}]);await store.addDocument(file(),fields());await store.autoMatch(period);
  const voucher=store.state.vouchers.find(item=>item.no==='名称-1')!;
  expect(collectionStatus(voucher)).toBe('matched');expect(voucher.status).toBe('pending');expect(voucher.documentIds).toEqual([]);expect(voucher.entries?.[1]?.debit).toBe('-100.00');expect(voucher.autoMatchBlockedReasons).toContain('含红字分录，需人工核对抵销关系');expect(store.state.lastMatchRun?.financialMatched).toBe(0);
 });
});

describe('只有原始单据的名称关联与页面同步',()=>{
 it('没有同期间凭证时，五份同名原件建立独立组，两个不同主体不进入组',()=>{
  const docs=[...Array.from({length:5},(_,i)=>d('ticket-'+i,{payeeName:'独立交易方'+i})),d('orphan-a',{payerName:'无关付款甲',payeeName:'无关收款甲'}),d('orphan-b',{payerName:'无关付款乙',payeeName:'无关收款乙'})];
  const groups=evaluateNameAssociations([],docs,[nameAssociationRule()],time);
  expect(groups).toHaveLength(1);expect(groups[0]?.basis).toBe('documents');expect(groups[0]?.documentIds).toEqual(docs.slice(0,5).map(doc=>doc.id));expect(groups[0]?.voucherIds).toEqual([]);
 });
 it('按钮后五份单据状态、档案成员、运行统计一致，刷新后仍保留',async()=>{
  for(let i=0;i<5;i++)await store.addDocument(file(),fields('ONLY-'+i,{payeeName:'独立对方'+i}));
  for(let i=0;i<2;i++)await store.addDocument(file(),fields('ORPHAN-'+i,{payerName:'无关付款'+i,payeeName:'无关收款'+i}));
  expect(store.state.documents.filter(doc=>doc.date.startsWith(period)).every(doc=>collectionStatus(doc)==='pending')).toBe(true);
  await store.autoMatch(period);
  const docs=store.state.documents.filter(doc=>doc.date.startsWith(period));
  expect(docs.filter(doc=>collectionStatus(doc)==='matched')).toHaveLength(5);expect(docs.filter(doc=>collectionStatus(doc)==='review')).toHaveLength(2);
  expect(visibleArchiveGroups(store.state).filter(group=>group.period===period)[0]?.documentIds).toHaveLength(5);
  expect(store.state.lastMatchRun).toMatchObject({associatedDocuments:5,newlyAssociatedDocuments:5,remainingDocuments:2,nameAssociatedDocuments:5,financialMatched:0,matched:0});
  await nextTick();vi.resetModules();store=(await import('../src/store')).useArchiveStore();
  expect(store.state.documents.filter(doc=>doc.date.startsWith(period)&&collectionStatus(doc)==='matched')).toHaveLength(5);
  expect(visibleArchiveGroups(store.state).filter(group=>group.period===period)[0]?.documentIds).toHaveLength(5);
  await store.autoMatch(period);expect(store.state.lastMatchRun?.newlyAssociatedDocuments).toBe(0);
 });
 it('仅一份同名原件不能单独声称关联成功，跨期间不能凑成两份',()=>{
  expect(evaluateNameAssociations([],[d()],[nameAssociationRule()],time)).toEqual([]);
  expect(evaluateNameAssociations([],[d(),d('next',{date:'2026-07-01'})],[nameAssociationRule()],time)).toEqual([]);
 });
 it('遵守收付款角色、类型与阈值，不因没有凭证而忽略规则',()=>{
  const docs=[d('a',{payerName:'交易对方甲',payeeName:company}),d('b',{payerName:'交易对方乙',payeeName:company})];
  const rule=nameAssociationRule();rule.conditions!.partyField='payerName';expect(evaluateNameAssociations([],docs,[rule],time)).toEqual([]);
  rule.conditions!.partyField='payeeName';expect(evaluateNameAssociations([],docs,[rule],time)[0]?.documentIds).toEqual(['a','b']);
  rule.conditions!.documentTypes=['invoice'];expect(evaluateNameAssociations([],docs,[rule],time)).toEqual([]);
 });
 it('同一交易双方重复出现时可关联，支持度相同但成员不同则转人工',()=>{
  expect(evaluateNameAssociations([],[d(),d('another')],[nameAssociationRule()],time)[0]?.documentIds).toEqual(['d1','another']);
  const docs=[d('ab',{payerName:'主体甲公司',payeeName:'主体乙公司'}),d('ac',{payerName:'主体甲公司',payeeName:'主体丙公司'}),d('bd',{payerName:'主体乙公司',payeeName:'主体丁公司'})];
  expect(evaluateNameAssociations([],docs,[nameAssociationRule()],time)).toEqual([]);
 });
 it('不会沿甲乙、乙丙、丙丁的交易链把不同主体合并',()=>{
  const docs=[d('ab',{payerName:'主体甲公司',payeeName:'主体乙公司'}),d('bc',{payerName:'主体乙公司',payeeName:'主体丙公司'}),d('cd',{payerName:'主体丙公司',payeeName:'主体丁公司'})];
  expect(evaluateNameAssociations([],docs,[nameAssociationRule()],time)).toEqual([]);
 });
 it('同名新导入单据保持待匹配，不能自动进入已存在的单据组',async()=>{
  for(let i=0;i<2;i++)await store.addDocument(file(),fields('BATCH-'+i,{payeeName:'独立对方'+i}));await store.autoMatch(period);
  const fresh=await store.addDocument(file(),fields('BATCH-NEW',{payeeName:'新对方'}));expect(collectionStatus(fresh)).toBe('pending');
  expect(store.state.nameAssociations?.[0]?.documentIds).not.toContain(fresh.id);await store.autoMatch(period);expect(collectionStatus(fresh)).toBe('matched');expect(store.state.lastMatchRun?.newlyAssociatedDocuments).toBe(1);
 });
 it('删除最后一对中的一份后解除孤立组，剩余单据回到请复核',async()=>{
  const first=await store.addDocument(file(),fields('DELETE-A',{payeeName:'独立甲'}));const second=await store.addDocument(file(),fields('DELETE-B',{payeeName:'独立乙'}));
  await store.autoMatch(period);expect(collectionStatus(second)).toBe('matched');await store.deleteDocuments([first.id]);
  expect(collectionStatus(second)).toBe('review');expect(store.state.nameAssociations).toEqual([]);
 });
});
