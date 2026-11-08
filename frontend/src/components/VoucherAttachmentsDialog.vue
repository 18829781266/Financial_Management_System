<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import {ElMessage} from 'element-plus';
import {Paperclip,FileText,Link2,ShieldCheck} from 'lucide-vue-next';
import {useArchiveStore} from '../store';
import VoucherReviewFields from './VoucherReviewFields.vue';
import {accountInSubject,entryAccount,entryMoney,evaluateEntryAttachments,RECEIPT_RULE_ID,requiredReceiptEntries} from '../entryAttachments';
import {amountCents} from '../money';
import {centsToAmount,documentRemainingCents,isReferenceDocument} from '../evidenceRelations';
import type {EntryAllocationInput,EntryAttachment,SourceDocument,Voucher} from '../types';

const props=defineProps<{modelValue:boolean;voucher?:Voucher;documents:SourceDocument[];reviewFields?:boolean}>();
const emit=defineEmits<{'update:modelValue':[boolean];view:[record:SourceDocument];saved:[]}>();
const store=useArchiveStore();
const money=(value:string|number)=>Number(value).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const locked=computed(()=>!props.voucher||store.isVoucherLocked(props.voucher));
/** 只复用确定性 R09 结果作展示，不把名称候选或歧义候选冒充已确认附件。 */
const automaticLinks=computed<EntryAttachment[]>(()=>{
 const voucher=props.voucher,rule=store.state.rules.find(item=>item.id===RECEIPT_RULE_ID&&item.enabled);
 if(!voucher?.entries?.length||!rule||locked.value)return [];
 const existing=voucher.entryAttachments||[],manual=existing.filter(link=>link.ruleId==='MANUAL');
 const draft:Voucher={...voucher,status:'pending',documentIds:[...new Set(manual.map(link=>link.documentId))],entryAttachments:manual,ruleId:undefined};
 const allocationVouchers=[...store.state.vouchers.filter(item=>item.id!==voucher.id),draft];
 const match=evaluateEntryAttachments([draft],props.documents,rule,allocationVouchers).matches.find(item=>item.voucherId===voucher.id);
 return (match?.entryAttachments||[]).filter(link=>!voucher.documentIds.includes(link.documentId)&&!existing.some(old=>old.entryIndex===link.entryIndex&&old.documentId===link.documentId));
});
// 旧整凭证关系和 R08 名称归集可直接查看，但只在首行集中展示，避免复制到每条分录或伪造分摊。
const voucherLevelDocuments=computed(()=>{
 const voucher=props.voucher;if(!voucher)return [];
 const allocated=new Set((voucher.entryAttachments||[]).map(link=>link.documentId));
 return voucher.documentIds.filter(id=>!allocated.has(id)).flatMap(id=>{const doc=props.documents.find(item=>item.id===id);return doc?[doc]:[];});
});
const nameAssociatedDocuments=computed(()=>{
 const voucher=props.voucher;if(!voucher?.nameAssociationIds?.length)return [];
 return props.documents.filter(doc=>!voucher.documentIds.includes(doc.id)&&doc.nameAssociationIds?.some(id=>voucher.nameAssociationIds?.includes(id))&&!automaticLinks.value.some(link=>link.documentId===doc.id));
});
const rows=computed(()=>(props.voucher?.entries||[]).map((entry,index)=>{
 const committed=(props.voucher?.entryAttachments||[]).filter(link=>link.entryIndex===index).flatMap(link=>{
  const doc=props.documents.find(doc=>doc.id===link.documentId&&props.voucher?.documentIds.includes(doc.id));return doc?[{...doc,link,suggested:false}]:[];
 });
 const suggested=automaticLinks.value.filter(link=>link.entryIndex===index).flatMap(link=>{
  const doc=props.documents.find(doc=>doc.id===link.documentId);return doc?[{...doc,link,suggested:true}]:[];
 });
 return {...entry,index,documents:[...committed,...suggested],voucherDocuments:index===0?voucherLevelDocuments.value:[],nameDocuments:index===0?nameAssociatedDocuments.value:[]};
}));
const required=computed(()=>new Set(props.voucher?requiredReceiptEntries(props.voucher):[]));
const reviewing=ref(false),reviewIndex=ref(0),selected=ref<string[]>([]),amounts=ref<Record<string,string>>({}),reason=ref(''),error=ref(''),candidateQuery=ref('');
const exemptionOpen=ref(false),exemptionReason=ref('');
const voucherFields=ref<{save:()=>boolean}>();
function saveFields(){
 const voucher=props.voucher;if(!voucherFields.value?.save()||!voucher)return;
 if(!voucher.documentIds.length&&!voucher.noAttachmentRequired){error.value='';exemptionReason.value='';exemptionOpen.value=true;}
}
const reviewRow=computed(()=>rows.value[reviewIndex.value]);
const reviewMoney=computed(()=>reviewRow.value?entryMoney(reviewRow.value):undefined);
const oldLinks=computed(()=>(props.voucher?.entryAttachments||[]).filter(link=>link.entryIndex===reviewIndex.value));
function availableFor(doc:SourceDocument):number{
 if(isReferenceDocument(doc))return amountCents(doc.amount);
 const old=oldLinks.value.filter(link=>link.documentId===doc.id).reduce((sum,link)=>sum+(link.allocatedAmount===undefined?amountCents(doc.amount):amountCents(link.allocatedAmount)),0);
 return documentRemainingCents(doc,store.state.vouchers)+old;
}
const candidates=computed(()=>props.documents.filter(doc=>{
 if(doc.documentStatus==='void')return false;
 const current=oldLinks.value.some(link=>link.documentId===doc.id);
 return isReferenceDocument(doc)||doc.type==='bank'&&(current||availableFor(doc)!==0);
}).filter(doc=>{
 const query=candidateQuery.value.trim().toLowerCase();if(!query)return true;
 return [doc.name,doc.number,doc.payerAccount,doc.payeeAccount,doc.payerName,doc.payeeName,doc.supplier]
  .some(value=>String(value||'').toLowerCase().includes(query));
}).sort((a,b)=>{
 const account=reviewRow.value?.account||'',side=reviewMoney.value?.side||'debit',amount=reviewMoney.value;
 return Number(accountInSubject(entryAccount(b,side),account))-Number(accountInSubject(entryAccount(a,side),account))||Math.abs(Math.abs(availableFor(a))-(amount?.cents||0))-Math.abs(Math.abs(availableFor(b))-(amount?.cents||0));
}));
const selectedRows=computed(()=>selected.value.flatMap(id=>{
 const doc=props.documents.find(item=>item.id===id);return doc?[{doc,reference:isReferenceDocument(doc),available:availableFor(doc)}]:[];
}));
const settlementTotal=computed(()=>selectedRows.value.reduce((sum,row)=>{
 if(row.reference)return sum;try{return sum+amountCents(amounts.value[row.doc.id]??'0');}catch{return sum;}
},0));
const remaining=computed(()=>(reviewMoney.value?.cents||0)-settlementTotal.value);
watch(selected,ids=>{
 for(const id of ids){
  if(amounts.value[id]!==undefined)continue;
  const doc=props.documents.find(item=>item.id===id);if(!doc)continue;
  amounts.value[id]=isReferenceDocument(doc)?'':centsToAmount(availableFor(doc));
 }
 for(const id of Object.keys(amounts.value))if(!ids.includes(id))delete amounts.value[id];
});
function filterCandidates(query:string){candidateQuery.value=query;}
function review(index:number){
 reviewIndex.value=index;candidateQuery.value='';
 const suggested=automaticLinks.value.filter(link=>link.entryIndex===index);
 selected.value=[...new Set([...oldLinks.value,...suggested].map(link=>link.documentId))];amounts.value={};
 for(const link of [...oldLinks.value,...suggested])amounts.value[link.documentId]=link.relationType==='reference'?'':link.allocatedAmount??'';
 // watch 仅补充新选单据；旧整单关联缺省金额需显式填成整单金额。
 for(const link of oldLinks.value){
  const doc=props.documents.find(item=>item.id===link.documentId);
  if(doc&&!isReferenceDocument(doc)&&!amounts.value[link.documentId])amounts.value[link.documentId]=centsToAmount(amountCents(doc.amount));
 }
 reason.value=props.voucher?.entryReviewNotes?.[String(index)]??oldLinks.value.find(link=>link.ruleId==='MANUAL')?.reason??'';error.value='';reviewing.value=true;
}
function save(){
 if(!props.voucher)return;
 const allocations:EntryAllocationInput[]=selectedRows.value.map(row=>({documentId:row.doc.id,relationType:row.reference?'reference':'settlement',...(row.reference?{}:{allocatedAmount:amounts.value[row.doc.id]||'0'})}));
 try{store.reconcileEntryAllocations(props.voucher.id,reviewIndex.value,allocations,reason.value);reviewing.value=false;emit('saved');close();ElMessage.success('人工复核已留痕，分录附件与分摊金额已更新');}
 catch(e){error.value=e instanceof Error?e.message:'复核未完成';}
}
function exempt(){
 if(!props.voucher)return;
 try{store.confirmAttachmentExemption(props.voucher.id,exemptionReason.value);exemptionOpen.value=false;exemptionReason.value='';emit('saved');close();ElMessage.success('无外部附件依据已留痕，已返回列表');}
 catch(e){error.value=e instanceof Error?e.message:'操作未完成';}
}
function close(){reviewing.value=false;exemptionOpen.value=false;error.value='';emit('update:modelValue',false);}
</script>

