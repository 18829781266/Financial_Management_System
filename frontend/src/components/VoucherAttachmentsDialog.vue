<script setup lang="ts">
import {computed,ref} from 'vue';
import {ElMessage} from 'element-plus';
import {Paperclip,FileText} from 'lucide-vue-next';
import {useArchiveStore} from '../store';
import {accountInSubject,entryMoney,requiredReceiptEntries} from '../entryAttachments';
import type {SourceDocument,Voucher} from '../types';

const props=defineProps<{modelValue:boolean;voucher?:Voucher;documents:SourceDocument[]}>();
const emit=defineEmits<{'update:modelValue':[boolean];view:[record:SourceDocument]}>();
const store=useArchiveStore();
const money=(value:string|number)=>Number(value).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const rows=computed(()=>(props.voucher?.entries||[]).map((entry,index)=>({...entry,index,documents:(props.voucher?.entryAttachments||[]).filter(link=>link.entryIndex===index).flatMap(link=>{
 const doc=props.documents.find(doc=>doc.id===link.documentId&&props.voucher?.documentIds.includes(doc.id)&&doc.status==='matched');return doc?[doc]:[];
})})));
const required=computed(()=>new Set(props.voucher?requiredReceiptEntries(props.voucher):[]));
const locked=computed(()=>!props.voucher||store.isVoucherLocked(props.voucher));
const reviewing=ref(false),reviewIndex=ref(0),selected=ref<string[]>([]),reason=ref(''),error=ref('');
const reviewRow=computed(()=>rows.value[reviewIndex.value]);
const candidates=computed(()=>props.documents.filter(doc=>doc.status!=='matched'||reviewRow.value?.documents.some(current=>current.id===doc.id)).sort((a,b)=>{
 const account=reviewRow.value?.account||'',amount=reviewRow.value&&entryMoney(reviewRow.value);
 return Number(accountInSubject(b.payeeAccount||'',account))-Number(accountInSubject(a.payeeAccount||'',account))||Math.abs(a.amount-(amount?.cents||0)/100)-Math.abs(b.amount-(amount?.cents||0)/100);
}));
function review(index:number){reviewIndex.value=index;selected.value=rows.value[index]!.documents.map(doc=>doc.id);reason.value='';error.value='';reviewing.value=true;}
function save(){
 if(!props.voucher)return;
 try{store.reconcileEntry(props.voucher.id,reviewIndex.value,selected.value,reason.value);reviewing.value=false;ElMessage.success('本条分录附件已更新，回单备注已同步');}
 catch(e){error.value=e instanceof Error?e.message:'复核未完成';}
}
function close(){reviewing.value=false;emit('update:modelValue',false);}
</script>

<template>
 <el-dialog :model-value="modelValue" :title="'核对凭证附件 · '+(voucher?.no||'')" width="min(1180px, calc(100vw - 32px))" class="entry-attachments-dialog" @close="close" destroy-on-close>
  <el-table :data="rows" :max-height="'65vh'" row-key="index" border empty-text="未读取到逐行分录，请补录分录或核对原始凭证后重新导入">
   <el-table-column prop="summary" label="摘要" min-width="190"><template #default="{row}"><span class="entry-summary">{{row.summary||'—'}}</span></template></el-table-column>
   <el-table-column prop="account" label="科目" min-width="220"><template #default="{row}"><span class="entry-account">{{row.account||'—'}}</span></template></el-table-column>
   <el-table-column label="借方" width="125" align="right"><template #default="{row}"><span class="entry-money">{{Number(row.debit)?money(row.debit):'—'}}</span></template></el-table-column>
   <el-table-column label="贷方" width="125" align="right"><template #default="{row}"><span class="entry-money">{{Number(row.credit)?money(row.credit):'—'}}</span></template></el-table-column>
   <el-table-column label="附件单据" min-width="270"><template #default="{row}">
    <div class="entry-documents">
     <button v-for="doc in row.documents" :key="doc.id" class="entry-document text-link" @click="emit('view',doc)"><Paperclip :size="15"/><span>{{doc.name}}</span></button>
     <span v-if="!row.documents.length" :class="required.has(row.index)?'entry-review':'entry-empty'">{{required.has(row.index)?'未关联 · 请复核':'未关联'}}</span>
     <button v-if="!locked" class="text-link entry-review-action" :aria-label="'人工复核第'+(row.index+1)+'条分录'" @click="review(row.index)">人工复核</button>
    </div>
   </template></el-table-column>
  </el-table>
  <template #footer><button class="btn" @click="close">关闭</button></template>
 </el-dialog>
 <el-dialog v-model="reviewing" :title="'人工复核第'+(reviewIndex+1)+'条分录'" width="min(740px, calc(100vw - 32px))" append-to-body destroy-on-close>
  <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon/>
  <p class="review-entry-summary">{{reviewRow?.summary}}<small>{{reviewRow?.account}}</small></p>
  <el-form label-position="top">
   <el-form-item label="选择本条摘要关联的附件单据"><el-select v-model="selected" multiple filterable placeholder="搜索回单名称、编号或收款账号" style="width:100%" no-data-text="暂无可用单据，已关联其他分录的单据不可重复选择">
    <el-option v-for="doc in candidates" :key="doc.id" :value="doc.id" :label="`${doc.name} · ¥${money(doc.amount)} · ${doc.payeeAccount||'未录收款账号'}`"><span><FileText :size="13"/> {{doc.name}} · ¥{{money(doc.amount)}} · 尾号{{doc.payeeAccount?.slice(-4)||'未录入'}}</span></el-option>
   </el-select></el-form-item>
   <p class="muted-text">所选单据金额合计须与本条分录完全一致。账号或日期例外请写明依据；清空选择可解除本条分录附件。</p>
   <el-form-item label="人工复核依据（必填）"><el-input v-model="reason" type="textarea" :rows="3" placeholder="填写对照原件的核对依据，系统将保留操作记录"/></el-form-item>
  </el-form>
  <template #footer><button class="btn" @click="reviewing=false">取消</button><button class="btn primary" @click="save">保存分录附件</button></template>
 </el-dialog>
</template>

<style scoped>
.entry-summary,.entry-account{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8}.entry-money{font-variant-numeric:tabular-nums;font-weight:600;color:#2a4766}.entry-documents{display:flex;flex-direction:column;gap:10px;padding:5px 0}.entry-document{display:flex;align-items:flex-start;gap:6px;white-space:normal;text-align:left;line-height:1.7}.entry-document svg{flex-shrink:0;margin-top:3px}.entry-document span{overflow-wrap:anywhere}.entry-review{font-size:12px;color:#a96d22}.entry-empty{color:#92a0b0}.entry-review-action{font-size:12px;align-self:flex-start}.review-entry-summary{padding:14px 16px;background:#f4f8fc;border:1px solid #e2eaf3;border-radius:8px;margin-bottom:18px;line-height:1.8}.review-entry-summary small{display:block;color:#74859b;overflow-wrap:anywhere}
</style>
