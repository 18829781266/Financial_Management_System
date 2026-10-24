import {resetTestState} from './fixtures/demo-state';
import 'fake-indexeddb/auto';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {nextTick} from 'vue';
import {useArchiveStore,parseVoucherFile,amountCents,supplierSimilarity} from '../src/store';
import {loadFile,validateMedia} from '../src/fileStorage';
const storage=new Map<string,string>();
vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
const store=useArchiveStore();
const values=(no='记-0101',amount:unknown=100)=>({no,period:'2026-10',date:'2026-10-20',summary:'测试费用',supplier:'测试有限公司',amount,expectedAttachments:1});
const json=(rows:unknown,name='vouchers.json')=>new File([JSON.stringify(rows)],name,{type:'application/json'});
const pdf=(name='凭证.pdf')=>new File(['%PDF-1.7\ntest fixture'],name,{type:'application/pdf'});
const docFields=(number='INV-TEST',amount=100)=>({supplier:'测试有限公司',number,amount,date:'2026-10-20',type:'invoice' as const,seal:true});
beforeEach(()=>resetTestState(store));
describe('导入与清洗',()=>{
 it('PDF不会进入JSON.parse或暴露原生异常',async()=>{await expect(store.importVouchers(pdf())).rejects.toThrow('PDF/图片');expect(store.state.vouchers).toHaveLength(12);});
 it('非法JSON显示可理解的文件名和格式提示',async()=>{await expect(store.importVouchers(new File(['%PDF-1.7'],'坏文件.json'))).rejects.toThrow('JSON 格式错误');});
 it('不接受空数据、null或非对象行',async()=>{for(const content of [[],null,[null],[3]])await expect(parseVoucherFile(json(content))).rejects.toThrow();});
 it('支持多文件混合结构化数据与中文列名',async()=>{const a=await parseVoucherFile(json([values()]));const b=await parseVoucherFile(new File(['凭证号,期间,日期,摘要,客商,金额,附件数\r\n记-0102,2026-10,2026-10-20,费用,测试有限公司,200,1'],'b.csv'));expect(await store.importVoucherBatch([...a,...b].map(values=>({values})))).toBe(2);expect(store.state.vouchers).toHaveLength(14);});
 it('支持ERP字段别名与包裹vouchers对象',async()=>{const count=await store.importVouchers(json({vouchers:[{VoucherNo:'记-0999',Period:'2026-10',Abstract:'摘要',SupplierName:'测试公司',Amount:'¥1,234.01',voucherDate:'2026/10/20'}]}));expect(count).toBe(1);expect(store.state.vouchers.at(-1)?.amount).toBe(1234.01);});
 it('CSV含引号逗号换行及BOM可解析',async()=>{const records=await parseVoucherFile(new File(['\uFEFFno,period,date,summary,supplier,amount\r\n记-0900,2026-10,2026-10-20,"服务,费用\n第二行",测试公司,"1,234.01"'],'a.csv'));await store.importVoucherBatch(records.map(values=>({values})));expect(store.state.vouchers.at(-1)?.amount).toBe(1234.01);});
 it('CSV不闭合引号、行列不一致拒绝',async()=>{await expect(parseVoucherFile(new File(['a,b\n"c,d'],'a.csv'))).rejects.toThrow('引号');await expect(parseVoucherFile(new File(['a,b\nc'],'a.csv'))).rejects.toThrow('列数');});
 it('跨文件重复使整批回滚',async()=>{await expect(store.importVoucherBatch([{values:values()},{values:values()}])).rejects.toThrow('重复');expect(store.state.vouchers).toHaveLength(12);});
 it('遇到已有凭证整批不写入',async()=>{await expect(store.importVoucherBatch([{values:values()},{values:values('记-0001')}])).rejects.toThrow('已存在');expect(store.state.vouchers).toHaveLength(12);});
 it('非法日期、跨期间、负数金额和附件数均拒绝',async()=>{for(const invalid of [{...values(),date:'2026-02-30'},{...values(),date:'2026-09-20'},{...values(),amount:-1},{...values(),expectedAttachments:1.2}])await expect(store.importVoucherBatch([{values:invalid}])).rejects.toThrow();expect(store.state.vouchers).toHaveLength(12);});
 it('限制空批和5001行大批量',async()=>{await expect(store.importVoucherBatch([])).rejects.toThrow();await expect(store.importVoucherBatch(Array.from({length:5001},(_,i)=>({values:values(`记-${i}`)})))).rejects.toThrow('5000');});
 it('支持500条凭证批量导入且持久化元数据',async()=>{await store.importVoucherBatch(Array.from({length:500},(_,i)=>({values:values(`测-${i}`)})));await nextTick();expect(store.state.vouchers).toHaveLength(512);expect(JSON.parse(storage.get('langchao-cloud-demo-v1')!).vouchers).toHaveLength(512);});
 it('PDF人工录入后可批量保存并从IndexedDB读取原件',async()=>{await store.importVoucherBatch([{values:values(),file:pdf('A.pdf')},{values:values('记-0102'),file:pdf('B.pdf')}]);const imported=store.state.vouchers.slice(-2);expect(imported.every(v=>v.fileId)).toBe(true);expect(await(await loadFile(imported[0]!.fileId!))?.text()).toContain('%PDF-1.7');});
 it('伪装成PDF或不支持的文件类型拒绝',async()=>{await expect(validateMedia(new File(['<script>'],'fake.pdf'))).rejects.toThrow('内容有效');await expect(validateMedia(new File(['test'],'a.exe'))).rejects.toThrow();});
 it('金额尾差按分精确处理与名称后缀归一',()=>{expect(amountCents('¥1,234.01')).toBe(123401);expect(supplierSimilarity('阿里云','阿里云计算有限公司')).toBe(100);expect(()=>amountCents('1.001')).toThrow();});
});
describe('单据上传、复核和预览持久化',()=>{
 it('批量上传可保留待复核状态',async()=>{const docs=await store.addDocumentBatch([{file:pdf('a.pdf'),fields:{}},{file:pdf('b.pdf'),fields:{}}]);expect(docs).toHaveLength(2);expect(docs.every(d=>d.extractionStatus==='pending')).toBe(true);expect(await loadFile(docs[0]!.fileId!)).toBeDefined();});
 it('人工补齐后可参加匹配，复核前不匹配',async()=>{const doc=await store.addDocument(pdf(),{});expect(()=>store.updateDocument(doc.id,{...docFields(),amount:0})).toThrow();store.updateDocument(doc.id,docFields());expect(doc.extractionStatus).toBe('reviewed');expect(doc.number).toBe('INV-TEST');});
 it('同批同编号单据重复不产生半批数据',async()=>{await expect(store.addDocumentBatch([{file:pdf('a.pdf'),fields:docFields()},{file:pdf('b.pdf'),fields:docFields()}])).rejects.toThrow('已存在');expect(store.state.documents).toHaveLength(12);});
 it('已归档或已匹配单据不可修改',()=>{expect(()=>store.updateDocument('d001',docFields())).toThrow('只能编辑');});
});
describe('匹配、异常与规则',()=>{
 it('按R01-R07完成4组，包括0.01尾差和两发票汇总',async()=>{expect(await store.autoMatch('2026-10')).toMatchObject({matched:4,remaining:2});expect(store.state.vouchers.find(v=>v.id==='v009')?.documentIds).toHaveLength(2);expect(await store.autoMatch('2026-10')).toMatchObject({matched:0,remaining:2});});
 it('并发触发自动匹配只允许一个执行',async()=>{const run=store.autoMatch('2026-10');await expect(store.autoMatch('2026-10')).rejects.toThrow('正在执行');await expect(store.deleteVouchers(['v012'])).rejects.toThrow('正在执行');await run;});
 it('缺失凭证可恢复待匹配',()=>{store.restoreMissing('v011');expect(store.state.vouchers.find(v=>v.id==='v011')?.status).toBe('pending');});
 it('标记缺失要求原因，且允许补齐后直接手工匹配',async()=>{expect(()=>store.markMissing('v012','')).toThrow('原因');await store.importVouchers(json([values('记-0101',360)]));const v=store.state.vouchers.at(-1)!;store.markMissing(v.id,'补录中');store.manualMatch(v.id,['d012'],'已补齐原件');expect(v.status).toBe('matched');expect(v.missingReason).toBeUndefined();});
 it('手工匹配拒绝空原因、重复单据、跨期间和金额不一致',()=>{expect(()=>store.manualMatch('v007',['d007'],'')).toThrow();expect(()=>store.manualMatch('v007',['d007','d007'],'原因')).toThrow();expect(()=>store.manualMatch('v012',['d012'],'原因')).toThrow('金额');store.state.documents.find(d=>d.id==='d007')!.date='2026-09-08';expect(()=>store.manualMatch('v007',['d007'],'原因')).toThrow('复核');});
 it('精确标识歧义不会被后续规则任取一份',async()=>{const existing=store.state.documents.find(d=>d.id==='d007')!;store.state.documents.push({...existing,id:'conflict'});await store.autoMatch('2026-10');expect(store.state.vouchers.find(v=>v.id==='v007')?.status).toBe('pending');});
 it('两个凭证争用同一单据时均留待人工',async()=>{const v=store.state.vouchers.find(v=>v.id==='v007')!;store.state.vouchers.push({...v,id:'competition',no:'记-0099'});await store.autoMatch('2026-10');expect(v.status).toBe('pending');expect(store.state.documents.find(d=>d.id==='d007')?.status).toBe('pending');});
 it('精确标识也不能跨期间误关联',async()=>{store.state.documents.find(d=>d.id==='d007')!.date='2026-09-08';await store.autoMatch('2026-10');expect(store.state.vouchers.find(v=>v.id==='v007')?.status).toBe('pending');});
 it('规则停用和阈值修改生效，非法参数拒绝',async()=>{store.updateRule('R01',{enabled:false});expect(store.state.rules[0]?.enabled).toBe(false);expect(()=>store.updateRule('R01',{threshold:101})).toThrow();expect(()=>store.updateRule('R01',{dateWindow:0.5})).toThrow();expect(()=>store.updateRule('R01',{tolerance:-1})).toThrow();});
});
describe('批量删除和关联完整性',()=>{
 it('批量删除未归档凭证并写日志',async()=>{expect(await store.deleteVouchers(['v011','v012'])).toBe(2);expect(store.state.vouchers).toHaveLength(10);expect(store.state.logs[0]?.action).toBe('批量删除凭证');});
 it('混选已归档凭证整批拒绝',async()=>{await expect(store.deleteVouchers(['v001','v012'])).rejects.toThrow('已归档');expect(store.state.vouchers).toHaveLength(12);});
 it('不允许删除已归档凭证的单据',async()=>{await expect(store.deleteDocuments(['d001','d012'])).rejects.toThrow('只读档案');expect(store.state.documents).toHaveLength(12);});
 it('删除已匹配未归档凭证释放其单据',async()=>{await store.autoMatch('2026-10');await store.deleteVouchers(['v007']);expect(store.state.documents.find(d=>d.id==='d007')?.status).toBe('pending');});
 it('删除汇总匹配中的一个单据解除整组，释放其他单据',async()=>{await store.autoMatch('2026-10');await store.deleteDocuments(['d009']);const v=store.state.vouchers.find(v=>v.id==='v009')!;expect(v.status).toBe('pending');expect(v.documentIds).toEqual([]);expect(v.confidence).toBeUndefined();expect(store.state.documents.find(d=>d.id==='d010')?.status).toBe('pending');});
 it('删除上传文件同时清理IndexedDB',async()=>{const d=await store.addDocument(pdf(),docFields());await store.deleteDocuments([d.id]);expect(await loadFile(d.fileId!)).toBeUndefined();});
 it('重复ID或已不存在记录拒绝且不部分删除',async()=>{await expect(store.deleteVouchers(['v012','v012'])).rejects.toThrow('不重复');await expect(store.deleteDocuments(['missing'])).rejects.toThrow('记录已变化');});
 it('可编辑未归档凭证，归档数据拒绝修改',async()=>{await store.importVouchers(json([values()]));const v=store.state.vouchers.at(-1)!;store.updateVoucher(v.id,{...values(),amount:120});expect(v.amount).toBe(120);expect(()=>store.updateVoucher('v001',values())).toThrow('未归档');});
});
describe('电子档案校验',()=>{
 const request={period:'2026-10',startVoucherNo:'记-0007',endVoucherNo:'记-0010'};
 it('未匹配、缺章、附件数与金额不符均不能归档',async()=>{expect(()=>store.generateArchive(request)).toThrow('尚未完成');await store.autoMatch('2026-10');const d=store.state.documents.find(d=>d.id==='d007')!;d.seal=false;expect(()=>store.generateArchive(request)).toThrow('发票章');d.seal=true;const v=store.state.vouchers.find(v=>v.id==='v007')!;v.expectedAttachments=2;expect(()=>store.generateArchive(request)).toThrow('附件数量');v.expectedAttachments=1;d.amount=1;expect(()=>store.generateArchive(request)).toThrow('金额');});
 it('生成后锁定范围且不允许再次归档或删除',async()=>{await store.autoMatch('2026-10');const a=store.generateArchive(request);expect(a.voucherCount).toBe(4);expect(a.hash).toBeUndefined();expect(()=>store.generateArchive(request)).toThrow('重叠');await expect(store.deleteVouchers(['v007'])).rejects.toThrow('已归档');});
 it('非法期间、不存在边界和倒置范围拒绝',()=>{expect(()=>store.generateArchive({...request,period:'2026-13'})).toThrow();expect(()=>store.generateArchive({...request,startVoucherNo:'记-0010',endVoucherNo:'记-0007'})).toThrow();expect(()=>store.generateArchive({...request,startVoucherNo:'记-0000'})).toThrow();});
});
describe('回退与人工印章复核',()=>{
 it('未归档匹配可解除并重新编辑，原因必填',async()=>{await store.autoMatch('2026-10');expect(()=>store.unmatchVoucher('v007','')).toThrow('原因');store.unmatchVoucher('v007','修正金额');expect(store.state.vouchers.find(v=>v.id==='v007')?.status).toBe('pending');expect(store.state.documents.find(d=>d.id==='d007')?.status).toBe('pending');});
 it('已归档匹配不能解除',()=>{expect(()=>store.unmatchVoucher('v001','修正')).toThrow('未归档');});
 it('已匹配未归档发票可以核验印章',async()=>{store.state.documents.find(d=>d.id==='d007')!.seal=false;await store.autoMatch('2026-10');store.confirmSeal('d007');expect(store.state.documents.find(d=>d.id==='d007')?.seal).toBe(true);expect(store.state.logs[0]?.action).toBe('核验发票印章');});
 it('归档发票不能被修改印章核验结果',()=>{expect(()=>store.confirmSeal('d001')).toThrow('未归档');});
});