<template>
 <el-dialog :model-value="modelValue" :title="(reviewFields?'凭证复核与手工匹配 · ':'凭证分录与原始单据复核 · ')+(voucher?.no||'')" width="min(1180px, calc(100vw - 32px))" class="entry-attachments-dialog" @close="close" destroy-on-close>
  <div class="review-overview">
   <div><span class="review-kicker">当前凭证</span><strong>{{voucher?.no}}</strong><small>{{voucher?.summary}} · {{voucher?.supplier||'客商待复核'}}</small></div>
   <div class="review-total"><span>凭证金额</span><strong>¥ {{money(voucher?.amount||0)}}</strong></div>
   <div class="review-total"><span>已关联原件</span><strong>{{voucher?.documentIds.length||0}} <small>份</small></strong></div>
  </div>
  <el-alert v-if="voucher?.lastMatchReason" :title="voucher.lastMatchReason" :type="voucher.status==='matched'?'success':'warning'" :closable="false" show-icon/>
  <VoucherReviewFields v-if="reviewFields&&voucher&&!locked" ref="voucherFields" :voucher="voucher" :show-save-action="false" @saved="emit('saved')"/>
  <div v-if="reviewFields" class="attachment-section-heading"><span>2</span><div><h3>复核分录与原始单据</h3><p>字段复核与附件匹配在同一页面完成，确认留痕后返回列表。</p></div></div>
  <div class="review-rule"><ShieldCheck :size="16"/><span>回单按每条分录核对分摊合计；合同、审批单可共享引用且不参与金额凑算。候选不唯一时必须人工确认。</span></div>
  <el-table :data="rows" :max-height="reviewFields?'42vh':'55vh'" row-key="index" border empty-text="未读取到逐行分录，请补录分录或核对原始凭证后重新导入">
   <el-table-column prop="summary" label="摘要" min-width="190"><template #default="{row}"><span class="entry-summary">{{row.summary||'—'}}</span></template></el-table-column>
   <el-table-column prop="account" label="科目" min-width="220"><template #default="{row}"><span class="entry-account">{{row.account||'—'}}</span></template></el-table-column>
   <el-table-column label="借方" width="125" align="right"><template #default="{row}"><span class="entry-money">{{Number(row.debit)?money(row.debit):'—'}}</span></template></el-table-column>
   <el-table-column label="贷方" width="125" align="right"><template #default="{row}"><span class="entry-money">{{Number(row.credit)?money(row.credit):'—'}}</span></template></el-table-column>
   <el-table-column label="附件单据" min-width="290"><template #default="{row}">
    <div class="entry-documents">
     <div v-for="doc in row.voucherDocuments" :key="`voucher-${doc.id}`" class="entry-document-row">
      <button class="entry-document text-link" @click="emit('view',doc)"><Paperclip :size="15"/><span>{{doc.name}}</span></button>
      <small class="shared-chip"><Link2 :size="11"/>整凭证关联 · 未分配分录</small>
     </div>
     <div v-for="doc in row.nameDocuments" :key="`name-${doc.id}`" class="entry-document-row">
      <button class="entry-document text-link" @click="emit('view',doc)"><Paperclip :size="15"/><span>{{doc.name}}</span></button>
      <small class="name-match-chip"><Link2 :size="11"/>企业名称归集 · 未确认金额关系</small>
     </div>
     <div v-for="doc in row.documents" :key="`${doc.id}-${doc.link.allocatedAmount||'full'}`" class="entry-document-row">
      <button class="entry-document text-link" @click="emit('view',doc)"><Paperclip :size="15"/><span>{{doc.name}}</span></button>
      <small v-if="doc.suggested" class="auto-match-chip"><ShieldCheck :size="11"/>唯一金额候选 · 金额、账号及日期一致</small>
      <small v-else-if="doc.link.relationType==='reference'" class="shared-chip"><Link2 :size="11"/>共享引用 · 不计金额</small>
      <small v-else>本次分摊 <b>¥ {{money(doc.link.allocatedAmount??doc.amount)}}</b><template v-if="doc.remainingAmount!==undefined"> · 单据剩余 ¥ {{money(doc.remainingAmount)}}</template></small>
     </div>
     <span v-if="!row.documents.length" :class="required.has(row.index)?'entry-review':'entry-empty'">{{required.has(row.index)?(row.voucherDocuments.length||row.nameDocuments.length?'分录金额待复核':'未关联 · 请复核'):(row.voucherDocuments.length||row.nameDocuments.length?'未分配分录':'未关联')}}</span>
     <button v-if="!locked" class="text-link entry-review-action" :aria-label="(row.documents.length?'调整关联第':'人工复核第')+(row.index+1)+'条分录'" @click="review(row.index)">{{row.documents.length?'调整关联 / 分摊':'人工复核 / 分摊'}}</button>
    </div>
   </template></el-table-column>
  </el-table>
  <div v-if="voucher?.noAttachmentRequired" class="exemption-receipt"><ShieldCheck :size="17"/><span>已确认无外部附件：{{voucher.attachmentExemptionReason}}</span></div>
  <template v-if="!locked" #footer><div class="review-dialog-footer"><span class="footer-spacer"/><button class="btn" @click="close">取消</button><button v-if="reviewFields" class="btn primary" @click="saveFields">保存并复核字段</button></div></template>
 </el-dialog>

 <el-dialog v-model="reviewing" class="entry-review-dialog" :title="'人工复核第'+(reviewIndex+1)+'条分录'" width="min(900px, calc(100vw - 32px))" append-to-body destroy-on-close>
  <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon/>
  <p class="review-entry-summary">{{reviewRow?.summary}}<small>{{reviewRow?.account}}</small></p>
  <div class="entry-target"><span>本条分录待分摊</span><strong>¥ {{money((reviewMoney?.cents||0)/100)}}</strong><small>{{reviewMoney?.side==='credit'?'贷方 · 核付款账号':'借方 · 核收款账号'}}</small></div>
  <el-form label-position="top">
   <el-form-item label="选择回单或共享资料"><el-select v-model="selected" multiple filterable :filter-method="filterCandidates" placeholder="搜索回单编号、账号、合同或审批单" style="width:100%" no-data-text="暂无可分摊回单或共享资料">
    <el-option v-for="doc in candidates" :key="doc.id" :value="doc.id" :label="`${doc.name} · ${isReferenceDocument(doc)?'共享引用':`剩余 ¥${money(availableFor(doc)/100)}`}`"><span><FileText :size="13"/> {{doc.name}} · {{isReferenceDocument(doc)?'共享引用':`剩余 ¥${money(availableFor(doc)/100)}`}} · {{doc.number}}</span></el-option>
   </el-select></el-form-item>
  </el-form>
  <div v-if="selectedRows.length" class="allocation-list">
   <div class="allocation-head"><span>单据 / 可用余额</span><span>本次分摊金额（元）</span></div>
   <div v-for="row in selectedRows" :key="row.doc.id" class="allocation-row">
    <div><strong>{{row.doc.name}}</strong><small>{{row.reference?'合同 / 审批共享资料，不消耗金额':`当前可分摊 ¥${money(row.available/100)} · ${row.doc.number}`}}</small></div>
    <span v-if="row.reference" class="shared-chip"><Link2 :size="12"/>共享引用</span>
    <el-input v-else v-model="amounts[row.doc.id]" inputmode="decimal" :aria-label="`${row.doc.name}本次分摊金额`" placeholder="0.00"><template #append>元</template></el-input>
   </div>
  </div>
  <div class="allocation-check" :class="{error:remaining!==0&&settlementTotal!==0}">
   <span>分摊合计 <b>¥ {{money(settlementTotal/100)}}</b></span><span>与分录差异 <b>¥ {{money(remaining/100)}}</b></span><small>{{settlementTotal===0?'仅共享引用或清空关联时，不提交金额核销':'差异为 0 才能保存金额分摊'}}</small>
  </div>
  <el-form label-position="top"><el-form-item label="人工复核依据（必填）"><el-input v-model="reason" type="textarea" :rows="3" placeholder="说明账号、跨期、红字、部分付款或共享引用的原件依据，系统将保留操作记录"/></el-form-item></el-form>
  <template #footer><button class="btn" @click="reviewing=false">取消</button><button class="btn primary" @click="save">保存分摊与关联</button></template>
 </el-dialog>

 <el-dialog v-model="exemptionOpen" class="attachment-exemption-dialog" title="确认凭证无需外部附件" width="min(560px, calc(100vw - 32px))" append-to-body destroy-on-close>
  <el-alert title="仅适用于内部结转、计提等确实没有外部原始单据的凭证；附件缺失不能使用此功能。" type="warning" :closable="false" show-icon/>
  <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon style="margin-top:12px"/>
  <el-form label-position="top" style="margin-top:18px"><el-form-item label="业务依据（必填）"><el-input v-model="exemptionReason" type="textarea" :rows="4" placeholder="例如：月末内部折旧计提，凭证后附内部计算表编号，无外部发票或回单"/></el-form-item></el-form>
  <template #footer><button class="btn" @click="exemptionOpen=false">取消</button><button class="btn primary" @click="exempt">确认并留痕</button></template>
 </el-dialog>
