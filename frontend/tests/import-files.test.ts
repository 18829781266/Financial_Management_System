import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import JSZip from 'jszip';
import {PDFDocument,rgb} from 'pdf-lib';
import {createPdfSplitBatch,createPdfSplitSession,expandImportFiles,splitPdfFile} from '../src/importFiles';

// JSZip 使用浏览器 FileReader；Node 的 File/Blob 只提供 arrayBuffer，补齐同一异步读取语义。
class TestFileReader {
 result:ArrayBuffer|null=null;error:unknown=null;
 onload:((event:unknown)=>void)|null=null;onerror:((event:unknown)=>void)|null=null;
 readAsArrayBuffer(blob:Blob){void blob.arrayBuffer().then(value=>{this.result=value;this.onload?.({target:this});},error=>{this.error=error;this.onerror?.({target:this});});}
}
beforeAll(()=>vi.stubGlobal('FileReader',TestFileReader));
afterAll(()=>vi.unstubAllGlobals());
const zipped=async(entries:Record<string,string>,name='测试.zip')=>{const zip=new JSZip();for(const [path,value] of Object.entries(entries))zip.file(path,value);return new File([(await zip.generateAsync({type:'uint8array'})).buffer as ArrayBuffer],name);};
function crc32(data:Uint8Array){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
/** 没有 Unicode 扩展字段的 ZIP32 存储条目，模拟旧版 Windows 的 GBK 文件名。 */
function legacyZip(nameBytes:Uint8Array,content='legacy',declaredSize?:number){
 const bytes=new TextEncoder().encode(content);const local=new Uint8Array(30+nameBytes.length+bytes.length);const view=new DataView(local.buffer);
 view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint32(14,crc32(bytes),true);view.setUint32(18,bytes.length,true);view.setUint32(22,declaredSize??bytes.length,true);view.setUint16(26,nameBytes.length,true);local.set(nameBytes,30);local.set(bytes,30+nameBytes.length);
 const central=new Uint8Array(46+nameBytes.length);const cv=new DataView(central.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint32(16,crc32(bytes),true);cv.setUint32(20,bytes.length,true);cv.setUint32(24,declaredSize??bytes.length,true);cv.setUint16(28,nameBytes.length,true);central.set(nameBytes,46);
 const end=new Uint8Array(22);const ev=new DataView(end.buffer);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,1,true);ev.setUint16(10,1,true);ev.setUint32(12,central.length,true);ev.setUint32(16,local.length,true);
 return new File([local,central,end],'旧版.zip');
}
async function sourcePdf(){const pdf=await PDFDocument.create();for(let index=0;index<3;index++){const p=pdf.addPage([300+index*10,400+index*20]);p.drawRectangle({x:10,y:10,width:50,height:40,color:rgb(index/3,0,0)});}return new File([(await pdf.save()).buffer as ArrayBuffer],'合成凭证.pdf',{type:'application/pdf'});}

describe('ZIP 批量文件展开',()=>{
 it('保留普通文件与来源名',async()=>{const file=new File(['x'],'test.csv');const [row]=await expandImportFiles([file]);expect(row?.file).toBe(file);expect(row?.origin).toBe('test.csv');});
 it('UTF-8 中文路径与文件名正常读取',async()=>{const [row]=await expandImportFiles([await zipped({'资料/凭证.pdf':'%PDF-test'})]);expect(row?.file.name).toBe('凭证.pdf');expect(row?.origin).toContain('资料/凭证.pdf');expect(await row!.file.text()).toBe('%PDF-test');expect(row?.file.type).toBe('application/pdf');});
 it('GBK 中文文件名无 Unicode 扩展时也能读取',async()=>{const name=new Uint8Array([0xc6,0xbe,0xd6,0xa4,0x2e,0x70,0x64,0x66]);const [row]=await expandImportFiles([legacyZip(name)]);expect(row?.file.name).toBe('凭证.pdf');expect(await row!.file.text()).toBe('legacy');});
 it('忽略 Mac 元数据与隐藏文件，不影响正常条目',async()=>{const rows=await expandImportFiles([await zipped({'__MACOSX/._a.pdf':'x','.DS_Store':'x','资料/.hidden.pdf':'x','资料/a.pdf':'keep'})]);expect(rows).toHaveLength(1);expect(rows[0]!.file.name).toBe('a.pdf');});
 it.each(['../escape.pdf','folder/../../escape.pdf','/absolute.pdf','C:/absolute.pdf','folder\\..\\escape.pdf'])('拒绝越界或绝对路径 %s',async path=>{await expect(expandImportFiles([await zipped({[path]:'x'})])).rejects.toThrow('无效路径');});
 it('包含不支持的文件时拒绝整批，不返回之前有效条目',async()=>{await expect(expandImportFiles([await zipped({'first.pdf':'x','run.exe':'x'})])).rejects.toThrow('不支持');});
 it('空选择与空压缩包明确提示没有文件',async()=>{await expect(expandImportFiles([])).rejects.toThrow('没有可导入');await expect(expandImportFiles([await zipped({})])).rejects.toThrow('没有可导入');});
 it('无效 ZIP 返回中文错误',async()=>{await expect(expandImportFiles([new File(['not a zip'],'bad.zip')])).rejects.toThrow('压缩包无法读取');});
 it('单次选择超过 100 文件时拒绝',async()=>{await expect(expandImportFiles(Array.from({length:101},(_,i)=>new File(['x'],`${i}.csv`)))).rejects.toThrow('最多选择 100');});
 it('ZIP 内超过 100 文件时拒绝',async()=>{await expect(expandImportFiles([await zipped(Object.fromEntries(Array.from({length:101},(_,i)=>[`${i}.pdf`,'x'])))] )).rejects.toThrow('最多 100 个文件');});
 it('多个 ZIP 合计超过 100 文件时拒绝',async()=>{const entries=Object.fromEntries(Array.from({length:51},(_,i)=>[`${i}.pdf`,'x']));await expect(expandImportFiles([await zipped(entries,'a.zip'),await zipped(entries,'b.zip')])).rejects.toThrow('展开后一次最多导入 100');});
 it('压缩包超过 30 MB 时在读取前拒绝',async()=>{await expect(expandImportFiles([new File([new Uint8Array(30*1024*1024+1)],'large.zip')])).rejects.toThrow('不能超过 30 MB');});
 it('中央目录声明单文件超过 20 MB 时在解压前拒绝',async()=>{await expect(expandImportFiles([legacyZip(new TextEncoder().encode('large.pdf'),'x',20*1024*1024+1)])).rejects.toThrow('每文件最多 20 MB');});
});

describe('PDF 凭证续页和回单区域分拆',()=>{
 it('拒绝空来源页，避免生成空白凭证',async()=>{await expect(splitPdfFile(await sourcePdf(),[],'empty')).rejects.toThrow('不能为空');});
 it.each([NaN,Infinity,-Infinity])('拒绝非有限裁切坐标 %s',async x=>{await expect(splitPdfFile(await sourcePdf(),[1],'bad',{x,y:0,width:20,height:20})).rejects.toThrow('裁切范围无效');});
 it('按传入页序复制续页，文件名保留页号',async()=>{const file=await splitPdfFile(await sourcePdf(),[3,1],'记/7');const parsed=await PDFDocument.load(await file.arrayBuffer());expect(parsed.getPageCount()).toBe(2);expect(parsed.getPages().map(p=>p.getSize())).toEqual([{width:320,height:440},{width:300,height:400}]);expect(file.name).toBe('合成凭证_记_7_P3-1.pdf');expect(file.type).toBe('application/pdf');});
 it('裁切回单产生独立指定尺寸的影像页',async()=>{const file=await splitPdfFile(await sourcePdf(),[1],'回单',{x:20,y:40,width:200,height:150});const parsed=await PDFDocument.load(await file.arrayBuffer());expect(parsed.getPageCount()).toBe(1);expect(parsed.getPage(0).getSize()).toEqual({width:200,height:150});});
 it.each([0,4,1.5,-1])('拒绝无效来源页号 %s',async page=>{await expect(splitPdfFile(await sourcePdf(),[page],'bad')).rejects.toThrow('来源页号无效');});
 it.each([{x:-1,y:0,width:20,height:20},{x:0,y:-1,width:20,height:20},{x:0,y:0,width:0,height:20},{x:0,y:0,width:20,height:-1},{x:299,y:0,width:10,height:20},{x:0,y:399,width:20,height:10}])('拒绝越界或无效裁切区域 %#',async region=>{await expect(splitPdfFile(await sourcePdf(),[1],'bad',region)).rejects.toThrow('裁切范围无效');});
});

describe('批量展开的取消和总量限制',()=>{
 it('取消后整批不返回已展开文件，且进度按真实文件推进',async()=>{
  const control=new AbortController(),progress:number[]=[];
  const input=Array.from({length:3},(_,index)=>new File(['x'],`${index}.csv`));
  await expect(expandImportFiles(input,{signal:control.signal,onProgress:event=>{progress.push(event.completed);if(event.completed===1)control.abort();}})).rejects.toMatchObject({name:'AbortError'});
  expect(progress).toContain(1);expect(progress).not.toContain(2);
 });
 it('已经取消时不会开始读取ZIP',async()=>{
  const file=await zipped({'one.pdf':'x'}),read=vi.spyOn(file,'arrayBuffer'),control=new AbortController();control.abort();
  await expect(expandImportFiles([file],{signal:control.signal})).rejects.toMatchObject({name:'AbortError'});expect(read).not.toHaveBeenCalled();
 });
 it('普通多选文件也计入150MB总量，不能绕过压缩包限制',async()=>{
  const files=Array.from({length:8},(_,index)=>{const file=new File(['x'],`${index}.pdf`);Object.defineProperty(file,'size',{value:20*1024*1024});return file;});
  await expect(expandImportFiles(files)).rejects.toThrow('150 MB');
 });
});

describe('PDF批量拆分会话',()=>{
 it('同一原件多张分拆只读取和解析一次，输出页序及裁剪独立正确',async()=>{
  const file=await sourcePdf(),read=vi.spyOn(file,'arrayBuffer'),load=vi.spyOn(PDFDocument,'load');
  const session=await createPdfSplitSession(file);
  try{
   const first=await session.split([3,1],'续页'),second=await session.split([2],'回单',{x:10,y:10,width:100,height:150});
   expect(read).toHaveBeenCalledTimes(1);expect(load).toHaveBeenCalledTimes(1);
   const firstPdf=await PDFDocument.load(await first.arrayBuffer()),secondPdf=await PDFDocument.load(await second.arrayBuffer());
   expect(firstPdf.getPages().map(page=>page.getSize())).toEqual([{width:320,height:440},{width:300,height:400}]);
   expect(secondPdf.getPage(0).getSize()).toEqual({width:100,height:150});expect(first.name).toContain('_P3-1.pdf');
  }finally{session.dispose();load.mockRestore();}
 });
 it('释放会话后不能继续拆分，排队中的请求也不会产生文件',async()=>{
  const session=await createPdfSplitSession(await sourcePdf()),pending=session.split([1],'取消');session.dispose();
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
  await expect(session.split([2],'已释放')).rejects.toMatchObject({name:'AbortError'});
 });
 it('信号取消会中止尚未完成的请求，后续操作同样拒绝',async()=>{
  const control=new AbortController(),session=await createPdfSplitSession(await sourcePdf(),{signal:control.signal});
  const pending=session.split([1],'取消');control.abort();
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
  await expect(session.split([2],'取消后')).rejects.toMatchObject({name:'AbortError'});session.dispose();
 });
 it('预取消不读取源文件',async()=>{
  const file=await sourcePdf(),read=vi.spyOn(file,'arrayBuffer'),control=new AbortController();control.abort();
  await expect(createPdfSplitSession(file,{signal:control.signal})).rejects.toMatchObject({name:'AbortError'});expect(read).not.toHaveBeenCalled();
 });
 it('不支持Worker的启动环境回退仍生成真实PDF并只读取一次',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'Worker');Object.defineProperty(globalThis,'Worker',{configurable:true,value:class{constructor(){throw new Error('blocked');}}});
  try{
   const file=await sourcePdf(),read=vi.spyOn(file,'arrayBuffer'),session=await createPdfSplitSession(file);
   try{const result=await session.split([2],'fallback');expect((await PDFDocument.load(await result.arrayBuffer())).getPageCount()).toBe(1);expect(read).toHaveBeenCalledTimes(1);}finally{session.dispose();}
  }finally{if(descriptor)Object.defineProperty(globalThis,'Worker',descriptor);else Reflect.deleteProperty(globalThis,'Worker');}
 });
 it('Worker报告损坏原件时直接报错，不在主线程重复读取解析',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'Worker');let terminated=0;
  class FailedWorker{
   onmessage:((event:{data:unknown})=>void)|null=null;onerror:unknown;
   constructor(){queueMicrotask(()=>this.onmessage?.({data:{kind:'ready'}}));}
   postMessage(message:{id:number}){queueMicrotask(()=>this.onmessage?.({data:{kind:'error',id:message.id,message:'PDF已损坏'}}));}
   terminate(){terminated++;}
  }
  Object.defineProperty(globalThis,'Worker',{configurable:true,value:FailedWorker});const load=vi.spyOn(PDFDocument,'load');
  try{await expect(createPdfSplitSession(new File(['bad'],'损坏.pdf'))).rejects.toThrow('PDF已损坏');expect(load).not.toHaveBeenCalled();expect(terminated).toBe(1);}
  finally{load.mockRestore();if(descriptor)Object.defineProperty(globalThis,'Worker',descriptor);else Reflect.deleteProperty(globalThis,'Worker');}
 });
 it('取消正在等待Worker回复的任务会立即拒绝并终止worker',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'Worker');let terminated=0;
  class WaitingWorker{
   onmessage:((event:{data:unknown})=>void)|null=null;onerror:unknown;
   constructor(){queueMicrotask(()=>this.onmessage?.({data:{kind:'ready'}}));}
   postMessage(message:{kind:string;id:number}){if(message.kind==='load')queueMicrotask(()=>this.onmessage?.({data:{kind:'loaded',id:message.id}}));}
   terminate(){terminated++;}
  }
  Object.defineProperty(globalThis,'Worker',{configurable:true,value:WaitingWorker});
  try{
   const control=new AbortController(),session=await createPdfSplitSession(new File(['worker-data'],'worker.pdf'),{signal:control.signal});
   const first=session.split([1],'one'),second=session.split([2],'two');control.abort();
   await expect(first).rejects.toMatchObject({name:'AbortError'});await expect(second).rejects.toMatchObject({name:'AbortError'});expect(terminated).toBe(1);session.dispose();expect(terminated).toBe(1);
  }finally{if(descriptor)Object.defineProperty(globalThis,'Worker',descriptor);else Reflect.deleteProperty(globalThis,'Worker');}
 });
});