describe('档案持久化回归',()=>{it('生成后写入文件ID和哈希会触发持久化',async()=>{await store.autoMatch('2026-10');const a=store.generateArchive({period:'2026-10',startVoucherNo:'记-0007',endVoucherNo:'记-0010'});a.fileId='actual-pdf-id';a.hash='a'.repeat(64);await nextTick();expect(JSON.parse(storage.get('langchao-cloud-demo-v1')!).archives[0].hash).toBe('a'.repeat(64));});});
describe('金额错误上下文与原始文本校验',()=>{
 it('PDF空字段提示文件行和待填字段，不报空格式错误',async()=>{await expect(store.importVoucherBatch([{origin:'实际格式示例.pdf',file:pdf(),values:{}}])).rejects.toThrow(/第 1 行（实际格式示例.pdf）.*请填写金额/);expect(store.state.vouchers).toHaveLength(12);});
 it('含货币符号的结构化金额可导入且按分记录',async()=>{await store.importVoucherBatch([{values:values('记-1001','人民币 1,234.01 元')}]);expect(store.state.vouchers.at(-1)?.amount).toBe(1234.01);});
 it('单据不把科学计数法或三位小数先转Number放行',async()=>{for(const amount of ['1e3','1.230','1,23'])await expect(store.addDocumentBatch([{file:pdf('原始金额.pdf'),fields:{...docFields(),amount}}])).rejects.toThrow('原始金额.pdf');expect(store.state.documents).toHaveLength(12);});
 it('人民币全角金额在单据中也采用同一个解析器',async()=>{const docs=await store.addDocumentBatch([{file:pdf(),fields:{...docFields(),amount:'￥１，２３４．０１'}}]);expect(docs[0]?.amount).toBe(1234.01);});
 it('空值提示不被当成零金额写入',async()=>{await expect(store.importVoucherBatch([{values:values('记-1001','   ')}])).rejects.toThrow('请填写金额');await expect(store.importVoucherBatch([{values:values('记-1001',0)}])).rejects.toThrow('金额须大于 0');expect(store.state.vouchers).toHaveLength(12);});
});
