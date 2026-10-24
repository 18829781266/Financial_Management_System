import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getDocument:vi.fn(),workerDestroy:vi.fn(),order:[] as string[]}));
vi.mock('pdfjs-dist',()=>({
 GlobalWorkerOptions:{workerSrc:''},getDocument:mocks.getDocument,
 PDFWorker:class{destroy(){mocks.order.push('worker');mocks.workerDestroy();}},
}));
import {createPdfTextReader,readPdfText} from '../src/pdfText';
beforeEach(()=>{vi.clearAllMocks();mocks.order.length=0;vi.stubGlobal('location',{origin:'http://localhost'});});
afterEach(()=>vi.unstubAllGlobals());

describe('批量文字读取的取消与共享线程生命周期',()=>{
 it('正在读取文字时取消，先结束文档任务再销毁共享线程，不挂起取消按钮',async()=>{
  const controller=new AbortController();let started!:()=>void,rejectContent!:(error:Error)=>void;
  const active=new Promise<void>(resolve=>{started=resolve;});
  const cleanup=vi.fn();
  const destroy=vi.fn(async()=>{mocks.order.push('document');rejectContent(new Error('Loading task destroyed'));});
  mocks.getDocument.mockReturnValue({promise:Promise.resolve({numPages:1,getPage:async()=>({
   getTextContent:()=>{started();return new Promise((_resolve,reject)=>{rejectContent=reject;});},cleanup,
  })}),destroy});
  const reader=createPdfTextReader({signal:controller.signal});
  const pending=reader.read(new File(['%PDF-1.7'],'取消文字.pdf'));
  const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});
  await active;controller.abort();await rejected;reader.dispose();reader.dispose();
  expect(destroy).toHaveBeenCalledTimes(1);expect(cleanup).toHaveBeenCalledTimes(1);
  expect(mocks.order).toEqual(['document','worker']);expect(mocks.workerDestroy).toHaveBeenCalledTimes(1);
 });
 it('完成读取后可复用线程，批次结束仅释放一次',async()=>{
  const destroy=vi.fn(async()=>undefined);
  mocks.getDocument.mockImplementation(()=>({promise:Promise.resolve({numPages:1,getPage:async()=>({
   view:[0,0,595,842],getTextContent:async()=>({items:[]}),cleanup:vi.fn(),
  })}),destroy}));
  const reader=createPdfTextReader();const file=new File(['%PDF-1.7'],'空文字.pdf');
  expect(await reader.read(file)).toHaveLength(1);expect(await reader.read(file)).toHaveLength(1);
  expect(mocks.workerDestroy).not.toHaveBeenCalled();reader.dispose();reader.dispose();
  expect(destroy).toHaveBeenCalledTimes(2);expect(mocks.workerDestroy).toHaveBeenCalledTimes(1);
  expect(mocks.getDocument.mock.calls[0]![0].worker).toBe(mocks.getDocument.mock.calls[1]![0].worker);
 });
 it('预取消不读取文件也不启动文档',async()=>{
  const controller=new AbortController();controller.abort();const file=new File(['%PDF-1.7'],'未开始.pdf');
  const read=vi.spyOn(file,'arrayBuffer');
  await expect(readPdfText(file,{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  expect(read).not.toHaveBeenCalled();expect(mocks.getDocument).not.toHaveBeenCalled();
 });
});