</template>

<style scoped>
.review-overview{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:24px;align-items:center;padding:16px 18px;margin-bottom:14px;background:#f2f6fa;border:1px solid #e0e8f0;border-radius:12px}.review-overview>div:first-child{display:flex;flex-direction:column;gap:4px}.review-overview strong{font-size:18px;color:#17324d}.review-overview small{display:block;color:#718399;font-weight:400}.review-kicker,.review-total span{font-size:12px;color:#718399}.review-total{text-align:right}.review-total strong{display:block;margin-top:4px;font-variant-numeric:tabular-nums}.review-total strong small{display:inline}.review-rule{display:flex;align-items:flex-start;gap:8px;margin:12px 0 16px;padding:10px 12px;background:#f4f7f5;color:#4c675b;border-radius:8px;font-size:12px;line-height:1.7}.review-rule svg{flex:none;margin-top:2px}.entry-summary,.entry-account{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8}.entry-money{font-variant-numeric:tabular-nums;font-weight:600;color:#2a4766}.entry-documents{display:flex;flex-direction:column;gap:10px;padding:5px 0}.entry-document-row{display:flex;flex-direction:column;gap:3px}.entry-document-row>small{font-size:11px;color:#718399;padding-left:21px}.entry-document-row>small b{color:#2a4766}.entry-document{display:flex;align-items:flex-start;gap:6px;white-space:normal;text-align:left;line-height:1.7}.entry-document svg{flex-shrink:0;margin-top:3px}.entry-document span{overflow-wrap:anywhere}.entry-review{font-size:12px;color:#a96d22}.entry-empty{color:#718399}.entry-review-action{font-size:12px;align-self:flex-start}.review-entry-summary{padding:14px 16px;background:#f4f8fc;border:1px solid #e2eaf3;border-radius:8px;margin:14px 0;line-height:1.8}.review-entry-summary small{display:block;color:#718399;overflow-wrap:anywhere}.entry-target{display:flex;align-items:baseline;gap:12px;margin-bottom:18px}.entry-target span,.entry-target small{font-size:12px;color:#718399}.entry-target strong{font-size:22px;color:#17324d;font-variant-numeric:tabular-nums}.allocation-list{margin:12px 0 16px;border:1px solid #e1e8ef;border-radius:10px;overflow:hidden}.allocation-head,.allocation-row{display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:18px;align-items:center;padding:11px 14px}.allocation-head{background:#f3f6f9;color:#718399;font-size:12px}.allocation-row{border-top:1px solid #e8edf2}.allocation-row strong{display:block;font-size:13px;overflow-wrap:anywhere}.allocation-row small{display:block;margin-top:4px;color:#718399}.allocation-check{display:flex;align-items:center;gap:22px;padding:13px 15px;margin:12px 0 18px;background:#eef6f1;border-radius:9px;color:#355f4a;font-size:13px}.allocation-check.error{background:#fff4e8;color:#8c5a1d}.allocation-check small{margin-left:auto}.shared-chip{display:inline-flex;align-items:center;gap:4px;color:#526e62!important;font-size:11px;white-space:nowrap}.exemption-receipt{display:flex;gap:8px;align-items:center;margin-top:14px;padding:12px;background:#eef6f1;color:#355f4a;border-radius:8px}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:700px){.review-overview{grid-template-columns:1fr 1fr;gap:12px}.review-overview>div:first-child{grid-column:1/-1}.allocation-head{display:none}.allocation-row{grid-template-columns:1fr;gap:10px}.allocation-check{flex-wrap:wrap;gap:8px 16px}.allocation-check small{width:100%;margin-left:0}.entry-target{flex-wrap:wrap}}
.attachment-section-heading{display:flex;align-items:center;gap:12px;margin:20px 0 14px}.attachment-section-heading>span{display:grid;place-items:center;flex:none;width:28px;height:28px;border-radius:8px;background:#eaf2fc;color:#2f6db5;font-size:13px;font-weight:700}.attachment-section-heading h3{font-size:16px;line-height:1.5;color:#1d3552}.attachment-section-heading p{margin-top:3px;color:#64788e;font-size:12px;line-height:1.7}@media(max-width:760px){.attachment-section-heading p{font-size:13px}}
.auto-match-chip,.name-match-chip{display:inline-flex;align-items:center;gap:4px}.auto-match-chip{color:#287662!important}.name-match-chip{color:#6c5b32!important}.review-dialog-footer{display:flex;align-items:center;gap:10px;width:100%}.footer-spacer{flex:1}.review-dialog-footer .btn{white-space:nowrap}@media(max-width:560px){.review-dialog-footer{flex-wrap:wrap}.review-dialog-footer .btn{min-height:44px}}
@media(prefers-reduced-motion:reduce){.spin{animation:none}}
</style>
