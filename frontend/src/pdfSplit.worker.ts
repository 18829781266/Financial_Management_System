import {loadPdfSplitter} from './pdfSplitCore';
import type {PdfSplitRequest,PdfSplitResponse} from './pdfSplitTypes';

const scope=globalThis as unknown as {onmessage:((event:MessageEvent<PdfSplitRequest>)=>void)|null;postMessage:(message:PdfSplitResponse,transfer?:Transferable[])=>void};
let split:Awaited<ReturnType<typeof loadPdfSplitter>>|undefined;
let queue=Promise.resolve();
// 逐项处理，不为同一源 PDF 同时创建几十个输出文档，控制内存峰值。
scope.onmessage=event=>{
 const request=event.data;
 queue=queue.then(async()=>{
  try{
   if(request.kind==='load'){
    split=undefined;
    split=await loadPdfSplitter(request.bytes,request.name);
    scope.postMessage({kind:'loaded',id:request.id});
   }else if(request.kind==='clear'){
    split=undefined;scope.postMessage({kind:'cleared',id:request.id});
   }else{
    if(!split)throw new Error('原始 PDF 尚未准备完成');
    const bytes=await split(request.sourcePages,request.region),buffer=bytes.buffer as ArrayBuffer;
    scope.postMessage({kind:'result',id:request.id,bytes:buffer},[buffer]);
   }
  }catch(error){scope.postMessage({kind:'error',id:request.id,message:error instanceof Error?error.message:'PDF 拆分失败，请检查原件'});}
 });
};
scope.postMessage({kind:'ready'});
