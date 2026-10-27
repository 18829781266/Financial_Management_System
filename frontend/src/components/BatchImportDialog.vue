<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue';
import type {ComputedRef} from 'vue';
import { ElMessage } from 'element-plus';
import { Upload, FileText, X, Trash2, CircleHelp, ArrowDownToLine } from 'lucide-vue-next';
import { parseVoucherFile, useArchiveStore } from '../store';
import type {VoucherPdfMetadata} from '../store';
import { validateMedia } from '../fileStorage';
import {amountCents} from '../money';
import {voucherInputIssues} from '../voucherValidation';
import type {FieldIssue} from '../voucherValidation';
import type { SourceDocument } from '../types';
import {expandImportFiles,createPdfSplitBatch} from '../importFiles';
import {createPdfTextReader} from '../pdfText';
import {checkImportAbort,yieldImportTurn} from '../importScheduling';
import {parseVoucherPages} from '../pdfVoucher';
import {parseDocumentPages} from '../pdfDocuments';
import type {PdfTextPage} from '../pdfText';
import type {ParsedPdfVoucher} from '../pdfVoucher';
const props=defineProps<{modelValue:boolean;kind:'vouchers'|'documents'}>();
const emit=defineEmits<{'update:modelValue':[boolean];imported:[]}>();
const input=ref<HTMLInputElement>();const busy=ref(false);const reading=ref(false);const progress=ref('');const progressPercent=ref(0);const errors=ref<string[]>([]);const dragged=ref(false);
let readController:AbortController|undefined;let unmounted=false;
onBeforeUnmount(()=>{unmounted=true;readController?.abort();});
interface Draft {key:string;kind:'voucher'|'document';origin:string;file?:File;no:string;period:string;date:string;summary:string;supplier:string;payeeName:string;payerAccount:string;payeeAccount:string;remarks:string;accountVersion?:number;entries?:unknown;amount:string;invoiceNo:string;contractNo:string;bankNo:string;approvalNo:string;expectedAttachments:string;type:SourceDocument['type'];seal:boolean;metadata?:VoucherPdfMetadata;sourceKind?:'pdf-text';sourcePages?:number[];reviewReasons:string[]}
const rows=ref<Draft[]>([]);const previewPage=ref(1);const previewPageSize=10;
const pagedRows=computed(()=>rows.value.slice((previewPage.value-1)*previewPageSize,previewPage.value*previewPageSize));
// 输入控件按可见页分帧挂载，避免几十行字段一次进入DOM阻塞滚动与按钮。
const visibleRowCount=ref(5);const visibleRows=computed(()=>pagedRows.value.slice(0,visibleRowCount.value));
let revealFrame=0,revealTimer:ReturnType<typeof setTimeout>|undefined;
function cancelPreviewReveal(){cancelAnimationFrame(revealFrame);if(revealTimer!==undefined)clearTimeout(revealTimer);}
watch([previewPage,()=>rows.value.length],()=>{cancelPreviewReveal();visibleRowCount.value=5;revealFrame=requestAnimationFrame(()=>{revealTimer=setTimeout(()=>{visibleRowCount.value=previewPageSize;},0);});});
onBeforeUnmount(cancelPreviewReveal);
const store=useArchiveStore();
const isVoucher=computed(()=>props.kind==='vouchers');
const voucherCount=computed(()=>rows.value.filter(r=>r.kind==='voucher').length);const documentCount=computed(()=>rows.value.length-voucherCount.value);
const mediaCount=computed(()=>rows.value.filter(r=>r.file).length);const extractedCount=computed(()=>rows.value.filter(r=>r.sourceKind==='pdf-text').length);
const showValidation=ref(false);
// 每行独立缓存校验，编辑一行不会重复校验几千条；单元格查询也不再线性扫描整批。
const rowValidations=new WeakMap<Draft,ComputedRef<FieldIssue[]>>();
function issuesFor(row:Draft):FieldIssue[]{
 let validation=rowValidations.get(row);
 if(!validation){
  validation=computed(()=>{
   const issues:FieldIssue[]=row.kind==='voucher'?voucherInputIssues({no:row.no,period:row.period,date:row.date,summary:row.summary,supplier:row.supplier,amount:row.amount,expectedAttachments:row.expectedAttachments},{requireDate:!!row.file,allowIncompletePdf:!!row.metadata}):[];
   if(row.kind==='document'&&row.amount.trim())try{if(amountCents(row.amount)<0)issues.push({field:'amount',message:'单据金额不能为负数'});}catch(e){issues.push({field:'amount',message:e instanceof Error?e.message:'请核对金额'});}
   if(row.kind==='document'&&row.date.trim()){const date=new Date(`${row.date}T00:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==row.date)issues.push({field:'date',message:'请填写真实日期 YYYY-MM-DD'});}
   return issues;
  });
  rowValidations.set(row,validation);
 }
 return validation.value;
}
const assessments=computed(()=>rows.value.map((row,index)=>({row,index,issues:issuesFor(row)})));
const displayErrors=computed(()=>{const invalid=showValidation.value?assessments.value.filter(x=>x.issues.length):[];return [...errors.value,...invalid.slice(0,5).map(item=>`第 ${item.index+1} 行（${item.row.origin}）：${item.issues.map(x=>x.message).join('；')}`),...(invalid.length>5?[`另有 ${invalid.length-5} 行待完善，请按校验状态逐页检查`]:[])];});
const incompleteCount=computed(()=>assessments.value.filter(x=>x.issues.length).length);
const amountSummary=computed(()=>{
 let cents=0,missing=0,invalid=0;
 for(const row of rows.value){if(!row.amount.trim()){missing++;continue;}try{const value=amountCents(row.amount);if((row.kind==='document'&&value<0)||(row.kind==='voucher'&&!row.metadata&&value<=0)){invalid++;continue;}cents+=value;}catch{invalid++;}}
 return {filled:rows.value.length-missing-invalid,total:Number.isSafeInteger(cents)?(cents/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):'超出精度范围',missing,invalid};
});
function hasIssue(row:Draft,field:string){return issuesFor(row).some(x=>x.field===field);}
function issueText(row:Draft,field:string){return issuesFor(row).find(x=>x.field===field)?.message||'';}
async function locateFirstIssue(){const first=assessments.value.find(x=>x.issues.length);if(!first)return;previewPage.value=Math.floor(first.index/previewPageSize)+1;showValidation.value=true;await nextTick();document.querySelector<HTMLInputElement>('.batch-import-dialog .invalid-field input')?.focus();}
watch(()=>props.modelValue,open=>{if(open){rows.value=[];errors.value=[];previewPage.value=1;showValidation.value=false;}else{readController?.abort();}});
function normalize(values:Record<string,unknown>,origin:string,file?:File,kind:Draft['kind']=isVoucher.value?'voucher':'document'):Draft{
 const read=(...keys:string[])=>String(keys.map(k=>values[k]).find(v=>v!==undefined&&v!==null&&v!=='')??'');
 const period=read('period','Period','期间');
 return {key:crypto.randomUUID(),kind,origin,file,no:read('no','voucherNo','VoucherNo','凭证号'),period,date:read('date','voucherDate','日期')||(!file&&period?period+'-01':''),summary:read('summary','abstract','Abstract','摘要'),supplier:read('payerName','supplier','supplierName','SupplierName','客商'),payeeName:read('payeeName'),payerAccount:read('payerAccount','付款账号'),payeeAccount:read('payeeAccount','收款账号'),remarks:read('remarks','备注'),accountVersion:values.accountVersion===1?1:undefined,entries:values.entries??values.Entries??values['分录'],amount:read('amount','Amount','金额'),invoiceNo:read('invoiceNo','number','发票号'),contractNo:read('contractNo','合同号'),bankNo:read('bankNo','bankFlowNo','银行流水号'),approvalNo:read('approvalNo','审批单号'),expectedAttachments:read('expectedAttachments','expectedAttachmentCount','附件数'),type:(read('type')||'invoice') as SourceDocument['type'],seal:false,reviewReasons:[]};
}
function cancelRead(){
 if(!readController||!reading.value)return;
 progress.value='正在取消本次读取…';
 readController.abort();
}
async function select(files:File[]){
 if(reading.value||busy.value)return;
 const controller=new AbortController();readController=controller;
 const signal=controller.signal;
 reading.value=true;errors.value=[];progress.value='正在展开文件…';progressPercent.value=0;
 const added:Draft[]=[];
 let textReader:ReturnType<typeof createPdfTextReader>|undefined;
 let splitter:ReturnType<typeof createPdfSplitBatch>|undefined;
 try{
  // 先让浏览器绘制进度和取消入口，然后开始读取；本次草稿仅在全部成功后合并。
  await yieldImportTurn(signal);
  const expanded=await expandImportFiles(files,{signal,onProgress:item=>{
   progress.value=`展开文件 ${item.completed} / ${item.total}：${item.name}`;
   progressPercent.value=Math.min(10,Math.round(item.completed/Math.max(item.total,1)*10));
  }});
  const pdfs=new Map<File,{pages:PdfTextPage[];vouchers:ParsedPdfVoucher[];drafts:Draft[]}>();
  const companies=new Set<string>();
  const checkLimits=()=>{
   if(rows.value.length+added.length>5000)throw new Error('单批最多 5000 行，请拆分文件后导入');
   if(rows.value.filter(row=>row.kind==='document').length+added.filter(row=>row.kind==='document').length>100)throw new Error('单批最多 100 份单据');
  };
  // 先识别各文件字段并收集凭证核算主体，不按压缩包目录猜客商。
  // 缓存凭证解析结果，后续分拆不再重复执行同一份文字坐标解析。
  for(const [index,item] of expanded.entries()){
   progress.value=`识别文件 ${index+1} / ${expanded.length}：${item.file.name}`;
   progressPercent.value=10+Math.round(index/expanded.length*45);
   await yieldImportTurn(signal);
   if(/\.(json|csv)$/i.test(item.file.name)){
    const records=await parseVoucherFile(item.file);checkImportAbort(signal);
    for(const [rowIndex,record] of records.entries()){
     added.push(normalize(record,`${item.origin} · 第 ${rowIndex+1} 行`,undefined,'voucher'));
     if(rowIndex%100===99)await yieldImportTurn(signal);
    }
    checkLimits();continue;
   }
   await validateMedia(item.file);checkImportAbort(signal);
   if(!/\.pdf$/i.test(item.file.name))continue;
   textReader??=createPdfTextReader({signal});
   const pages=await textReader.read(item.file,(completed,total)=>{
    progress.value=`识别文件 ${index+1} / ${expanded.length}：${item.file.name} · 第 ${completed} / ${total} 页`;
    progressPercent.value=10+Math.round((index+completed/Math.max(total,1))/expanded.length*45);
   });
   await yieldImportTurn(signal);
   const vouchers=parseVoucherPages(pages);
   const drafts:Draft[]=[];
   for(const voucher of vouchers){
    if(voucher.company)companies.add(voucher.company);
    const row=normalize({...voucher},`${item.origin} · 第 ${voucher.sourcePages.join('、')} 页`,undefined,'voucher');
    row.metadata={sourceKind:'pdf-text',sourcePages:voucher.sourcePages,company:voucher.company,entries:voucher.entries,reviewReasons:voucher.reviewReasons};
    row.sourceKind='pdf-text';row.sourcePages=voucher.sourcePages;row.reviewReasons=voucher.reviewReasons;added.push(row);drafts.push(row);
   }
   pdfs.set(item.file,{pages,vouchers,drafts});checkLimits();
  }
  textReader?.dispose();textReader=undefined;
  const ownCompany=companies.size===1?[...companies][0]:undefined;
  splitter=createPdfSplitBatch({signal});
  for(const [index,item] of expanded.entries()){
   progress.value=`整理影像 ${index+1} / ${expanded.length}：${item.file.name}`;
   progressPercent.value=55+Math.round(index/expanded.length*40);
   await yieldImportTurn(signal);
   if(/\.(json|csv)$/i.test(item.file.name))continue;
   const cached=pdfs.get(item.file);
   const documents=cached&&!cached.vouchers.length?parseDocumentPages(cached.pages,ownCompany):[];
   if(cached?.vouchers.length||documents.length){
    // 一个文件只打开一次源 PDF；后台顺序拆分所有凭证/回单后立即释放。
    const session=await splitter.open(item.file);
    try{
     if(cached?.vouchers.length){
      for(const [part,voucher] of cached.vouchers.entries()){
       cached.drafts[part]!.file=await session.split(voucher.sourcePages,voucher.no);
       progressPercent.value=55+Math.round((index+(part+1)/cached.vouchers.length)/expanded.length*40);
       await yieldImportTurn(signal);
      }
     }else{
      for(const [part,document] of documents.entries()){
       const split=await session.split(document.sourcePages,document.number||`单据${part+1}`,document.sourceRegion);
       const row=normalize({...document},`${item.origin} · 第 ${document.sourcePages.join('、')} 页`,split,'document');
       row.sourceKind='pdf-text';row.sourcePages=document.sourcePages;row.reviewReasons=document.reviewReasons;added.push(row);
       checkLimits();
       progressPercent.value=55+Math.round((index+(part+1)/documents.length)/expanded.length*40);
       await yieldImportTurn(signal);
      }
     }
    }finally{session.dispose();}
   }else{
    const row=normalize({},item.origin,item.file);row.reviewReasons=[cached?.pages.some(page=>page.items.length)?'此版式暂未识别，请对照原件补录':'未检测到可用文字层，请补录字段或接入 OCR'];added.push(row);checkLimits();
   }
   // 不保留已处理文件的文字坐标缓存，避免几十份原件在批次结束前持续占用内存。
   pdfs.delete(item.file);
  }
  checkLimits();checkImportAbort(signal);
  progress.value='正在整理待导入记录…';progressPercent.value=100;
  await yieldImportTurn(signal);
  if(readController!==controller||!props.modelValue||unmounted)return;
  rows.value.push(...added);previewPage.value=1;
 }catch(error){
  if(signal.aborted){
   if(!unmounted&&props.modelValue&&readController===controller)ElMessage.info('已取消本次读取，原有待导入记录已保留');
  }else if(readController===controller){errors.value=[error instanceof Error?error.message:'无法读取所选文件','本次选择未加入任何记录，请修正后重新选择。'];}
 }finally{
  textReader?.dispose();splitter?.dispose();
  if(readController===controller){readController=undefined;reading.value=false;progress.value='';progressPercent.value=0;if(input.value)input.value.value='';}
 }
}
function changed(e:Event){void select(Array.from((e.target as HTMLInputElement).files||[]));}
function dropped(e:DragEvent){dragged.value=false;void select(Array.from(e.dataTransfer?.files||[]));}
function remove(key:string){rows.value=rows.value.filter(r=>r.key!==key);previewPage.value=Math.min(previewPage.value,Math.max(1,Math.ceil(rows.value.length/previewPageSize)));}
function close(){if(busy.value||reading.value)return;emit('update:modelValue',false);}
async function submit(){
 if(!rows.value.length){errors.value=['请先选择文件'];return;}
 errors.value=[];showValidation.value=true;
 if(assessments.value.some(x=>x.issues.length)){await locateFirstIssue();return;}
 busy.value=true;
 try{
  const vouchers=rows.value.filter(r=>r.kind==='voucher').map(row=>({origin:row.origin,file:row.file,metadata:row.metadata,values:{...row}}));
  const documents=rows.value.filter(r=>r.kind==='document').map(row=>({file:row.file!,fields:{supplier:row.supplier,payerName:row.supplier,payeeName:row.payeeName,payerAccount:row.payerAccount,payeeAccount:row.payeeAccount,accountVersion:row.accountVersion,remarks:row.remarks,bankNo:row.bankNo,number:row.invoiceNo,amount:row.amount,date:row.date,type:row.type,seal:row.seal,sourceKind:row.sourceKind,sourcePages:row.sourcePages,reviewReasons:row.reviewReasons,extractionStatus:row.sourceKind==='pdf-text'?'pending' as const:undefined}}));
  const result=await store.importMixedBatch(vouchers,documents);
  ElMessage.success(`已导入 ${result.vouchers} 张凭证、${result.documents} 份单据${extractedCount.value?'，PDF 提取结果请从列表复核':''}`);
  emit('imported');emit('update:modelValue',false);
 }catch(e){errors.value=[e instanceof Error?e.message:'导入失败，请检查后重试'];}finally{busy.value=false;}
}
function template(format:'json'|'csv'){
 const records=[{no:'记-0101',period:'2026-10',date:'2026-10-20',summary:'采购技术服务',supplier:'示例科技有限公司',amount:1280,invoiceNo:'INV-0101',expectedAttachments:1},{no:'记-0102',period:'2026-10',date:'2026-10-20',summary:'采购办公用品',supplier:'示例文具有限公司',amount:360,invoiceNo:'INV-0102',expectedAttachments:1}];
 const content=format==='json'?JSON.stringify({vouchers:records},null,2):'\uFEFF'+Object.keys(records[0]!).join(',')+'\r\n'+records.map(r=>Object.values(r).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([content],{type:format==='json'?'application/json':'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`凭证批量导入模板.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const typeLabel=(row:Draft)=>row.kind==='voucher'?'记账凭证':({invoice:'发票',bank:'银行回单',contract:'合同',approval:'审批单'}[row.type]);
</script>
<template>
 <el-dialog :model-value="modelValue" @close="close" :close-on-click-modal="false" :close-on-press-escape="!busy&&!reading" :show-close="!busy&&!reading" :title="isVoucher?'批量导入凭证 / ZIP':'批量上传原始单据 / ZIP'" width="1220px" class="batch-import-dialog" destroy-on-close>
  <div class="info-banner"><CircleHelp :size="18"/><span>支持 ZIP 批量导入并自动区分凭证、发票和银行回单。文字型 PDF 提取金额、日期和分录，自动合并续页、分拆同页回单；扫描图片需补录或接入 OCR。导入成功后统一为待匹配；请到智能匹配页面点击开始自动匹配，未关联记录转为请复核。</span></div>
  <input ref="input" type="file" accept=".zip,.json,.csv,.pdf,.png,.jpg,.jpeg" multiple hidden @change="changed"/>
  <button :class="['upload-zone','compact',{dragged}]" :disabled="busy||reading" @click="input?.click()" @dragover.prevent="dragged=true" @dragleave.prevent="dragged=false" @drop.prevent="dropped"><Upload :size="27"/><strong>{{reading?progress:'点击或拖拽文件到此处，可直接选择压缩包'}}</strong><span>ZIP 最多 30 MB、展开最多 100 文件；JSON / CSV 每文件 10 MB，PDF / 图片每文件 20 MB</span></button>
  <div v-if="reading" class="batch-reading-progress" role="progressbar" aria-label="文件读取进度" :aria-valuenow="progressPercent" aria-valuemin="0" aria-valuemax="100"><div><span role="status" aria-live="polite">{{progress}}</span><button class="btn" :disabled="readController?.signal.aborted" @click="cancelRead">取消本次读取</button></div><el-progress :percentage="progressPercent" :stroke-width="6" :show-text="false"/></div>
  <div class="batch-summary"><span>待导入 <b>{{voucherCount}}</b> 张凭证 · <b>{{documentCount}}</b> 份单据 <small v-if="mediaCount">· {{mediaCount}} 份分拆或原始影像</small><small> · 金额合计 {{amountSummary.filled?'¥ '+amountSummary.total:'—'}}</small><small v-if="amountSummary.missing"> · {{amountSummary.missing}} 行金额未填写</small><small v-if="amountSummary.invalid" class="danger-text"> · {{amountSummary.invalid}} 行金额待修正</small></span><div><button class="text-link" @click="template('json')"><ArrowDownToLine :size="13"/>JSON 模板</button><button class="text-link" @click="template('csv')"><ArrowDownToLine :size="13"/>CSV 模板</button></div><button v-if="rows.length" class="text-link danger-text" :disabled="busy||reading" @click="rows=[]"><Trash2 :size="13"/>清空待导入</button></div>
  <div v-if="rows.length" class="validation-summary"><span>可导入 {{rows.length-incompleteCount}} 行<span v-if="incompleteCount"> · {{incompleteCount}} 行待补录或修正</span><span v-if="extractedCount"> · {{extractedCount}} 行文字已提取，导入后待匹配</span></span><button v-if="incompleteCount" class="text-link" @click="locateFirstIssue">定位待完善字段</button></div>
  <el-alert v-for="(error,i) in displayErrors" :key="i" :title="error" type="error" :closable="false" show-icon class="import-error"/>
  <div v-if="displayErrors.length" class="muted-text">失败批次不会写入任何数据；请修正后重试。</div>
  <el-table v-if="rows.length" :data="visibleRows" max-height="420" row-key="key" class="import-preview-table" size="small">
   <el-table-column type="index" :index="(index:number)=>(previewPage-1)*previewPageSize+index+1" width="45" label="#"/>
   <el-table-column label="文件 / 来源" width="190"><template #default="{row}"><div class="import-origin"><FileText :size="14"/><span :title="row.origin">{{row.origin}}</span></div><small class="muted-text">{{row.sourceKind==='pdf-text'?'PDF 文字已提取':row.file?'影像 · 需人工补录':'结构化数据'}}</small></template></el-table-column>
   <el-table-column label="类别" width="95"><template #default="{row}">{{typeLabel(row)}}</template></el-table-column>
   <el-table-column v-if="voucherCount" label="凭证号 *" width="120"><template #default="{row}"><el-input v-if="row.kind==='voucher'" :class="{'invalid-field':showValidation&&hasIssue(row,'no')}" :title="issueText(row,'no')" v-model="row.no" size="small" placeholder="记-0101" aria-label="凭证号"/><span v-else>—</span></template></el-table-column>
   <el-table-column v-if="voucherCount" label="期间 *" width="105"><template #default="{row}"><el-input v-if="row.kind==='voucher'" :class="{'invalid-field':showValidation&&hasIssue(row,'period')}" :title="issueText(row,'period')" v-model="row.period" size="small" placeholder="YYYY-MM" aria-label="期间"/><span v-else>—</span></template></el-table-column>
   <el-table-column label="日期" width="125"><template #default="{row}"><el-input :class="{'invalid-field':showValidation&&hasIssue(row,'date')}" :title="issueText(row,'date')" v-model="row.date" size="small" placeholder="YYYY-MM-DD" aria-label="日期"/></template></el-table-column>
   <el-table-column v-if="voucherCount" label="摘要 *" width="180"><template #default="{row}"><el-input v-if="row.kind==='voucher'" :class="{'invalid-field':showValidation&&hasIssue(row,'summary')}" :title="issueText(row,'summary')" v-model="row.summary" size="small" placeholder="凭证摘要" aria-label="摘要"/><span v-else>—</span></template></el-table-column>
   <el-table-column label="客商名称 / 付款人" width="200"><template #default="{row}"><el-input :class="{'invalid-field':showValidation&&hasIssue(row,'supplier')}" :title="issueText(row,'supplier')" v-model="row.supplier" size="small" placeholder="未提取，可稍后复核" aria-label="客商名称"/></template></el-table-column>
   <el-table-column v-if="documentCount" label="收款人" width="190"><template #default="{row}"><el-input v-if="row.kind==='document'" v-model="row.payeeName" size="small" placeholder="原件未列可留空" aria-label="收款人"/></template></el-table-column>
   <el-table-column v-if="documentCount" label="收款账号" width="200"><template #default="{row}"><el-input v-if="row.kind==='document'" v-model="row.payeeAccount" size="small" placeholder="完整账号或至少4位尾号" aria-label="收款账号"/></template></el-table-column><el-table-column label="金额（元）" width="150"><template #default="{row}"><el-input :class="{'invalid-field':showValidation&&hasIssue(row,'amount')}" :title="issueText(row,'amount')" v-model="row.amount" size="small" placeholder="未录入" aria-label="金额"/></template></el-table-column>
   <el-table-column label="发票号 / 单据编号" width="200"><template #default="{row}"><el-input v-model="row.invoiceNo" size="small" placeholder="未提取" aria-label="单据编号"/></template></el-table-column>
   <el-table-column v-if="documentCount" label="单据类型" width="125"><template #default="{row}"><el-select v-if="row.kind==='document'" v-model="row.type" size="small"><el-option label="发票" value="invoice"/><el-option label="银行回单" value="bank"/><el-option label="合同" value="contract"/><el-option label="审批单" value="approval"/></el-select></template></el-table-column>
   <el-table-column v-if="voucherCount" label="合同号" width="140"><template #default="{row}"><el-input v-if="row.kind==='voucher'" v-model="row.contractNo" size="small" aria-label="合同号"/></template></el-table-column>
   <el-table-column v-if="voucherCount" label="附件数" width="95"><template #default="{row}"><el-input v-if="row.kind==='voucher'" :class="{'invalid-field':showValidation&&hasIssue(row,'expectedAttachments')}" :title="issueText(row,'expectedAttachments')" v-model="row.expectedAttachments" size="small" placeholder="未知" aria-label="附件数"/></template></el-table-column>
   <el-table-column label="复核提示" width="220"><template #default="{row}"><span :title="row.reviewReasons.join('；')">{{row.reviewReasons.join('；')||'请对照原件核验字段'}}</span></template></el-table-column>
   <el-table-column label="校验状态" width="96" fixed="right"><template #default="{row}"><span :class="['status',issuesFor(row).length?'missing':row.sourceKind?'pending':'matched']">{{issuesFor(row).length?'待完善':row.sourceKind?'已提取':'可导入'}}</span></template></el-table-column>
   <el-table-column label="操作" width="64" fixed="right"><template #default="{row}"><button class="icon-btn" title="移除此行" :disabled="busy||reading" @click="remove(row.key)"><X :size="15"/></button></template></el-table-column>
  </el-table>
  <div v-else class="empty" style="min-height:90px">可直接选择包含凭证和原始单据的 ZIP 压缩包</div>
  <div v-if="rows.length>previewPageSize" class="import-paging"><span>共 {{rows.length}} 条，确认后导入全部记录</span><el-pagination v-model:current-page="previewPage" :page-size="previewPageSize" :total="rows.length" layout="prev, pager, next" small/></div>
  <template #footer><button class="btn" :disabled="busy||reading" @click="close">取消</button><button class="btn primary" :disabled="busy||reading||!rows.length" @click="submit">{{busy?'正在导入…':`确认导入（${rows.length}）`}}</button></template>
 </el-dialog>
</template>

<style scoped>
.batch-reading-progress{padding:12px 14px;margin-top:12px;border:1px solid #deebfb;border-radius:10px;background:#f4f8ff}.batch-reading-progress>div{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:10px}.batch-reading-progress span{min-width:0;color:#52749d;font-size:13px;line-height:1.7;overflow-wrap:anywhere}.batch-reading-progress .btn{flex:none;min-height:32px;font-size:12px}@media(max-width:600px){.batch-reading-progress{padding:11px}.batch-reading-progress>div{align-items:flex-start;gap:10px}.batch-reading-progress span{font-size:12px}.batch-reading-progress .btn{font-size:11px;padding:0 9px}}
</style>
