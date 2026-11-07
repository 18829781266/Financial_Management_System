import {PDFDocument} from 'pdf-lib';
import type {PdfRegion} from './pdfSplitTypes';

/** 一个源文件只解析一次；复制各张凭证时复用只读源，输出仍为独立 PDF。 */
export async function loadPdfSplitter(bytes:ArrayBuffer,name:string){
 const original=await PDFDocument.load(bytes);
 return async(sourcePages:number[],region?:PdfRegion):Promise<Uint8Array>=>{
  if(!sourcePages.length)throw new Error(`${name}：来源页号不能为空`);
  if(region&&!Object.values(region).every(Number.isFinite))throw new Error(`${name}：单据裁切范围无效`);
  const output=await PDFDocument.create();
  for(const pageNo of sourcePages){
   if(!Number.isInteger(pageNo)||pageNo<1||pageNo>original.getPageCount())throw new Error(`${name}：来源页号无效`);
   if(region){
    const page=original.getPage(pageNo-1),bounds={left:region.x,bottom:region.y,right:region.x+region.width,top:region.y+region.height};
    if(region.width<=0||region.height<=0||bounds.left<0||bounds.bottom<0||bounds.right>page.getWidth()+1||bounds.top>page.getHeight()+1)throw new Error(`${name}：单据裁切范围无效`);
    const embedded=await output.embedPage(page,bounds),target=output.addPage([region.width,region.height]);
    target.drawPage(embedded,{x:0,y:0});
   }else{const [page]=await output.copyPages(original,[pageNo-1]);output.addPage(page!);}
  }
  return output.save();
 };
}
