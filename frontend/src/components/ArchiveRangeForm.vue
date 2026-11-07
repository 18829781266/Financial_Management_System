<script setup lang="ts">
import {computed,watch} from 'vue';
import {CalendarDays,FileStack,Info} from 'lucide-vue-next';
import type {ArchiveBook,GenerateArchiveRequest,Voucher} from '../types';

const props=defineProps<{modelValue:GenerateArchiveRequest;vouchers:Voucher[];archives:ArchiveBook[]}>();
const emit=defineEmits<{'update:modelValue':[GenerateArchiveRequest];'validity-change':[boolean]}>();
// 与归档服务使用相同的凭证号自然排序，记-2 位于记-10 之前。
const compare=(a:string,b:string)=>a.localeCompare(b,'zh-CN',{numeric:true});
const periods=computed(()=>new Set(props.vouchers.map(voucher=>voucher.period).filter(period=>/^\d{4}-(0[1-9]|1[0-2])$/.test(period))));
const periodVouchers=computed(()=>props.vouchers.filter(voucher=>voucher.period===props.modelValue.period).sort((a,b)=>compare(a.no,b.no)));
const locked=(voucher:Voucher)=>props.archives.some(archive=>archive.period===voucher.period&&compare(voucher.no,archive.startVoucherNo)>=0&&compare(voucher.no,archive.endVoucherNo)<=0);
const selectable=computed(()=>periodVouchers.value.filter(voucher=>!locked(voucher)));
const periodLabel=(value:Date)=>`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}`;
const disabledMonth=(value:Date)=>!periods.value.has(periodLabel(value));
const selectedRange=computed(()=>periodVouchers.value.filter(voucher=>props.modelValue.startVoucherNo&&props.modelValue.endVoucherNo&&compare(voucher.no,props.modelValue.startVoucherNo)>=0&&compare(voucher.no,props.modelValue.endVoucherNo)<=0));
// 两个端点均未锁定，也可能跨过中间已归档的区间，必须检查整个闭区间。
const overlapsArchive=computed(()=>!!props.modelValue.startVoucherNo&&!!props.modelValue.endVoucherNo&&props.archives.some(archive=>archive.period===props.modelValue.period&&compare(archive.startVoucherNo,props.modelValue.endVoucherNo)<=0&&compare(archive.endVoucherNo,props.modelValue.startVoucherNo)>=0));
const valid=computed(()=>periods.value.has(props.modelValue.period)&&!!selectable.value.find(v=>v.no===props.modelValue.startVoucherNo)&&!!selectable.value.find(v=>v.no===props.modelValue.endVoucherNo)&&compare(props.modelValue.startVoucherNo,props.modelValue.endVoucherNo)<=0&&!overlapsArchive.value);
const total=computed(()=>selectedRange.value.reduce((sum,voucher)=>sum+Math.round(voucher.amount*100),0)/100);
function defaultEnd(start:string):string{
 const from=periodVouchers.value.findIndex(voucher=>voucher.no===start);let end=start;
 // 默认选择第一段连续未归档的实际记录，避免自动跨越已锁定档案。
 for(const voucher of periodVouchers.value.slice(from+1)){if(locked(voucher))break;end=voucher.no;}
 return end;
}
function reconcile(){
 const start=selectable.value.find(v=>v.no===props.modelValue.startVoucherNo)?.no||selectable.value[0]?.no||'';
 const end=selectable.value.find(v=>v.no===props.modelValue.endVoucherNo&&compare(v.no,start)>=0)?.no||(start?defaultEnd(start):'');
 if(start!==props.modelValue.startVoucherNo||end!==props.modelValue.endVoucherNo)emit('update:modelValue',{...props.modelValue,startVoucherNo:start,endVoucherNo:end});
}
const month=computed({get:()=>props.modelValue.period,set:(value:string|null)=>emit('update:modelValue',{period:value||'',startVoucherNo:'',endVoucherNo:''})});
const start=computed({get:()=>props.modelValue.startVoucherNo,set:(value:string)=>emit('update:modelValue',{...props.modelValue,startVoucherNo:value,endVoucherNo:props.modelValue.endVoucherNo&&compare(props.modelValue.endVoucherNo,value)>=0?props.modelValue.endVoucherNo:defaultEnd(value)})});
const end=computed({get:()=>props.modelValue.endVoucherNo,set:(value:string)=>emit('update:modelValue',{...props.modelValue,endVoucherNo:value})});
const optionStatus=(voucher:Voucher)=>locked(voucher)?'已归档':voucher.reviewStatus==='pending'?'请复核':voucher.status==='matched'?'已关联':voucher.nameAssociationIds?.length?'名称关联':'待匹配';
watch(()=>[props.modelValue.period,periodVouchers.value.map(v=>`${v.id}:${v.no}:${locked(v)}`).join('|')],reconcile,{immediate:true});
watch(valid,value=>emit('validity-change',value),{immediate:true});
</script>

