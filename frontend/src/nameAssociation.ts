import {normalizeSupplier,supplierSimilarity} from './matchUtils';
import type {ArchiveState,MatchRule,NameAssociation,PayerGroup,SourceDocument,Voucher} from './types';

export const nameAssociationRule=():MatchRule=>({id:'R08',name:'付款 / 收款企业名称关联',description:'按期间关联付款人或收款人相同的原始单据，并关联对应单位的凭证；没有凭证时仍可展示已关联原件',priority:8,enabled:true,threshold:100,tolerance:0,dateWindow:0,matchType:'fuzzy',conditions:{associationScope:'party',partyField:'either',documentTypes:['invoice','bank','contract','approval'],requireAmount:false,requireDate:false}});
function names(doc:SourceDocument,field:'payerName'|'payeeName'|'either'|undefined):string[]{
 const payer=doc.payerName??doc.supplier;
 return [...new Set((field==='payerName'?[payer]:field==='payeeName'?[doc.payeeName||'']:[payer,doc.payeeName||'']).map(name=>name.trim()).filter(name=>normalizeSupplier(name).length>=2))];
}
const voucherName=(voucher:Voucher,basis:NameAssociation['basis'])=>basis==='company'?voucher.company?.trim()||'':voucher.supplier.trim();
function validDate(value:string):boolean{const time=Date.parse(value+'T00:00:00Z');return /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(value)&&Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;}
/** 名称关联组织同一企业的证据，不分配金额，也不把一份单据重复绑定给多张凭证。 */
export function evaluateNameAssociations(vouchers:Voucher[],documents:SourceDocument[],rules:MatchRule[],time:string):NameAssociation[]{
 const groups=new Map<string,NameAssociation>(),used=new Set<string>(),ambiguous=new Set<string>();
 const candidates=vouchers.filter(voucher=>voucher.status!=='missing');
 for(const rule of [...rules].filter(rule=>rule.enabled&&rule.conditions?.associationScope==='party').sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id))){
  if(!Number.isFinite(rule.threshold)||rule.threshold<0||rule.threshold>100||rule.conditions?.requireAmount!==false||rule.conditions?.requireDate!==false)continue;
  const types=rule.conditions?.documentTypes||['invoice','bank','contract','approval'];
  for(const doc of documents){
   if(used.has(doc.id)||!types.includes(doc.type)||!validDate(doc.date))continue;
   const period=doc.date.slice(0,7),parties=names(doc,rule.conditions?.partyField);
   if(!parties.length)continue;
   for(const basis of ['company','counterparty'] as const){
    const hits=new Map<string,{name:string;score:number;voucherIds:string[]}>();
    for(const voucher of candidates.filter(voucher=>voucher.period===period)){
     const name=voucherName(voucher,basis),key=normalizeSupplier(name);if(key.length<2)continue;
     const score=Math.max(...parties.map(party=>rule.matchType==='exact'?(party===name?100:0):supplierSimilarity(party,name)));
     if(score<rule.threshold)continue;
     const hit=hits.get(key);if(hit){hit.voucherIds.push(voucher.id);hit.score=Math.min(hit.score,score);}else hits.set(key,{name,score,voucherIds:[voucher.id]});
    }
    if(!hits.size)continue;
    // 同一回单同时命中两个核算单位时，不能随意挑选一方，也不退回更弱的往来名称。
    if(hits.size!==1){ambiguous.add(doc.id);break;}
    const [key,hit]=[...hits.entries()][0]!;
    const id=`name:${rule.id}:${period}:${basis}:${key}`;
    let group=groups.get(id);
    if(!group){group={id,period,payerName:hit.name,documentIds:[],voucherIds:[],updatedAt:time,associationType:'name',ruleId:rule.id,confidence:hit.score,basis,partyField:rule.conditions?.partyField||'either',documentTypes:[...types]};groups.set(id,group);}
    group.documentIds.push(doc.id);group.voucherIds=[...new Set([...group.voucherIds,...hit.voucherIds])];group.confidence=Math.min(group.confidence,hit.score);used.add(doc.id);break;
   }
  }
  // 原始单据可以先相互关联，不能把“没有同期间凭证”误报成名称关联成功却不入档。
  // 至少两份原件共享同一主体才成立；只围绕一个共同名称归集，不沿交易对手传递合并。
  const remaining=documents.filter(doc=>!used.has(doc.id)&&!ambiguous.has(doc.id)&&doc.status!=='matched'&&types.includes(doc.type)&&validDate(doc.date));
  const anchors=new Map<string,{name:string;period:string;ids:Set<string>}>();
  for(const doc of remaining)for(const name of names(doc,rule.conditions?.partyField)){
   const period=doc.date.slice(0,7),key=`${period}/${rule.matchType==='exact'?name:normalizeSupplier(name)}`;
   if(!anchors.has(key))anchors.set(key,{name,period,ids:new Set()});
  }
  for(const anchor of anchors.values())for(const doc of remaining){
   if(!doc.date.startsWith(anchor.period))continue;
   if(names(doc,rule.conditions?.partyField).some(name=>(rule.matchType==='exact'?(name===anchor.name?100:0):supplierSimilarity(name,anchor.name))>=rule.threshold))anchor.ids.add(doc.id);
  }
  const choices=new Map<string,string>();
  for(const doc of remaining){
   const hits=[...anchors.entries()].filter(([,anchor])=>anchor.ids.size>=2&&anchor.ids.has(doc.id)).sort((a,b)=>b[1].ids.size-a[1].ids.size);
   // 相同交易双方重复出现时可归为一组；不同成员集合支持度相同则不能任意合并。
   const first=hits[0];
   if(first&&hits.filter(([,anchor])=>anchor.ids.size===first[1].ids.size).every(([,anchor])=>[...anchor.ids].every(id=>first[1].ids.has(id))))choices.set(doc.id,first[0]);
  }
  for(const [key,anchor] of anchors){
   const members=remaining.filter(doc=>choices.get(doc.id)===key);if(members.length<2)continue;
   const confidence=Math.min(...members.map(doc=>Math.max(...names(doc,rule.conditions?.partyField).map(name=>rule.matchType==='exact'?(name===anchor.name?100:0):supplierSimilarity(name,anchor.name)))));
   const id=`name:${rule.id}:${anchor.period}:documents:${rule.matchType==='exact'?encodeURIComponent(anchor.name):normalizeSupplier(anchor.name)}`;
   groups.set(id,{id,period:anchor.period,payerName:anchor.name,documentIds:members.map(doc=>doc.id),voucherIds:[],updatedAt:time,associationType:'name',ruleId:rule.id,confidence,basis:'documents',partyField:rule.conditions?.partyField||'either',documentTypes:[...types]});
   members.forEach(doc=>used.add(doc.id));
  }
 }
 return [...groups.values()];
}
/** 只保留已执行产生的关联。新增同名记录不会在导入、编辑或刷新时自行进入档案。 */
export function pruneNameAssociations(source:ArchiveState):void{
 const previouslyLinked=new Set([...source.vouchers,...source.documents].filter(record=>record.nameAssociationIds?.length).map(record=>record.id));
 const rules=new Map(source.rules.map(rule=>[rule.id,rule]));
 source.nameAssociations=(Array.isArray(source.nameAssociations)?source.nameAssociations:[]).flatMap(group=>{
  if(!group||!Array.isArray(group.voucherIds)||!Array.isArray(group.documentIds)||!['company','counterparty','documents'].includes(group.basis)||typeof group.payerName!=='string')return [];
  const rule=rules.get(group.ruleId);if(!rule||group.associationType!=='name')return [];
  const voucherIds=group.voucherIds.filter(id=>source.vouchers.some(voucher=>voucher.id===id&&voucher.status!=='missing'&&voucher.period===group.period&&normalizeSupplier(voucherName(voucher,group.basis))===normalizeSupplier(group.payerName)));
  const documentIds=group.documentIds.filter(id=>source.documents.some(doc=>doc.id===id&&doc.date.startsWith(group.period)&&(!group.documentTypes||group.documentTypes.includes(doc.type))&&names(doc,group.partyField||'either').some(name=>supplierSimilarity(name,group.payerName)>=group.confidence)));
  return (group.basis==='documents'?documentIds.length>=2:voucherIds.length&&documentIds.length)?[{...group,voucherIds,documentIds}]:[];
 });
 for(const record of [...source.vouchers,...source.documents])delete record.nameAssociationIds;
 for(const group of source.nameAssociations){
  for(const record of source.vouchers.filter(voucher=>group.voucherIds.includes(voucher.id)))record.nameAssociationIds=[...(record.nameAssociationIds||[]),group.id];
  for(const record of source.documents.filter(doc=>group.documentIds.includes(doc.id)))record.nameAssociationIds=[...(record.nameAssociationIds||[]),group.id];
 }
 for(const record of [...source.vouchers,...source.documents])if(previouslyLinked.has(record.id)&&!record.nameAssociationIds?.length&&record.status!=='matched'){record.matchReviewRequired=true;record.lastMatchReason='原名称关联已移除或主体已变更，请复核后重新关联';}
}
export function detachNameAssociations(source:ArchiveState,voucherIds:string[],documentIds:string[]):void{
 source.nameAssociations=(source.nameAssociations||[]).map(group=>({...group,voucherIds:group.voucherIds.filter(id=>!voucherIds.includes(id)),documentIds:group.documentIds.filter(id=>!documentIds.includes(id))}));pruneNameAssociations(source);
}
export function visibleArchiveGroups(source:ArchiveState):PayerGroup[]{
 const named=source.nameAssociations||[];
 return [...named,...(source.payerGroups||[]).filter(group=>!named.some(company=>group.documentIds.every(id=>company.documentIds.includes(id))&&group.voucherIds.every(id=>company.voucherIds.includes(id))))];
}
