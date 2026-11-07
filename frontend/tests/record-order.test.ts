import {resetTestState} from './fixtures/demo-state';
import 'fake-indexeddb/auto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {nextTick} from 'vue';
import {latestImported,validImportSequence} from '../src/recordOrder';
import {useArchiveStore} from '../src/store';
import * as files from '../src/fileStorage';
const storage=new Map<string,string>();
vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
const store=useArchiveStore();
const values=(no:string,date='2026-06-01')=>({no,period:date.slice(0,7),date,summary:'合成导入排序测试',supplier:'测试客商有限公司',amount:'100.00'});
const voucher=(no:string,date?:string)=>({values:values(no,date)});
const document=(number:string,date='2026-06-01')=>({file:new File(['%PDF-1.7\nsynthetic'],'合成.pdf',{type:'application/pdf'}),fields:{number,date,amount:'100.00',supplier:'测试客商有限公司',type:'invoice' as const}});
beforeEach(()=>{vi.restoreAllMocks();resetTestState(store);});

describe('最新导入排序兼容策略',()=>{
 it('凭提交序号而非业务日期或凭证号显示最新数据',()=>{
  const rows=[{id:'较早导入',date:'2026-12-31',importSequence:1},{id:'最新导入',date:'2025-01-01',importSequence:2}];
  expect(latestImported(rows,'append').map(row=>row.id)).toEqual(['最新导入','较早导入']);
 });
 it('同毫秒批量记录按逐行提交序号倒序',()=>{
  const rows=[1,2,3].map(importSequence=>({importSequence,importedAt:'2026-10-21T02:00:00.000Z'}));
  expect(latestImported(rows,'prepend').map(row=>row.importSequence)).toEqual([3,2,1]);
 });
 it('系统时钟回拨不覆盖可靠的导入先后',()=>{
  const rows=[{id:'前批',importSequence:1,importedAt:'2026-10-21T03:00:00Z'},{id:'后批',importSequence:2,importedAt:'2026-10-21T02:00:00Z'}];
  expect(latestImported(rows,'append')[0]?.id).toBe('后批');
 });
 it('旧凭证按原来尾部追加方向逆序，不修改业务数组',()=>{
  const rows=[{id:'旧1'},{id:'旧2'},{id:'旧3'}];const original=[...rows];
  expect(latestImported(rows,'append').map(row=>row.id)).toEqual(['旧3','旧2','旧1']);expect(rows).toEqual(original);
 });
 it('旧单据按原来头部插入方向保持稳定顺序',()=>{
  const rows=[{id:'最新旧单据'},{id:'较旧单据'}];
  expect(latestImported(rows,'prepend')).toEqual(rows);expect(latestImported(rows,'prepend')).not.toBe(rows);
 });
 it('新元数据排在旧记录之前，只有时间时按实际时间回退',()=>{
  const rows=[{id:'legacy'},{id:'time-old',importedAt:'2026-10-20T00:00:00Z'},{id:'time-new',importedAt:'2026-10-21T00:00:00Z'},{id:'sequence',importSequence:1,importedAt:'2026-01-01T00:00:00Z'}];
  expect(latestImported(rows,'append').map(row=>row.id)).toEqual(['sequence','time-new','time-old','legacy']);
 });
 it('无效序号和时间不会扰乱旧数据的稳定回退顺序',()=>{
  expect([0,-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1,'2',undefined].map(validImportSequence)).toEqual([0,0,0,0,0,0,0,0]);
  const rows=[{id:'a',importSequence:NaN,importedAt:'invalid'},{id:'b',importSequence:-2}];
  expect(latestImported(rows,'append').map(row=>row.id)).toEqual(['b','a']);expect(validImportSequence(2)).toBe(2);
 });
});

