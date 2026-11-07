import type {PDFDocumentProxy,PDFWorker} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {loadFile} from './fileStorage';
import type {ArchiveRecord} from './types';

/** 一页真实原件；页码对应已保存文件，不能用重新排版的信息页替代。 */
export interface OriginalPreviewPage {
 key:string;
 label:string;
 recordIndex:number;
 record:ArchiveRecord;
 pageNumber:number;
 pageCount:number;
 source?:{kind:'pdf';pdf:PDFDocumentProxy}|{kind:'image';url:string};
 error?:string;
}

type LoadedOriginal={source:NonNullable<OriginalPreviewPage['source']>;pageCount:number}|{error:string};

/**
 * 只读取 IndexedDB 原件，按文件的真实页数展开。每次预览拥有自己的资源，
 * 关闭或切换档案后调用 dispose，释放 PDF worker 和图片临时 URL。
 */
export async function prepareOriginalPages(records:ArchiveRecord[],signal?:AbortSignal):Promise<{pages:OriginalPreviewPage[];dispose:()=>Promise<void>}> {
 const cache=new Map<string,Promise<LoadedOriginal>>();
 const releases:(()=>Promise<void>)[]=[];
 let disposed=false;
 let disposal:Promise<void>|undefined;
 let worker:PDFWorker|undefined;
 const abortError=()=>new DOMException('原件预览已取消','AbortError');
 const ensureActive=()=>{if(disposed||signal?.aborted)throw abortError();};
 const dispose=()=>{
  if(!disposal){
   disposed=true;
   signal?.removeEventListener('abort',onAbort);
   // 先结束各文档任务，再销毁会话共享线程，避免相邻文件争用一个正在销毁的 worker。
   disposal=Promise.allSettled(releases.map(release=>release())).then(()=>{worker?.destroy();worker=undefined;});
  }
  return disposal;
 };
 const onAbort=()=>{void dispose();};
 ensureActive();signal?.addEventListener('abort',onAbort,{once:true});
 const load=async(record:ArchiveRecord):Promise<LoadedOriginal>=>{
  ensureActive();
  if(!record.fileId)return {error:'未上传原始文件，请先上传对应的 PDF 或图片原件。'};
  try{
   const blob=await loadFile(record.fileId);
   ensureActive();
   if(!blob)return {error:'未找到本地原件，可能已被浏览器清理，请重新上传。'};
   const header=new Uint8Array(await blob.slice(0,8).arrayBuffer());
   ensureActive();
   const isPdf=String.fromCharCode(...header).startsWith('%PDF-');
   const isPng=header[0]===137&&header[1]===80&&header[2]===78&&header[3]===71;
   const isJpeg=header[0]===255&&header[1]===216&&header[2]===255;
   if(isPng||isJpeg){
    const url=URL.createObjectURL(blob);
    let released=false;
    releases.push(async()=>{if(!released){released=true;URL.revokeObjectURL(url);}});
    return {source:{kind:'image',url},pageCount:1};
   }
   if(!isPdf)return {error:'原件格式无法预览，请上传内容有效的 PDF、PNG 或 JPG 文件。'};
   const resourceBase=new URL(import.meta.env.BASE_URL,globalThis.location?.origin||'http://localhost');
   const data=new Uint8Array(await blob.arrayBuffer());ensureActive();
   // getDocument 默认会为每个文件启动独立线程。几十份原件共用本会话的一个线程，
   // 元数据顺序读取，画布只在当前跨页附近绘制，避免同时驻留几十个 PDF worker。
   const runtime=await import('pdfjs-dist');ensureActive();
   runtime.GlobalWorkerOptions.workerSrc=workerUrl;
   worker??=new runtime.PDFWorker();
   const task=runtime.getDocument({data,worker,isEvalSupported:false,useSystemFonts:true,cMapUrl:new URL('pdfjs/cmaps/',resourceBase).href,cMapPacked:true,standardFontDataUrl:new URL('pdfjs/standard_fonts/',resourceBase).href});
   let released=false;
   const release=async()=>{if(!released){released=true;await task.destroy();}};
   releases.push(release);
   try{
    const pdf=await task.promise;
    ensureActive();
    if(pdf.numPages<1||pdf.numPages>500)throw new Error('单个 PDF 最多预览 500 页，请先拆分文件。');
    return {source:{kind:'pdf',pdf},pageCount:pdf.numPages};
   }catch(error){
    await release().catch(()=>undefined);
    ensureActive();
    const message=error instanceof Error&&error.message.includes('500 页')?error.message:'PDF 无法读取，请检查原件是否加密或损坏后重新上传。';
    return {error:message};
   }
  }catch{ensureActive();return {error:'读取本地原件失败，请检查浏览器存储权限后重新打开。'};}
 };
 const pages:OriginalPreviewPage[]=[];
 try{
  for(const [recordIndex,record] of records.entries()){
   ensureActive();
   // 同一原件在证据链中出现多次时只读取一次，不重复创建 worker 或 URL。
   const cacheKey=record.fileId||`missing:${recordIndex}`;
   let request=cache.get(cacheKey);
   if(!request){request=load(record);cache.set(cacheKey,request);}
   const loaded=await request;
   ensureActive();
   const name=record.fileName||record.summary||record.no||'原始单据';
   const pageCount='error' in loaded?1:loaded.pageCount;
   for(let pageNumber=1;pageNumber<=pageCount;pageNumber++){
    pages.push({key:`${recordIndex}:${record.fileId||'missing'}:${pageNumber}`,label:pageCount>1?`${name} · ${pageNumber}/${pageCount}`:name,recordIndex,record,pageNumber,pageCount,...('error' in loaded?{error:loaded.error}:{source:loaded.source})});
   }
   // 缓存命中的多页记录也会经过此处；每几份文件让浏览器处理输入和界面更新。
   if((recordIndex+1)%4===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  ensureActive();
  return {pages,dispose};
 }catch(error){await dispose();throw error;}
}
