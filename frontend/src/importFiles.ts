import JSZip from 'jszip';
import {checkImportAbort,yieldImportTurn} from './importScheduling';
import type {PdfRegion,PdfSplitRequest,PdfSplitResponse} from './pdfSplitTypes';
export type {PdfRegion} from './pdfSplitTypes';
export interface ImportFile {file:File;origin:string}
export interface ImportExpansionProgress {completed:number;total:number;name:string}
export interface ImportExpansionOptions {signal?:AbortSignal;onProgress?:(progress:ImportExpansionProgress)=>void}
export interface PdfSplitSession {split:(sourcePages:number[],label:string,region?:PdfRegion)=>Promise<File>;dispose:()=>void}
const importAbort=()=>new DOMException('本次文件读取已取消','AbortError');
/** GBK 文件名兼容旧版 Windows 压缩包；禁止越界路径与过大的解压结果。 */
export async function expandImportFiles(files:File[],options:ImportExpansionOptions={}):Promise<ImportFile[]> {
 checkImportAbort(options.signal);
 if(files.length>100)throw new Error('一次最多选择 100 个文件');
 const result:ImportFile[]=[];let expandedBytes=0,total=files.length;
 const report=(name:string)=>options.onProgress?.({completed:result.length,total,name});
 for(const file of files){
  await yieldImportTurn(options.signal);report(file.name);
  if(!/\.zip$/i.test(file.name)){
   expandedBytes+=file.size;
   if(expandedBytes>150*1024*1024)throw new Error('文件合计不能超过 150 MB，请分批选择');
   result.push({file,origin:file.name});report(file.name);continue;
  }
  if(file.size>30*1024*1024)throw new Error(`${file.name}：压缩包不能超过 30 MB`);
  let zip:JSZip;
  try{zip=await JSZip.loadAsync(file,{decodeFileName:bytes=>new TextDecoder('gb18030').decode(new Uint8Array(bytes))});}
  catch{checkImportAbort(options.signal);throw new Error(`${file.name}：压缩包无法读取，请检查文件是否损坏或加密`);}
  checkImportAbort(options.signal);
  const entries=Object.values(zip.files).filter(entry=>!entry.dir&&!/(^|\/)(__MACOSX|\.[^/]+)(\/|$)/.test(entry.name));
  if(entries.length>100)throw new Error(`${file.name}：单个压缩包最多 100 个文件`);
  total+=entries.length-1;
  if(total>100)throw new Error('展开后一次最多导入 100 个文件');
  for(const entry of entries){
   await yieldImportTurn(options.signal);report(`${file.name} / ${entry.name}`);
   const unsafe=(entry as typeof entry&{unsafeOriginalName?:string}).unsafeOriginalName||entry.name;
   if(unsafe.replace(/\\/g,'/').split('/').includes('..')||/^(?:\/|[A-Za-z]:)/.test(unsafe))throw new Error(`${file.name}：压缩包包含无效路径`);
   if(!/\.(pdf|png|jpe?g|json|csv)$/i.test(entry.name))throw new Error(`${file.name}：包含不支持的文件 ${entry.name}，请使用 PDF、图片、JSON 或 CSV`);
   // 先读取中央目录中的未压缩大小，避免把已知超限文件解压入内存。
   const declared=(entry as typeof entry&{_data?:{uncompressedSize?:number}})._data?.uncompressedSize;
   if(declared!==undefined&&(declared>20*1024*1024||expandedBytes+declared>150*1024*1024))throw new Error('压缩包展开后过大：每文件最多 20 MB，合计最多 150 MB');
   const data=await entry.async('uint8array');checkImportAbort(options.signal);expandedBytes+=data.byteLength;
   if(data.byteLength>20*1024*1024||expandedBytes>150*1024*1024)throw new Error('压缩包展开后过大：每文件最多 20 MB，合计最多 150 MB');
   const name=entry.name.split('/').pop()!;
   const type=/\.pdf$/i.test(name)?'application/pdf':/\.png$/i.test(name)?'image/png':/\.jpe?g$/i.test(name)?'image/jpeg':'application/octet-stream';
   result.push({file:new File([data.buffer as ArrayBuffer],name,{type}),origin:`${file.name} / ${entry.name}`});report(`${file.name} / ${entry.name}`);
  }
 }
 if(result.length>100)throw new Error('展开后一次最多导入 100 个文件');
 if(!result.length)throw new Error('压缩包中没有可导入的文件');
 return result;
}
/** 仅启动环境不支持 Worker 时回退；原件损坏等业务错误不能再次尝试后被掩盖。 */
class WorkerUnavailableError extends Error {}
interface SplitBackend {
 load:(bytes:ArrayBuffer,name:string,signal?:AbortSignal)=>Promise<void>;
 split:(sourcePages:number[],region?:PdfRegion,signal?:AbortSignal)=>Promise<ArrayBuffer>;
 clear:()=>Promise<void>;
 dispose:()=>void;
}
type RequestPayload=PdfSplitRequest extends infer Request?Request extends {id:number}?Omit<Request,'id'>:never:never;

