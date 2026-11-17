import type {GenerateArchiveRequest,SourceDocument,Voucher} from './types';

export interface ArchivePreparation {
 pendingDocuments:{document:SourceDocument;voucherNos:string[]}[];
 noAttachmentVouchers:Voucher[];
 missingVouchers:Voucher[];
 exemptVouchers:Voucher[];
}

const compare=(left:string,right:string)=>left.localeCompare(right,'zh-CN',{numeric:true});
const empty=():ArchivePreparation=>({pendingDocuments:[],noAttachmentVouchers:[],missingVouchers:[],exemptVouchers:[]});

/** Presentation only: expose the selected records that still need an explicit review action. */
export function getArchivePreparation(
 request:GenerateArchiveRequest,vouchers:readonly Voucher[],documents:readonly SourceDocument[],
):ArchivePreparation{
 const result=empty();
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(request.period)||!request.startVoucherNo.trim()||!request.endVoucherNo.trim()||compare(request.startVoucherNo,request.endVoucherNo)>0)return result;
 const selected=vouchers.filter(voucher=>voucher.period===request.period&&compare(voucher.no,request.startVoucherNo)>=0&&compare(voucher.no,request.endVoucherNo)<=0).sort((left,right)=>compare(left.no,right.no));
 if(!selected.some(voucher=>voucher.no===request.startVoucherNo)||!selected.some(voucher=>voucher.no===request.endVoucherNo))return result;
 const documentById=new Map(documents.map(document=>[document.id,document]));
 const pendingById=new Map<string,ArchivePreparation['pendingDocuments'][number]>();
 for(const voucher of selected){
  if(voucher.status==='missing'||voucher.documentIds.some(id=>!documentById.has(id)))result.missingVouchers.push(voucher);
  if(!voucher.documentIds.length){
   if(voucher.status!=='missing'&&!voucher.noAttachmentRequired)result.noAttachmentVouchers.push(voucher);
   if(voucher.status==='matched'&&voucher.noAttachmentRequired&&voucher.attachmentExemptionReason?.trim())result.exemptVouchers.push(voucher);
  }
  for(const id of voucher.documentIds){
   const document=documentById.get(id);
   if(document?.extractionStatus!=='pending')continue;
   const existing=pendingById.get(id);
   if(existing){if(!existing.voucherNos.includes(voucher.no))existing.voucherNos.push(voucher.no);}
   else pendingById.set(id,{document,voucherNos:[voucher.no]});
  }
 }
 result.pendingDocuments=[...pendingById.values()];
 return result;
}
