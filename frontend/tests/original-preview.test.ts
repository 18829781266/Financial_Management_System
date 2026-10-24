import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {ArchiveRecord} from '../src/types';

const mocks=vi.hoisted(()=>({loadFile:vi.fn(),getDocument:vi.fn(),workerCreated:vi.fn(),workerDestroy:vi.fn()}));
vi.mock('../src/fileStorage',()=>({loadFile:mocks.loadFile}));
vi.mock('pdfjs-dist',()=>({getDocument:mocks.getDocument,GlobalWorkerOptions:{},PDFWorker:class{constructor(){mocks.workerCreated();}destroy(){mocks.workerDestroy();}}}));
import {prepareOriginalPages} from '../src/originalPreview';

const record=(fileId?:string,fileName='银行原始回单.pdf'):ArchiveRecord=>({kind:'document',no:'BANK-1',date:'2026-06-01',supplier:'合成企业',amount:100,summary:'原件',fileId,fileName});
const pdfBlob=()=>new Blob(['%PDF-1.7\nSynthetic preview fixture'],{type:'application/pdf'});
function pdfTask(numPages=2){const pdf={numPages,getPage:vi.fn()};const destroy=vi.fn(async()=>undefined);return {pdf,task:{promise:Promise.resolve(pdf),destroy},destroy};}

