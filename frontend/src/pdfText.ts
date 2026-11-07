import { getDocument, GlobalWorkerOptions, PDFWorker } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {checkImportAbort,yieldImportTurn} from './importScheduling';

GlobalWorkerOptions.workerSrc = workerUrl;
export interface PdfTextItem {text:string;x:number;y:number;width:number;height:number}
export interface PdfTextPage {pageNumber:number;width:number;height:number;items:PdfTextItem[];text:string}
export interface PdfTextOptions {signal?:AbortSignal;worker?:PDFWorker;onProgress?:(completed:number,total:number)=>void}

/** 读取已有的 PDF 文字层；这不是 OCR。没有文字层时由界面要求补录，不生成虚构字段。 */
export async function readPdfText(file:File,options:PdfTextOptions={}):Promise<PdfTextPage[]> {
 const {signal,worker,onProgress}=options;
 checkImportAbort(signal);
 const data=new Uint8Array(await file.arrayBuffer());
 checkImportAbort(signal);
 const resourceBase=new URL(import.meta.env.BASE_URL,globalThis.location.origin);
 const task=getDocument({data,worker,isEvalSupported:false,useSystemFonts:true,cMapUrl:new URL('pdfjs/cmaps/',resourceBase).href,cMapPacked:true,standardFontDataUrl:new URL('pdfjs/standard_fonts/',resourceBase).href});
 let destruction:Promise<void>|undefined;
 const release=()=>destruction??=(task.destroy().catch(()=>undefined));
 const onAbort=()=>{void release();};
 signal?.addEventListener('abort',onAbort,{once:true});
 try{
  const pdf=await task.promise;
  checkImportAbort(signal);
  if(pdf.numPages>500)throw new Error('单个 PDF 最多支持 500 页，请先拆分文件');
  const pages:PdfTextPage[]=[];
  onProgress?.(0,pdf.numPages);
  for(let index=1;index<=pdf.numPages;index++){
   checkImportAbort(signal);
   const page=await pdf.getPage(index);
   try{
    const content=await page.getTextContent();
    checkImportAbort(signal);
    const items:PdfTextItem[]=content.items.flatMap(item=>'str' in item&&item.str.trim()?[{text:item.str,x:item.transform[4],y:item.transform[5],width:item.width,height:item.height}]:[]);
    pages.push({pageNumber:index,width:page.view[2]-page.view[0],height:page.view[3]-page.view[1],items,text:items.map(item=>item.text).join('\n')});
    onProgress?.(index,pdf.numPages);
   }finally{page.cleanup();}
   // PDF.js 在 worker 中抽取文字；任务间再让出主线程，长文件也能点击取消及刷新进度。
   await yieldImportTurn(signal);
  }
  return pages;
 }catch(error){
  checkImportAbort(signal);
  throw new Error(`${file.name}：${error instanceof Error?error.message:'PDF 无法读取，请检查是否加密或损坏'}`);
 }finally{
  signal?.removeEventListener('abort',onAbort);
  await release();
 }
}

/** 一批文件共用一个文字读取 worker，文档逐个关闭；批次结束不残留后台线程。 */
export function createPdfTextReader(options:{signal?:AbortSignal}={}) {
 checkImportAbort(options.signal);
 const worker=new PDFWorker();
 const readerController=new AbortController();
 let disposed=false,destroyed=false,activeReads=0;
 const releaseWorker=()=>{if(disposed&&!activeReads&&!destroyed){destroyed=true;worker.destroy();}};
 const dispose=()=>{
  disposed=true;readerController.abort();
  options.signal?.removeEventListener('abort',dispose);
  // 必须先让当前文档的destroy完成通信清理，再结束共享线程。
  // 抢先终止worker会让PDF.js正在等待的文字流和task.destroy永远无法完成。
  releaseWorker();
 };
 options.signal?.addEventListener('abort',dispose,{once:true});
 return {
  async read(file:File,onProgress?:PdfTextOptions['onProgress']):Promise<PdfTextPage[]>{
   checkImportAbort(options.signal);
   if(disposed)throw new DOMException('本次文件读取已取消','AbortError');
   activeReads++;
   try{return await readPdfText(file,{signal:readerController.signal,worker,onProgress});}
   finally{activeReads--;releaseWorker();}
  },
  dispose,
 };
}
