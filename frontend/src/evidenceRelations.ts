import {amountCents} from './money';
import type {EntryAttachment,SourceDocument,Voucher} from './types';

/** 合同与审批资料证明业务背景，可被多张凭证引用，不能像发票、回单一样消耗金额。 */
export function isReferenceDocument(document:SourceDocument):boolean {
 return document.type==='contract'||document.type==='approval';
}

export function centsToAmount(cents:number):string {
 if(!Number.isSafeInteger(cents))throw new Error('分摊金额超出可精确处理范围');
 const sign=cents<0?'-':'';
 const absolute=Math.abs(cents);
 return `${sign}${Math.floor(absolute/100)}.${String(absolute%100).padStart(2,'0')}`;
}

/** 旧关联没有 allocatedAmount，语义固定为整单消耗；共享资料始终为 0。 */
export function attachmentAmountCents(link:EntryAttachment,document:SourceDocument):number {
 if(isReferenceDocument(document)||link.relationType==='reference')return 0;
 return link.allocatedAmount===undefined?amountCents(document.amount):amountCents(link.allocatedAmount);
}

export interface DocumentRelation {voucher:Voucher;link?:EntryAttachment}

export function documentRelations(documentId:string,vouchers:Voucher[]):DocumentRelation[] {
 const relations:DocumentRelation[]=[];
 for(const voucher of vouchers){
  let entryLinked=false;
  for(const link of voucher.entryAttachments||[])if(link.documentId===documentId){
   relations.push({voucher,link});entryLinked=true;
  }
  // 同一凭证可以同时具有分录回单和整凭证发票。仅在前者未命中时补充
  // 整凭证关系，既避免重复计算，也防止发票被误判为未使用后再次认领。
  if(!entryLinked&&voucher.documentIds.includes(documentId))relations.push({voucher});
 }
 return relations;
}

export function documentAllocatedCents(document:SourceDocument,vouchers:Voucher[],excludeVoucherId?:string):number {
 if(isReferenceDocument(document))return 0;
 return documentRelations(document.id,vouchers).reduce((total,{voucher,link})=>{
  if(voucher.id===excludeVoucherId)return total;
  return total+(link?attachmentAmountCents(link,document):amountCents(document.amount));
 },0);
}

export function documentRemainingCents(document:SourceDocument,vouchers:Voucher[],excludeVoucherId?:string):number {
 if(isReferenceDocument(document))return amountCents(document.amount);
 return amountCents(document.amount)-documentAllocatedCents(document,vouchers,excludeVoucherId);
}

export function entryAllocatedCents(voucher:Voucher,entryIndex:number,documents:SourceDocument[],links:EntryAttachment[]=voucher.entryAttachments||[]):number {
 const byId=new Map(documents.map(document=>[document.id,document]));
 return links.filter(link=>link.entryIndex===entryIndex).reduce((total,link)=>{
  const document=byId.get(link.documentId);
  return document?total+attachmentAmountCents(link,document):total;
 },0);
}

export function hasDocumentRelation(documentId:string,vouchers:Voucher[]):boolean {
 return documentRelations(documentId,vouchers).length>0;
}