beforeEach(()=>{vi.clearAllMocks();});
describe('银行原件翻页数据',()=>{
 it('按真实PDF页数展开，保留原件和页序，不把多页原件当成一张信息页',async()=>{
  const first=pdfTask(3),second=pdfTask(2);mocks.loadFile.mockResolvedValue(pdfBlob());mocks.getDocument.mockReturnValueOnce(first.task).mockReturnValueOnce(second.task);
  const records=[record('first'),record('second','记账凭证.pdf')];const result=await prepareOriginalPages(records);
  expect(result.pages.map(page=>[page.recordIndex,page.pageNumber,page.pageCount])).toEqual([[0,1,3],[0,2,3],[0,3,3],[1,1,2],[1,2,2]]);
  expect(result.pages[0]!.record).toBe(records[0]);expect(result.pages[2]!.source).toEqual({kind:'pdf',pdf:first.pdf});expect(result.pages[2]!.label).toBe('银行原始回单.pdf · 3/3');
  expect(new Set(result.pages.map(page=>page.key)).size).toBe(5);expect(first.pdf.getPage).not.toHaveBeenCalled();await result.dispose();
 });
 it('同一文件复用加载资源，关闭预览时每个PDF只销毁一次',async()=>{
  const loaded=pdfTask(2);mocks.loadFile.mockResolvedValue(pdfBlob());mocks.getDocument.mockReturnValue(loaded.task);
  const result=await prepareOriginalPages([record('same'),record('same')]);expect(result.pages).toHaveLength(4);expect(mocks.loadFile).toHaveBeenCalledTimes(1);expect(mocks.getDocument).toHaveBeenCalledTimes(1);
  await result.dispose();await result.dispose();expect(loaded.destroy).toHaveBeenCalledTimes(1);
 });
 it('五十份独立原件共享一个线程，关闭时先结束所有文档并且只关闭一次线程',async()=>{
  const tasks=Array.from({length:50},()=>pdfTask(1));mocks.loadFile.mockResolvedValue(pdfBlob());
  let index=0;mocks.getDocument.mockImplementation(()=>tasks[index++]!.task);
  const result=await prepareOriginalPages(tasks.map((_,i)=>record('bulk-'+i)));
  expect(result.pages).toHaveLength(50);expect(mocks.workerCreated).toHaveBeenCalledTimes(1);
  const workers=mocks.getDocument.mock.calls.map(call=>call[0].worker);
  expect(new Set(workers).size).toBe(1);expect(mocks.workerDestroy).not.toHaveBeenCalled();
  await result.dispose();await result.dispose();
  expect(tasks.every(item=>item.destroy.mock.calls.length===1)).toBe(true);expect(mocks.workerDestroy).toHaveBeenCalledTimes(1);
  expect(mocks.workerDestroy.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...tasks.map(item=>item.destroy.mock.invocationCallOrder[0]!)));
 });
 it('只读原件，不回写文件或调用文字/OCR重排，配置本地中文字体资源',async()=>{
  const loaded=pdfTask(1);mocks.loadFile.mockResolvedValue(pdfBlob());mocks.getDocument.mockReturnValue(loaded.task);
  const result=await prepareOriginalPages([record('read-only')]);const options=mocks.getDocument.mock.calls[0]![0];
  expect(new TextDecoder().decode(options.data)).toContain('%PDF-1.7');expect(options.isEvalSupported).toBe(false);expect(options.cMapUrl).toContain('/pdfjs/cmaps/');expect(options.standardFontDataUrl).toContain('/pdfjs/standard_fonts/');expect(result.pages[0]!.source?.kind).toBe('pdf');await result.dispose();
 });
 it('缺失原件各自明确占位，不用合成信息页冒充银行回单',async()=>{
  mocks.loadFile.mockResolvedValue(undefined);const result=await prepareOriginalPages([record(),record('missing')]);
  expect(result.pages).toHaveLength(2);expect(result.pages[0]!.error).toContain('未上传原始文件');expect(result.pages[1]!.error).toContain('未找到本地原件');expect(result.pages.every(page=>!page.source)).toBe(true);expect(mocks.getDocument).not.toHaveBeenCalled();await result.dispose();
 });
 it('读取权限失败只影响对应原件，后续原件仍能预览',async()=>{
  const loaded=pdfTask(1);mocks.loadFile.mockRejectedValueOnce(new Error('permission denied')).mockResolvedValueOnce(pdfBlob());mocks.getDocument.mockReturnValue(loaded.task);
  const result=await prepareOriginalPages([record('blocked'),record('valid')]);expect(result.pages[0]!.error).toContain('存储权限');expect(result.pages[1]!.source?.kind).toBe('pdf');await result.dispose();
 });
 it('损坏PDF保留失败页并及时释放加载任务，不阻塞其他原件',async()=>{
  const destroy=vi.fn(async()=>undefined);mocks.loadFile.mockResolvedValue(pdfBlob());mocks.getDocument.mockImplementation(()=>({promise:Promise.reject(new Error('Invalid PDF structure')),destroy}));
  const result=await prepareOriginalPages([record('corrupt')]);expect(result.pages[0]!.error).toContain('加密或损坏');expect(destroy).toHaveBeenCalledTimes(1);await result.dispose();expect(destroy).toHaveBeenCalledTimes(1);
 });
 it('超500页PDF清楚提示拆分，避免制造截断的原件预览',async()=>{
  const loaded=pdfTask(501);mocks.loadFile.mockResolvedValue(pdfBlob());mocks.getDocument.mockReturnValue(loaded.task);
  const result=await prepareOriginalPages([record('too-long')]);expect(result.pages).toHaveLength(1);expect(result.pages[0]!.error).toContain('500 页');expect(loaded.destroy).toHaveBeenCalledTimes(1);await result.dispose();
 });
 it('图片保持原始Blob临时URL，复用并在销毁时释放',async()=>{
  const png=new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'});mocks.loadFile.mockResolvedValue(png);
  const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:original-image');const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>undefined);
  const result=await prepareOriginalPages([record('image','原始回单.png'),record('image','原始回单.png')]);expect(result.pages.map(page=>page.source)).toEqual([{kind:'image',url:'blob:original-image'},{kind:'image',url:'blob:original-image'}]);expect(create).toHaveBeenCalledExactlyOnceWith(png);expect(mocks.getDocument).not.toHaveBeenCalled();await result.dispose();await result.dispose();expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:original-image');create.mockRestore();revoke.mockRestore();
 });
 it('不认识的原件格式明确报错，空记录集合安全释放',async()=>{
  mocks.loadFile.mockResolvedValue(new Blob(['not an original']));const result=await prepareOriginalPages([record('unknown')]);expect(result.pages[0]!.error).toContain('格式无法预览');await result.dispose();const empty=await prepareOriginalPages([]);expect(empty.pages).toEqual([]);await empty.dispose();
 });
 it('切换前已取消的预览不读取任何原件',async()=>{
  const controller=new AbortController();controller.abort();
  await expect(prepareOriginalPages([record('never-loaded')],controller.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(mocks.loadFile).not.toHaveBeenCalled();expect(mocks.getDocument).not.toHaveBeenCalled();
 });
 it('切换分组中途取消时销毁进行中PDF、撤销已加载图片且停止读取后续原件',async()=>{
  const controller=new AbortController();
  const png=new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'});
  mocks.loadFile.mockResolvedValueOnce(png).mockResolvedValueOnce(pdfBlob());
  const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:cancelled-image');const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>undefined);
  let rejectPdf!:(error:Error)=>void;const promise=new Promise((_resolve,reject)=>{rejectPdf=reject;});
  const destroy=vi.fn(async()=>{rejectPdf(new Error('Loading task destroyed'));});
  let signalStarted!:()=>void;const started=new Promise<void>(resolve=>{signalStarted=resolve;});
  mocks.getDocument.mockImplementationOnce(()=>{signalStarted();return {promise,destroy};});
  const preparation=prepareOriginalPages([record('image'),record('loading'),record('never-loaded')],controller.signal);
  const rejected=expect(preparation).rejects.toMatchObject({name:'AbortError'});
  await started;controller.abort();await rejected;
  expect(mocks.loadFile.mock.calls.map(call=>call[0])).toEqual(['image','loading']);expect(destroy).toHaveBeenCalledTimes(1);expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:cancelled-image');
  expect(mocks.workerDestroy).toHaveBeenCalledTimes(1);
  create.mockRestore();revoke.mockRestore();
 });
});
