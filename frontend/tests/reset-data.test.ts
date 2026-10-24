import 'fake-indexeddb/auto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {nextTick} from 'vue';
import {useArchiveStore} from '../src/store';
import * as files from '../src/fileStorage';

const key='langchao-cloud-demo-v1',memory=new Map<string,string>();
const storage={getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)};
vi.stubGlobal('localStorage',storage);
let store=useArchiveStore();
const pdf=(name='reset.pdf')=>new File(['%PDF-1.7 synthetic'],name,{type:'application/pdf'});
async function populate(){
 await store.importVoucherBatch([{file:pdf(),values:{no:'清空-1',period:'2026-06',date:'2026-06-01',summary:'合成清空测试',supplier:'合成公司',amount:100}}]);
 const doc=await store.addDocument(pdf('original.pdf'),{type:'invoice',date:'2026-06-01',supplier:'合成公司',payerName:'合成公司',amount:100,number:'CLEAR-1',seal:true,extractionStatus:'reviewed'});
 const voucher=store.state.vouchers[0]!;store.manualMatch(voucher.id,[doc.id],'合成核对');
 const archive=store.generateArchive({period:'2026-06',startVoucherNo:voucher.no,endVoucherNo:voucher.no});archive.fileId='archive-pdf';
 await files.saveFiles([{id:'archive-pdf',file:pdf('archive.pdf')},{id:'orphan-file',file:pdf('orphan.pdf')}]);
 storage.setItem('langchao:last-export-hash','synthetic-export-hash');await nextTick();
 return {voucher,doc};
}
beforeEach(async()=>{vi.restoreAllMocks();await store.resetData();await nextTick();});

describe('清空全部业务数据而不是恢复演示',()=>{
 it('首次打开没有演示记录，仍有默认可用规则',async()=>{
  memory.clear();vi.resetModules();store=(await import('../src/store')).useArchiveStore();
  for(const collection of [store.state.vouchers,store.state.documents,store.state.archives,store.state.logs,store.state.payerGroups,store.state.nameAssociations])expect(collection).toEqual([]);
  expect(store.state.rules).toHaveLength(8);expect(store.state.rules.every(rule=>rule.enabled)).toBe(true);
 });
 it('同时清除锁定档案、凭证、单据、关系、日志、原件PDF及孤儿文件',async()=>{
  const {voucher,doc}=await populate();const ids=[voucher.fileId!,doc.fileId!,'archive-pdf','orphan-file'];
  store.state.lastMatchRun={id:'run',time:'2026-10-22',period:'2026-06',matched:1,remaining:0,groupCount:1,outcomes:[],rules:[]};
  await store.resetData();await nextTick();
  for(const field of ['vouchers','documents','archives','logs','payerGroups','nameAssociations'] as const)expect(store.state[field]).toEqual([]);
  for(const id of ids)expect(await files.loadFile(id)).toBeUndefined();
  expect(store.state.lastMatchRun).toBeUndefined();expect(store.state.lastImportSequence).toBe(0);expect(store.state.matchDataRevision).toBe(0);
  expect(storage.getItem('langchao:last-export-hash')).toBeNull();expect(JSON.parse(storage.getItem(key)!).vouchers).toEqual([]);
 });
 it('刷新后保持空白，不重新注入示例，也不恢复旧匹配',async()=>{
  await populate();await store.resetData();await nextTick();vi.resetModules();store=(await import('../src/store')).useArchiveStore();
  expect(store.state.vouchers).toEqual([]);expect(store.state.documents).toEqual([]);expect(store.state.archives).toEqual([]);expect(store.state.logs).toEqual([]);expect(store.state.lastMatchRun).toBeUndefined();
 });
 it('清空后可以重新导入，序号从1开始，规则恢复默认',async()=>{
  await populate();store.updateRule('R08',{enabled:false});await store.resetData();
  await store.importVoucherBatch([{values:{no:'新数据-1',period:'2026-06',date:'2026-06-01',summary:'新业务',supplier:'新企业',amount:20}}]);
  expect(store.state.vouchers).toHaveLength(1);expect(store.state.vouchers[0]?.importSequence).toBe(1);expect(store.state.rules.find(rule=>rule.id==='R08')?.enabled).toBe(true);
 });
 it('文件事务失败时保留原列表及持久化数据，避免虚假成功',async()=>{
  const {doc}=await populate();const before=storage.getItem(key);vi.spyOn(await import('../src/fileStorage'),'clearFiles').mockRejectedValueOnce(new Error('合成清理失败'));
  await expect(store.resetData()).rejects.toThrow('合成清理失败');expect(store.state.vouchers).toHaveLength(1);expect(storage.getItem(key)).toBe(before);expect(await files.loadFile(doc.fileId!)).toBeTruthy();expect(storage.getItem('langchao:last-export-hash')).toBe('synthetic-export-hash');
 });
 it('持久化空状态失败时不先删文件',async()=>{
  const {doc}=await populate();vi.spyOn(storage,'setItem').mockImplementationOnce(()=>{throw new Error('合成权限失败');});
  await expect(store.resetData()).rejects.toThrow('无法保存清空状态');expect(store.state.vouchers).toHaveLength(1);expect(await files.loadFile(doc.fileId!)).toBeTruthy();
 });
 it('匹配执行期间拒绝清空，避免异步结果重新写入空列表',async()=>{
  const running=store.autoMatch('2026-06');await expect(store.resetData()).rejects.toThrow('自动匹配正在执行');await running;
 });
});