/** 一个批次拥有一个线程。只有收到 ready 后才转移文件数据，启动回退不会读取已分离的缓冲区。 */
async function workerBackend(signal?:AbortSignal):Promise<SplitBackend>{
 let worker:Worker;
 try{worker=new Worker(new URL('./pdfSplit.worker.ts',import.meta.url),{type:'module',name:'archive-pdf-split'});}
 catch{throw new WorkerUnavailableError('当前环境无法启动文件处理任务');}
 let disposed=false,readyState=false,sequence=0,terminal:Error=importAbort();
 const pending=new Map<number,{resolve:(response:PdfSplitResponse)=>void;reject:(error:Error)=>void;cleanup:()=>void}>();
 let readyResolve!:()=>void,readyReject!:(error:Error)=>void;
 const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 void ready.catch(()=>undefined);
 const dispose=(error:Error=importAbort())=>{
  if(disposed)return;disposed=true;terminal=error;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);
  worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();readyReject(error);
  for(const request of pending.values()){request.cleanup();request.reject(error);}pending.clear();
 };
 const onAbort=()=>dispose();
 const timer=setTimeout(()=>dispose(new WorkerUnavailableError('文件处理任务启动超时')),15000);
 worker.onmessage=event=>{
  const response=event.data as PdfSplitResponse;
  if(response.kind==='ready'){readyState=true;clearTimeout(timer);readyResolve();return;}
  const request=pending.get(response.id);if(!request)return;pending.delete(response.id);request.cleanup();
  if(response.kind==='error')request.reject(new Error(response.message));else request.resolve(response);
 };
 worker.onerror=event=>{event.preventDefault();dispose(readyState?new Error('文件处理失败，请重新选择'):new WorkerUnavailableError('当前环境无法加载文件处理任务'));};
 worker.onmessageerror=()=>dispose(new Error('文件处理结果无法读取，请重新选择'));
 signal?.addEventListener('abort',onAbort,{once:true});
 const request=(message:RequestPayload,transfer:Transferable[]=[],requestSignal?:AbortSignal):Promise<PdfSplitResponse>=>{
  if(disposed)return Promise.reject(terminal);
  if(signal?.aborted||requestSignal?.aborted)return Promise.reject(importAbort());
  const id=++sequence;
  return new Promise((resolve,reject)=>{
   const onRequestAbort=()=>{const item=pending.get(id);if(item){pending.delete(id);item.cleanup();reject(importAbort());}};
   const cleanup=()=>requestSignal?.removeEventListener('abort',onRequestAbort);
   pending.set(id,{resolve,reject,cleanup});requestSignal?.addEventListener('abort',onRequestAbort,{once:true});
   try{worker.postMessage({...message,id},transfer);}catch(error){pending.delete(id);cleanup();reject(error);}
  });
 };
 try{
  checkImportAbort(signal);await ready;checkImportAbort(signal);
  return {
   load:async(bytes,name,requestSignal)=>{const response=await request({kind:'load',name,bytes},[bytes],requestSignal);if(response.kind!=='loaded')throw new Error(`${name}：文件准备结果无效`);},
   split:async(sourcePages,region,requestSignal)=>{const response=await request({kind:'split',sourcePages,region},[],requestSignal);if(response.kind!=='result')throw new Error('文件拆分结果无效');return response.bytes;},
   clear:async()=>{await request({kind:'clear'});},
   dispose:()=>dispose(),
  };
 }catch(error){dispose();throw error;}
}