<template>
 <el-form label-position="top" class="archive-range-form">
  <el-form-item label="会计期间">
   <el-date-picker v-model="month" id="archive-period" aria-label="会计期间" type="month" format="YYYY年MM月" value-format="YYYY-MM" placeholder="点击选择会计期间" :editable="false" :disabled="!periods.size" :disabled-date="disabledMonth" :prefix-icon="CalendarDays" style="width:100%"/>
   <span class="archive-range-help">仅可选择已有记账凭证的会计期间。</span>
  </el-form-item>
  <div class="form-columns">
   <el-form-item label="起始凭证号"><el-select v-model="start" aria-label="起始凭证号" filterable :disabled="!selectable.length" :placeholder="month?'选择起始凭证':'先选择会计期间'" no-data-text="暂无可选择的凭证" popper-class="archive-voucher-options" style="width:100%"><el-option v-for="voucher in periodVouchers" :key="voucher.id" :label="voucher.no" :value="voucher.no" :disabled="locked(voucher)"><div class="archive-voucher-option"><div><strong>{{voucher.no}}</strong><small :title="voucher.fileName||voucher.summary">{{voucher.fileName||voucher.summary}}</small></div><span>{{optionStatus(voucher)}}</span></div></el-option></el-select></el-form-item>
   <el-form-item label="终止凭证号"><el-select v-model="end" aria-label="终止凭证号" filterable :disabled="!selectable.length||!start" :placeholder="month?'选择终止凭证':'先选择会计期间'" no-data-text="暂无可选择的凭证" popper-class="archive-voucher-options" style="width:100%"><el-option v-for="voucher in periodVouchers" :key="voucher.id" :label="voucher.no" :value="voucher.no" :disabled="locked(voucher)||!!start&&compare(voucher.no,start)<0"><div class="archive-voucher-option"><div><strong>{{voucher.no}}</strong><small :title="voucher.fileName||voucher.summary">{{voucher.fileName||voucher.summary}}</small></div><span>{{optionStatus(voucher)}}</span></div></el-option></el-select></el-form-item>
  </div>
  <div v-if="!periods.size" class="archive-range-note"><Info :size="17"/><span>还没有记账凭证，请先到数据采集页面导入凭证。</span></div>
  <div v-else-if="month&&!selectable.length" class="archive-range-note"><Info :size="17"/><span>该期间没有可生成档案的未归档凭证，请选择其他期间。</span></div>
  <div v-else-if="overlapsArchive" class="archive-range-note warning" role="status"><Info :size="17"/><span>所选范围包含已归档区间，请调整起止凭证号。</span></div>
  <div v-else-if="valid" class="archive-range-summary" role="status"><FileStack :size="18"/><div><strong>已选 {{selectedRange.length}} 张实际凭证</strong><span>{{modelValue.startVoucherNo}} — {{modelValue.endVoucherNo}}</span></div><b>¥ {{total.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}}</b></div>
 </el-form>
</template>

<style>
.archive-range-form .el-form-item{margin-bottom:20px}.archive-range-form .el-form-item__content{display:block}.archive-range-help{display:block;font-size:11px;line-height:1.8;color:#879ab1;margin-top:7px}.archive-range-form .form-columns{gap:15px}.archive-voucher-options .el-select-dropdown__item{height:auto;min-height:55px;line-height:1.5;padding:9px 18px}.archive-voucher-option{display:flex;align-items:center;justify-content:space-between;gap:18px}.archive-voucher-option>div{min-width:0}.archive-voucher-option strong{display:block;font-size:13px;color:#41668e;font-weight:650}.archive-voucher-option small{display:block;max-width:260px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:11px;color:#8a9db4;margin-top:4px}.archive-voucher-option>span{font-size:10px;color:#8c9eb5;white-space:nowrap}.archive-voucher-options .is-disabled .archive-voucher-option strong{color:#a6b3c4}.archive-range-summary{display:flex;align-items:center;gap:10px;border:1px solid #dfe9f8;background:#f3f8ff;border-radius:10px;padding:14px;margin-bottom:18px;color:#6888b3}.archive-range-summary>div{flex:1;min-width:0}.archive-range-summary strong{display:block;color:#4b6e99;font-size:13px;font-weight:600}.archive-range-summary span{display:block;font-size:11px;margin-top:5px;color:#8a9fb8;overflow-wrap:anywhere}.archive-range-summary b{font-size:16px;color:#416994;font-variant-numeric:tabular-nums;white-space:nowrap}.archive-range-note{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.8;padding:12px 14px;border-radius:9px;background:#f5f8fc;color:#7d91ad;margin-bottom:15px}.archive-range-note.warning{background:#fff8ed;color:#b28440}.archive-range-note>svg{margin-top:2px;flex:none}@media(max-width:600px){.archive-voucher-option small{max-width:180px}.archive-voucher-options{max-width:calc(100vw - 24px)}.archive-range-summary{flex-wrap:wrap}.archive-range-summary b{font-size:15px}.archive-range-form .form-columns{gap:12px}}
</style>
