<script setup lang="ts">
import {ref,watch} from 'vue';
import {ElMessage} from 'element-plus';
import {CheckCircle2,ClipboardCheck} from 'lucide-vue-next';
import {useArchiveStore} from '../store';
import type {Voucher} from '../types';

const props=withDefaults(defineProps<{voucher:Voucher;showHeading?:boolean;showSaveAction?:boolean}>(),{showHeading:true,showSaveAction:true});
const emit=defineEmits<{saved:[]}>();
const store=useArchiveStore();
const saving=ref(false),error=ref(''),supplierError=ref('');
const form=ref({no:'',period:'',date:'',summary:'',supplier:'',amount:'',invoiceNo:'',contractNo:'',bankNo:'',approvalNo:'',expectedAttachments:''});
watch(()=>props.voucher.id,()=>{
 const r=props.voucher;
 form.value={no:r.no,period:r.period,date:r.date,summary:r.summary,supplier:r.supplier,amount:r.amount.toFixed(2),invoiceNo:r.invoiceNo||'',contractNo:r.contractNo||'',bankNo:r.bankNo||'',approvalNo:r.approvalNo||'',expectedAttachments:r.expectedAttachments!==undefined?String(r.expectedAttachments):''};
 error.value='';
},{immediate:true});
const pdfVoucher=()=>props.voucher.sourceKind==='pdf-text';
function save():boolean{
 if(saving.value)return false;
 supplierError.value='';error.value='';
 if(!form.value.supplier.trim()){
  supplierError.value='请填写往来客商名称，保存后将按此名称归入电子档案';
  return false;
 }
 saving.value=true;
 try{
  store.updateVoucher(props.voucher.id,form.value);
  const remainsPending=props.voucher.reviewStatus==='pending';
  emit('saved');
  if(remainsPending)ElMessage.info('字段已保存，仍有关联信息待复核');else ElMessage.success('凭证字段已保存并复核');
  return true;
 }catch(e){error.value=e instanceof Error?e.message:'保存失败';return false;}
 finally{saving.value=false;}
}
defineExpose({save});
</script>

<template>
 <section class="voucher-field-review" aria-label="凭证字段复核">
  <div v-if="showHeading" class="review-section-heading">
   <span class="review-step">1</span>
   <div><h3>核对凭证字段</h3><p>先按原始凭证核对关键字段，再在下方完成原始单据匹配。</p></div>
   <span :class="['field-review-state',{reviewed:voucher.reviewStatus!=='pending'}]"><CheckCircle2 :size="14"/>{{voucher.reviewStatus==='pending'?'待复核':'已复核'}}</span>
  </div>
  <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="field-review-alert"/>
  <el-alert v-if="voucher.reviewReasons?.length" :title="voucher.reviewReasons.join('；')" type="warning" :closable="false" show-icon class="field-review-alert"/>
  <el-form label-position="top" class="voucher-review-form" @submit.prevent>
   <div class="form-columns"><el-form-item label="凭证号"><el-input v-model="form.no"/></el-form-item><el-form-item label="会计期间"><el-input v-model="form.period" placeholder="YYYY-MM"/></el-form-item></div>
   <el-form-item label="摘要"><el-input v-model="form.summary"/></el-form-item>
   <div class="form-columns"><el-form-item label="往来客商名称（必填）" required :error="supplierError"><el-input v-model="form.supplier" placeholder="填写原件中的客户、供应商或其他往来单位" aria-required="true" @input="supplierError=''"/><div class="field-help">用于电子档案按客商归集，请填写完整单位名称，不要填写内部部门或简称。</div></el-form-item><el-form-item label="日期"><el-input v-model="form.date" placeholder="YYYY-MM-DD"/></el-form-item></div>
   <div class="form-columns"><el-form-item :label="pdfVoucher()?'凭证合计（元，来自原始分录）':'金额（元）'"><el-input v-model="form.amount" :readonly="pdfVoucher()" placeholder="未录入"/></el-form-item><el-form-item label="附件数（未知可留空）"><el-input v-model="form.expectedAttachments" placeholder="未注明"/></el-form-item></div>
   <div class="form-columns"><el-form-item label="发票号（可选）"><el-input v-model="form.invoiceNo"/></el-form-item><el-form-item label="合同号（可选）"><el-input v-model="form.contractNo"/></el-form-item></div>
   <div class="form-columns"><el-form-item label="银行流水号（可选）"><el-input v-model="form.bankNo"/></el-form-item><el-form-item label="审批单号（可选）"><el-input v-model="form.approvalNo"/></el-form-item></div>
   <div v-if="showSaveAction" class="field-review-actions"><span><ClipboardCheck :size="15"/>保存只确认字段，不会代替附件匹配</span><button type="button" class="btn primary" :disabled="saving" @click="save">{{saving?'正在保存…':'保存并复核字段'}}</button></div>
  </el-form>
 </section>
</template>

<style scoped>
.voucher-field-review{margin:0 0 20px;padding:0 0 20px;border-bottom:1px solid #e2eaf2}.field-help{min-height:1lh;margin-top:6px;color:#687d93;font-size:12px;line-height:1.6}.review-section-heading{display:flex;align-items:center;gap:12px;margin-bottom:16px}.review-section-heading>div{min-width:0;flex:1}.review-section-heading h3{font-size:16px;line-height:1.5;color:#1d3552}.review-section-heading p{margin-top:3px;font-size:12px;line-height:1.7;color:#64788e}.review-step{display:grid;place-items:center;flex:none;width:28px;height:28px;border-radius:8px;background:#eaf2fc;color:#2f6db5;font-size:13px;font-weight:700}.field-review-state{display:inline-flex;align-items:center;gap:5px;flex:none;padding:4px 8px;border-radius:6px;background:#fff5e5;color:#98611d;font-size:12px;white-space:nowrap}.field-review-state.reviewed{background:#edf8f2;color:#287662}.field-review-alert{margin-bottom:14px}.voucher-review-form{padding:2px 2px 0}.field-review-actions{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:2px}.field-review-actions>span{display:inline-flex;align-items:center;gap:6px;color:#687d93;font-size:12px;line-height:1.6}.field-review-actions .btn{flex:none}@media(max-width:760px){.review-section-heading{align-items:flex-start}.review-section-heading p{font-size:13px}.field-review-state{margin-top:2px}.field-review-actions{align-items:stretch;flex-direction:column}.field-review-actions .btn{width:100%;min-height:44px}}
</style>
