import type {PayerGroup} from './types';

export interface ArchiveDisplayGroup extends PayerGroup {
 sourceGroupIds:string[];
 associationKinds:('name'|'voucher')[];
}

const unknownPayers=new Set(['付款人未录入','请复核付款人','未录入付款人','未录入','未知','未知付款人','未识别付款人','已关联单据']);

/** Presentation only: callers validate original associations before combining their display. */
export function mergeArchiveDisplayGroups(groups:readonly PayerGroup[]):ArchiveDisplayGroup[]{
 const merged=new Map<string,ArchiveDisplayGroup>();
 for(const group of groups){
  const company=(group.payerName||'').normalize('NFKC').trim();
  const unidentified=group.needsPayerReview||!company||unknownPayers.has(company);
  const key=JSON.stringify([group.period,unidentified?['source',group.id]:['company',company]]);
  const kind=group.associationType==='name'?'name':'voucher';
  const existing=merged.get(key);
  if(!existing){
   merged.set(key,{...group,payerName:company,documentIds:[...new Set(group.documentIds)],voucherIds:[...new Set(group.voucherIds)],sourceGroupIds:[group.id],associationKinds:[kind]});
   continue;
  }
  existing.documentIds=[...new Set([...existing.documentIds,...group.documentIds])];
  existing.voucherIds=[...new Set([...existing.voucherIds,...group.voucherIds])];
  if(!existing.sourceGroupIds.includes(group.id))existing.sourceGroupIds.push(group.id);
  if(!existing.associationKinds.includes(kind))existing.associationKinds.push(kind);
  if(group.updatedAt>existing.updatedAt)existing.updatedAt=group.updatedAt;
 }
 return [...merged.values()];
}