/** 不支持后台任务时仍按同一顺序处理，并在每项之间给页面一次响应机会。 */
function fallbackBackend(signal?:AbortSignal):SplitBackend{
 let split:Awaited<ReturnType<typeof import('./pdfSplitCore')['loadPdfSplitter']>>|undefined;
 let disposed=false,queue=Promise.resolve();
 const ensureActive=(requestSignal?:AbortSignal)=>{checkImportAbort(signal);checkImportAbort(requestSignal);if(disposed)throw importAbort();};
 const dispose=()=>{disposed=true;split=undefined;signal?.removeEventListener('abort',dispose);};
 signal?.addEventListener('abort',dispose,{once:true});
 const enqueue=<T>(operation:()=>Promise<T>):Promise<T>=>{const result=queue.then(operation);queue=result.then(()=>undefined,()=>undefined);return result;};
 return {
  load:(bytes,name,requestSignal)=>enqueue(async()=>{
   ensureActive(requestSignal);split=undefined;await yieldImportTurn(requestSignal);ensureActive(requestSignal);
   const {loadPdfSplitter}=await import('./pdfSplitCore');ensureActive(requestSignal);
   const loaded=await loadPdfSplitter(bytes,name);ensureActive(requestSignal);split=loaded;
  }),
  split:(sourcePages,region,requestSignal)=>enqueue(async()=>{
   ensureActive(requestSignal);await yieldImportTurn(requestSignal);ensureActive(requestSignal);
   if(!split)throw new Error('原始 PDF 尚未准备完成');
   const data=await split(sourcePages,region);ensureActive(requestSignal);return data.buffer as ArrayBuffer;
  }),
  clear:()=>enqueue(async()=>{split=undefined;}),
  dispose,
 };
}

export interface PdfSplitBatch {open:(file:File)=>Promise<PdfSplitSession>;dispose:()=>void}
/**
 * 批次内跨文件共用一个拆分线程，只保留当前源 PDF。
 * 新文件会使旧会话失效；文件处理完成清理源数据，整个批次结束才销毁线程。
 */
export function createPdfSplitBatch(options:{signal?:AbortSignal}={}):PdfSplitBatch{
 const {signal}=options;checkImportAbort(signal);
 const batchController=new AbortController();
 let disposed=false,backend:SplitBackend|undefined,backendPromise:Promise<SplitBackend>|undefined;
 let current:{controller:AbortController;generation:number}|undefined,generation=0;
 const ensureActive=()=>{checkImportAbort(signal);if(disposed)throw importAbort();};
 const releaseCurrent=()=>{
  if(!current)return;
  current.controller.abort();current=undefined;
  // clear 和下一次 load 在 worker 队列中顺序执行，旧解析数据不会被误用到新文件。
  if(backend)void backend.clear().catch(()=>undefined);
 };
 const dispose=()=>{
  if(disposed)return;disposed=true;current?.controller.abort();current=undefined;
  signal?.removeEventListener('abort',dispose);batchController.abort();backend?.dispose();
 };
 signal?.addEventListener('abort',dispose,{once:true});
 const getBackend=()=>backendPromise??=(async()=>{
  let loaded:SplitBackend;
  try{loaded=typeof Worker==='undefined'?fallbackBackend(batchController.signal):await workerBackend(batchController.signal);}
  catch(error){ensureActive();if(!(error instanceof WorkerUnavailableError))throw error;loaded=fallbackBackend(batchController.signal);}
  if(disposed||signal?.aborted){loaded.dispose();throw importAbort();}
  backend=loaded;return loaded;
 })();
 return {
  async open(file){
   ensureActive();releaseCurrent();
   const active={controller:new AbortController(),generation:++generation};current=active;
   const ensureSession=()=>{ensureActive();checkImportAbort(active.controller.signal);if(current!==active)throw importAbort();};
   try{
    const bytes=await file.arrayBuffer();ensureSession();
    const engine=await getBackend();ensureSession();
    await engine.load(bytes,file.name,active.controller.signal);ensureSession();
    return {
     async split(sourcePages,label,region){
      ensureSession();const data=await engine.split(sourcePages,region,active.controller.signal);ensureSession();
      const name=`${file.name.replace(/\.pdf$/i,'')}_${label.replace(/[\\/:*?"<>|]/g,'_')}_P${sourcePages.join('-')}.pdf`;
      return new File([data],name,{type:'application/pdf'});
     },
     dispose:()=>{if(current===active)releaseCurrent();else active.controller.abort();},
    };
   }catch(error){if(current===active)releaseCurrent();throw error;}
  },
  dispose,
 };
}

/** 单次调用独占一个短期批次，释放会话时同时结束其后台线程，兼容旧调用方式。 */
export async function createPdfSplitSession(file:File,options:{signal?:AbortSignal}={}):Promise<PdfSplitSession>{
 const batch=createPdfSplitBatch(options);
 try{const session=await batch.open(file);return {split:session.split,dispose:()=>{session.dispose();batch.dispose();}};}
 catch(error){batch.dispose();throw error;}
}

/** 兼容单次调用；批量场景复用 createPdfSplitBatch，避免逐文件重新启动解析线程。 */
export async function splitPdfFile(file:File,sourcePages:number[],label:string,region?:PdfRegion):Promise<File>{
 const session=await createPdfSplitSession(file);
 try{return await session.split(sourcePages,label,region);}finally{session.dispose();}
}