describe('成功导入时保存时间与全局递增序号',()=>{
 it('混合批次共用一次ISO时间，跨两类逐行递增且最后行优先',async()=>{
  await store.importMixedBatch([voucher('排序-1'),voucher('排序-2')],[document('DOC-1'),document('DOC-2')]);
  const vouchers=store.state.vouchers.slice(-2),docs=store.state.documents.slice(0,2);
  expect(vouchers.map(row=>row.importSequence)).toEqual([1,2]);expect(docs.map(row=>row.importSequence)).toEqual([3,4]);
  expect(new Set([...vouchers,...docs].map(row=>row.importedAt)).size).toBe(1);expect(vouchers[0]?.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);expect(store.state.lastImportSequence).toBe(4);
  expect(latestImported(store.state.vouchers,'append')[0]?.no).toBe('排序-2');expect(latestImported(store.state.documents,'prepend')[0]?.number).toBe('DOC-2');
 });
 it('后导入更早期间的凭证仍位于列表首位',async()=>{
  await store.importVoucherBatch([voucher('先导入','2026-12-31')]);await store.importVoucherBatch([voucher('后导入','2025-01-01')]);
  expect(latestImported(store.state.vouchers,'append')[0]?.no).toBe('后导入');expect(store.state.lastImportSequence).toBe(2);
 });
 it('重复或非法文件失败不占永久提交序号',async()=>{
  await expect(store.importMixedBatch([voucher('重复'),voucher('重复')],[document('DOC')])).rejects.toThrow('重复');
  const bad=document('BAD');bad.file=new File(['not PDF'],'bad.pdf');await expect(store.importMixedBatch([voucher('有效')],[bad])).rejects.toThrow('内容有效');
  expect(store.state.lastImportSequence).toBe(0);await store.importVoucherBatch([voucher('下一批')]);expect(store.state.vouchers.at(-1)?.importSequence).toBe(1);
 });
 it('文件事务失败不保存排序元数据，也不消耗序号',async()=>{
  vi.spyOn(files,'saveFiles').mockRejectedValueOnce(new Error('模拟文件保存失败'));
  await expect(store.importMixedBatch([voucher('失败')],[document('DOC')])).rejects.toThrow('模拟文件保存失败');
  expect(store.state.lastImportSequence).toBe(0);expect(store.state.vouchers).toHaveLength(12);expect(store.state.documents).toHaveLength(12);
  await store.importVoucherBatch([voucher('成功')]);expect(store.state.vouchers.at(-1)?.importSequence).toBe(1);
 });
 it('删除最新记录仍保留提交游标，不复用旧序号',async()=>{
  await store.importVoucherBatch([voucher('顺序-1'),voucher('顺序-2')]);const removed=store.state.vouchers.at(-1)!;await store.deleteVouchers([removed.id]);
  await store.importVoucherBatch([voucher('顺序-3')]);expect(store.state.vouchers.at(-1)?.importSequence).toBe(3);
 });
 it('编辑凭证与复核单据保留原导入时间和顺序',async()=>{
  await store.importMixedBatch([voucher('可编辑')],[document('可复核')]);const v=store.state.vouchers.at(-1)!,d=store.state.documents[0]!;
  const before=[v.importedAt,v.importSequence,d.importedAt,d.importSequence];
  store.updateVoucher(v.id,{...values('可编辑'),summary:'修改摘要'});store.updateDocument(d.id,{...document('可复核').fields,amount:'120.00'});
  expect([v.importedAt,v.importSequence,d.importedAt,d.importSequence]).toEqual(before);
 });
 it('忽略输入对象伪造的导入序号和时间',async()=>{
  const spoof={importSequence:999999,importedAt:'2099-01-01T00:00:00Z'};
  await store.importMixedBatch([{values:{...values('输入伪造'),...spoof}}],[{...document('DOC'),fields:{...document('DOC').fields,...spoof}}]);
  expect(store.state.vouchers.at(-1)?.importSequence).toBe(1);expect(store.state.documents[0]?.importSequence).toBe(2);expect(store.state.vouchers.at(-1)?.importedAt).not.toBe(spoof.importedAt);
 });
 it('恢复旧数据时取已存在两类序号最大值，清空数据则重新开始',async()=>{
  store.state.vouchers[0]!.importSequence=70;store.state.documents[0]!.importSequence=80;store.state.lastImportSequence=5;
  await store.importVoucherBatch([voucher('继续最大值')]);expect(store.state.vouchers.at(-1)?.importSequence).toBe(81);
  await store.resetData();await store.importVoucherBatch([voucher('重置后')]);expect(store.state.vouchers.at(-1)?.importSequence).toBe(1);
 });
 it('刷新恢复时间和序号后继续递增，排序不变',async()=>{
  await store.importVoucherBatch([voucher('持久化-1'),voucher('持久化-2')]);await nextTick();
  const saved=JSON.parse(storage.get('langchao-cloud-demo-v1')!);expect(saved.lastImportSequence).toBe(2);expect(saved.vouchers.at(-1).importedAt).toBeTruthy();
  vi.resetModules();const restored=(await import('../src/store')).useArchiveStore();
  expect(latestImported(restored.state.vouchers,'append')[0]?.no).toBe('持久化-2');await restored.importVoucherBatch([voucher('持久化-3')]);expect(restored.state.vouchers.at(-1)?.importSequence).toBe(3);
 });
});