describe('跨文件复用批次拆分线程',()=>{
 it('50份不同原件只启动一个线程，各自解析一次且不会复制上一个文件的页面',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'Worker');
  const {loadPdfSplitter}=await import('../src/pdfSplitCore');
  let created=0,terminated=0,loads=0;
  class ReusedWorker{
   onmessage:((event:{data:unknown})=>void)|null=null;onerror:unknown;onmessageerror:unknown;
   current:Awaited<ReturnType<typeof loadPdfSplitter>>|undefined;queue=Promise.resolve();
   constructor(){created++;queueMicrotask(()=>this.onmessage?.({data:{kind:'ready'}}));}
   postMessage(message:import('../src/pdfSplitTypes').PdfSplitRequest){
    this.queue=this.queue.then(async()=>{
     try{
      if(message.kind==='load'){this.current=undefined;loads++;this.current=await loadPdfSplitter(message.bytes,message.name);this.onmessage?.({data:{kind:'loaded',id:message.id}});}
      else if(message.kind==='clear'){this.current=undefined;this.onmessage?.({data:{kind:'cleared',id:message.id}});}
      else{const bytes=await this.current!(message.sourcePages,message.region);this.onmessage?.({data:{kind:'result',id:message.id,bytes:bytes.buffer}});}
     }catch(error){this.onmessage?.({data:{kind:'error',id:message.id,message:String(error)}});}
    });
   }
   terminate(){terminated++;this.current=undefined;}
  }
  Object.defineProperty(globalThis,'Worker',{configurable:true,value:ReusedWorker});
  const batch=createPdfSplitBatch(),reads:ReturnType<typeof vi.spyOn>[]=[];
  try{
   for(let index=0;index<50;index++){
    const pdf=await PDFDocument.create();pdf.addPage([300+index,400+index]);
    const file=new File([(await pdf.save()).buffer as ArrayBuffer],`source-${index}.pdf`);reads.push(vi.spyOn(file,'arrayBuffer'));
    const session=await batch.open(file),result=await session.split([1],String(index));session.dispose();
    expect((await PDFDocument.load(await result.arrayBuffer())).getPage(0).getSize()).toEqual({width:300+index,height:400+index});
   }
   expect(created).toBe(1);expect(loads).toBe(50);expect(reads.every(read=>read.mock.calls.length===1)).toBe(true);expect(terminated).toBe(0);
  }finally{batch.dispose();expect(terminated).toBe(1);if(descriptor)Object.defineProperty(globalThis,'Worker',descriptor);else Reflect.deleteProperty(globalThis,'Worker');}
 });
 it('打开下一文件使旧会话失效，主线程回退也不会引用旧的PDF',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'Worker');Reflect.deleteProperty(globalThis,'Worker');
  const batch=createPdfSplitBatch();
  try{
   const first=await batch.open(await sourcePdf());
   const pdf=await PDFDocument.create();pdf.addPage([222,333]);const file=new File([(await pdf.save()).buffer as ArrayBuffer],'second.pdf');
   const second=await batch.open(file);
   await expect(first.split([1],'old')).rejects.toMatchObject({name:'AbortError'});
   expect((await PDFDocument.load(await(await second.split([1],'new')).arrayBuffer())).getPage(0).getSize()).toEqual({width:222,height:333});
   first.dispose();expect((await second.split([1],'still-active')).name).toContain('second');
  }finally{batch.dispose();if(descriptor)Object.defineProperty(globalThis,'Worker',descriptor);}
 });
 it('批次取消会终止唯一线程并立即拒绝正在处理的请求',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'Worker');let terminated=0;
  class WaitingWorker{
   onmessage:((event:{data:unknown})=>void)|null=null;onerror:unknown;onmessageerror:unknown;
   constructor(){queueMicrotask(()=>this.onmessage?.({data:{kind:'ready'}}));}
   postMessage(message:{kind:string;id:number}){if(message.kind==='load')queueMicrotask(()=>this.onmessage?.({data:{kind:'loaded',id:message.id}}));if(message.kind==='clear')queueMicrotask(()=>this.onmessage?.({data:{kind:'cleared',id:message.id}}));}
   terminate(){terminated++;}
  }
  Object.defineProperty(globalThis,'Worker',{configurable:true,value:WaitingWorker});
  const control=new AbortController(),batch=createPdfSplitBatch({signal:control.signal});
  try{
   const session=await batch.open(new File(['worker-data'],'pending.pdf'));
   const pending=session.split([1],'pending');control.abort();
   await expect(pending).rejects.toMatchObject({name:'AbortError'});
   await expect(batch.open(new File(['new'],'new.pdf'))).rejects.toMatchObject({name:'AbortError'});expect(terminated).toBe(1);
  }finally{batch.dispose();if(descriptor)Object.defineProperty(globalThis,'Worker',descriptor);else Reflect.deleteProperty(globalThis,'Worker');}
 });
 it('显式释放尚未启动完成的批次也会取消等待，不遗留后台线程',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'Worker');let terminated=0,started!:()=>void;const start=new Promise<void>(resolve=>{started=resolve;});
  class StartingWorker{onmessage:unknown;onerror:unknown;onmessageerror:unknown;constructor(){started();}postMessage(){}terminate(){terminated++;}}
  Object.defineProperty(globalThis,'Worker',{configurable:true,value:StartingWorker});const batch=createPdfSplitBatch();
  try{
   const pending=batch.open(new File(['worker-data'],'starting.pdf'));await start;batch.dispose();
   await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(terminated).toBe(1);
  }finally{batch.dispose();if(descriptor)Object.defineProperty(globalThis,'Worker',descriptor);else Reflect.deleteProperty(globalThis,'Worker');}
 });
});
