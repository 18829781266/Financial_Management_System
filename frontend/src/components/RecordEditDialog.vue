<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useArchiveStore } from '../store';
import type { Voucher, SourceDocument } from '../types';
const props=defineProps<{modelValue:boolean;kind:'voucher'|'document';record?:Voucher|SourceDocument}>();
const emit=defineEmits<{'update:modelValue':[boolean];saved:[]}>();
const form=ref({no:'',period:'',date:'',summary:'',supplier:'',payeeName:'',payerAccount:'',payeeAccount:'',remarks:'',amount:'',invoiceNo:'',contractNo:'',bankNo:'',approvalNo:'',expectedAttachments:'',type:'invoice' as SourceDocument['type'],number:'',seal:false});
const error=ref('');
const pdfVoucher=computed(()=>props.kind==='voucher'&&props.record&&'no' in props.record&&props.record.sourceKind==='pdf-text');
const entries=computed(()=>props.record&&'no'in props.record?props.record.entries||[]:[]);
const reviewReasons=computed(()=>props.record?.reviewReasons||[]);
watch(()=>props.modelValue,open=>{
 if(open&&props.record){const r=props.record;form.value={no:'no'in r?r.no:'',period:'period'in r?r.period:r.date.slice(0,7),date:r.date,summary:'summary'in r?r.summary:'',supplier:'no'in r?r.supplier:r.payerName??r.supplier,payeeName:'payeeName'in r?r.payeeName||'':'',payerAccount:'payerAccount'in r?r.payerAccount||'':'',payeeAccount:'payeeAccount'in r?r.payeeAccount||'':'',remarks:'remarks'in r?r.remarks||'':'',amount:r.amount.toFixed(2),invoiceNo:'invoiceNo'in r?r.invoiceNo||'':'',contractNo:'contractNo'in r?r.contractNo||'':'',bankNo:'bankNo'in r?r.bankNo||'':'',approvalNo:'approvalNo'in r?r.approvalNo||'':'',expectedAttachments:'expectedAttachments'in r&&r.expectedAttachments!==undefined?String(r.expectedAttachments):'',type:'type'in r?r.type:'invoice',number:'number'in r?r.number:'',seal:'seal'in r?r.seal:false};error.value='';}
});
function save(){
 if(!props.record)return;
 try{
  const store=useArchiveStore();
  if(props.kind==='voucher')store.updateVoucher(props.record.id,form.value);
  else store.updateDocument(props.record.id,{...form.value,payerName:form.value.supplier});
  const remainsPending='no'in props.record&&props.record.reviewStatus==='pending';
  emit('saved');emit('update:modelValue',false);
  if(remainsPending)ElMessage.info('字段已保存，往来对象仍待复核');else ElMessage.success('字段已保存并复核');
 }catch(e){error.value=e instanceof Error?e.message:'保存失败';}
}
</script>
<template>
 <el-dialog :model-value="modelValue" @close="emit('update:modelValue',false)" :title="kind==='voucher'?'编辑与复核凭证':'补录与复核单据'" width="680px" destroy-on-close>
  <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon/>
  <el-alert v-if="reviewReasons.length" :title="reviewReasons.join('；')" type="warning" :closable="false" show-icon style="margin-bottom:16px"/>
  <el-form label-position="top">
   <div class="form-columns" v-if="kind==='voucher'"><el-form-item label="凭证号"><el-input v-model="form.no"/></el-form-item><el-form-item label="会计期间"><el-input v-model="form.period" placeholder="YYYY-MM"/></el-form-item></div>
   <el-form-item v-if="kind==='voucher'" label="摘要"><el-input v-model="form.summary"/></el-form-item>
   <div class="form-columns"><el-form-item :label="kind==='document'?'客商名称（付款人）':'往来客商名称'"><el-input v-model="form.supplier" placeholder="以原件中的往来对象为准"/></el-form-item><el-form-item label="日期"><el-input v-model="form.date" placeholder="YYYY-MM-DD"/></el-form-item></div>
   <el-form-item v-if="kind==='document'" label="收款人"><el-input v-model="form.payeeName" placeholder="按原件收款方填写，未列可留空"/></el-form-item>
   <div v-if="kind==='document'" class="form-columns"><el-form-item label="付款账号"><el-input v-model="form.payerAccount" placeholder="按原件填写"/></el-form-item><el-form-item label="收款账号"><el-input v-model="form.payeeAccount" placeholder="完整账号或至少4位尾号，保留前导零"/></el-form-item></div>
   <el-form-item v-if="kind==='document'" label="回单备注"><el-input v-model="form.remarks" type="textarea" :rows="2"/></el-form-item>
   <div class="form-columns">
    <el-form-item :label="pdfVoucher?'凭证合计（元，来自原始分录）':'金额（元）'"><el-input v-model="form.amount" :readonly="!!pdfVoucher" placeholder="未录入"/></el-form-item>
    <el-form-item v-if="kind==='voucher'" label="附件数（未知可留空）"><el-input v-model="form.expectedAttachments" placeholder="未注明"/></el-form-item>
    <el-form-item v-else label="单据类型"><el-select v-model="form.type"><el-option label="发票" value="invoice"/><el-option label="银行回单" value="bank"/><el-option label="合同" value="contract"/><el-option label="审批单" value="approval"/></el-select></el-form-item>
   </div>
   <template v-if="kind==='voucher'">
    <div class="form-columns"><el-form-item label="发票号（可选）"><el-input v-model="form.invoiceNo"/></el-form-item><el-form-item label="合同号（可选）"><el-input v-model="form.contractNo"/></el-form-item></div>
    <div class="form-columns"><el-form-item label="银行流水号（可选）"><el-input v-model="form.bankNo"/></el-form-item><el-form-item label="审批单号（可选）"><el-input v-model="form.approvalNo"/></el-form-item></div>
   </template>
   <template v-else><el-form-item label="单据编号"><el-input v-model="form.number"/></el-form-item><el-checkbox v-if="form.type==='invoice'" v-model="form.seal">已人工核验发票印章</el-checkbox></template>
  </el-form>
  <template v-if="entries.length">
   <p class="muted-text">请与原件核对以下分录。回单按每条分录的金额、收款账号及日期关联；零净额及红字需人工核对。</p>
   <el-table :data="entries" size="small" max-height="220"><el-table-column prop="summary" label="摘要" min-width="150"/><el-table-column prop="account" label="科目" min-width="160"/><el-table-column prop="debit" label="借方" align="right" width="110"/><el-table-column prop="credit" label="贷方" align="right" width="110"/></el-table>
  </template>
  <template #footer><button class="btn" @click="emit('update:modelValue',false)">取消</button><button class="btn primary" @click="save">保存并复核</button></template>
 </el-dialog>
</template>
