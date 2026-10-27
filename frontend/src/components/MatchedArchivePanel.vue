<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import {BookOpen,CheckCheck,ChevronLeft,ChevronRight,FileText,FolderArchive,GitBranch,Search} from 'lucide-vue-next';
import FlipBook from './FlipBook.vue';
import FeatureIcon from './FeatureIcon.vue';
import type {ArchiveRecord,MatchRun,PayerGroup,SourceDocument,Voucher} from '../types';
import {latestImported} from '../recordOrder';

const props=defineProps<{groups:PayerGroup[];vouchers:Voucher[];documents:SourceDocument[];run?:MatchRun;focusGroupId?:string}>();
const emit=defineEmits<{
 view:[record:Voucher|SourceDocument];
 review:[record:Voucher|SourceDocument];
 generate:[voucher:Voucher];
 reconcile:[voucher:Voucher];
 match:[];
}>();
const selectedGroupId=ref('');const selectedVoucherId=ref('');const query=ref('');
const voucherListPage=ref(1);const documentListPage=ref(1);const listPageSize=6;
const previewSection=ref<HTMLElement>();
watch(()=>props.run?.id,()=>{selectedGroupId.value='';query.value='';});
watch(()=>props.focusGroupId,id=>{if(id)selectedGroupId.value=id;},{immediate:true});
const book=ref<InstanceType<typeof FlipBook>>();const currentPage=ref(0);const totalPages=ref(0);
const money=(value:number)=>value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const typeLabel=(type:SourceDocument['type'])=>({invoice:'发票',bank:'银行回单',contract:'合同',approval:'审批单'}[type]);
const payer=(document:SourceDocument)=>document.payerName??document.supplier;
// 档案展示以实时双边关联为准。旧版本分组曾包含同付款人的未关联单据，
// 因此不能直接信任分组中的 documentIds / voucherIds 作为归档依据。
const archivedVouchers=computed(()=>{
 const matchedDocuments=new Set(props.documents.filter(document=>document.status==='matched').map(document=>document.id));
 return props.vouchers.filter(voucher=>(voucher.status==='matched'||!!voucher.entryAttachments?.length)&&voucher.documentIds.length>0&&voucher.documentIds.every(id=>matchedDocuments.has(id)));
});
const archiveGroups=computed(()=>props.groups.flatMap(group=>{
 if(group.associationType==='name'){
  const voucherIds=group.voucherIds.filter(id=>props.vouchers.some(voucher=>voucher.id===id&&voucher.nameAssociationIds?.includes(group.id)));
  const documentIds=group.documentIds.filter(id=>props.documents.some(document=>document.id===id&&document.nameAssociationIds?.includes(group.id)));
  return (group.voucherIds.length?voucherIds.length&&documentIds.length:documentIds.length>=2)?[{...group,voucherIds,documentIds}]:[];
 }
 const vouchers=archivedVouchers.value.filter(voucher=>voucher.period===group.period&&voucher.documentIds.some(id=>group.documentIds.includes(id)));
 const relatedIds=new Set(vouchers.flatMap(voucher=>voucher.documentIds));
 const documentIds=group.documentIds.filter(id=>relatedIds.has(id)&&props.documents.some(document=>document.id===id&&document.status==='matched'));
 return documentIds.length&&vouchers.length?[{...group,payerName:group.needsPayerReview?'付款人未录入':group.payerName,documentIds,voucherIds:vouchers.map(voucher=>voucher.id)}]:[];
}));
const filteredGroups=computed(()=>{
 const order=new Map(latestImported(props.documents,'prepend').map((document,index)=>[document.id,index]));
 const rank=(group:PayerGroup)=>Math.min(...group.documentIds.map(id=>order.get(id)??Number.MAX_SAFE_INTEGER));
 return archiveGroups.value.filter(group=>`${group.payerName} ${group.period}`.toLowerCase().includes(query.value.trim().toLowerCase())).sort((a,b)=>rank(a)-rank(b)||b.period.localeCompare(a.period));
});
const archivedDocumentCount=computed(()=>new Set(archiveGroups.value.flatMap(group=>group.documentIds)).size);
const selectedGroup=computed(()=>filteredGroups.value.find(group=>group.id===selectedGroupId.value)||filteredGroups.value[0]);
const groupDocuments=computed(()=>{
 const ids=new Set(selectedGroup.value?.documentIds||[]);
 return latestImported(props.documents.filter(document=>ids.has(document.id)),'prepend');
});
const matchedVouchers=computed(()=>{
 const ids=new Set(selectedGroup.value?.voucherIds||[]),documentIds=new Set(groupDocuments.value.map(document=>document.id));
 return latestImported(selectedGroup.value?.associationType==='name'?props.vouchers.filter(voucher=>ids.has(voucher.id)):archivedVouchers.value.filter(voucher=>ids.has(voucher.id)&&voucher.documentIds.some(id=>documentIds.has(id))),'append');
});
// 列表分页只控制展示，不裁剪预览记录或关联数据；翻到任何一页仍可查看、核对原件。
const pagedVouchers=computed(()=>matchedVouchers.value.slice((voucherListPage.value-1)*listPageSize,voucherListPage.value*listPageSize));
const pagedDocuments=computed(()=>groupDocuments.value.slice((documentListPage.value-1)*listPageSize,documentListPage.value*listPageSize));
watch(()=>matchedVouchers.value.length,length=>{voucherListPage.value=Math.min(voucherListPage.value,Math.max(1,Math.ceil(length/listPageSize)));});
watch(()=>groupDocuments.value.length,length=>{documentListPage.value=Math.min(documentListPage.value,Math.max(1,Math.ceil(length/listPageSize)));});
watch(selectedVoucherId,id=>{
 const index=matchedVouchers.value.findIndex(voucher=>voucher.id===id);
 if(index>=0)voucherListPage.value=Math.floor(index/listPageSize)+1;
});
const selectedVoucher=computed(()=>matchedVouchers.value.find(voucher=>voucher.id===selectedVoucherId.value));
const sums=computed(()=>{
 const types:SourceDocument['type'][]=['invoice','bank','contract','approval'];
 return types.map(type=>{const documents=groupDocuments.value.filter(document=>document.type===type);return {type,count:documents.length,amount:documents.reduce((sum,document)=>sum+Math.round(document.amount*100),0)/100};}).filter(item=>item.count>0);
});
const records=computed<ArchiveRecord[]>(()=>{
 const voucher=selectedVoucher.value;
 const documents=voucher?voucher.documentIds.flatMap(id=>{const document=props.documents.find(candidate=>candidate.id===id&&candidate.status==='matched');return document?[document]:[];}):groupDocuments.value;
 const evidence:ArchiveRecord[]=documents.map(document=>({kind:'document',no:document.number||'未录入编号',date:document.date,supplier:payer(document),amount:document.amount,summary:`${typeLabel(document.type)} · ${document.name}`,fileId:document.fileId,fileName:document.name}));
 const information=(item:Voucher):ArchiveRecord=>({kind:'voucher',no:item.no,date:item.date,supplier:item.supplier,amount:item.amount,summary:item.summary,fileId:item.fileId,fileName:item.fileName});
 if(selectedGroup.value?.associationType==='name')return voucher?[information(voucher),...evidence]:[...matchedVouchers.value.map(information),...evidence];
 return voucher?[information(voucher),...evidence]:evidence;
});
const previewKey=computed(()=>`${selectedGroup.value?.id||''}/${selectedVoucherId.value}/${records.value.map(record=>`${record.kind}:${record.no}:${record.fileId||''}`).join('|')}`);
watch(()=>selectedGroup.value?.id,()=>{voucherListPage.value=1;documentListPage.value=1;selectedVoucherId.value=selectedGroup.value?.associationType==='name'?'':matchedVouchers.value[0]?.id||'';currentPage.value=0;},{immediate:true});
watch(()=>matchedVouchers.value.map(voucher=>voucher.id).join('|'),()=>{
 if(selectedVoucherId.value&&!matchedVouchers.value.some(voucher=>voucher.id===selectedVoucherId.value))selectedVoucherId.value='';
});
watch(previewKey,()=>{currentPage.value=0;totalPages.value=records.value.length;});
function jumpToPreview(){previewSection.value?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}
function groupCount(group:PayerGroup){return group.documentIds.filter(id=>props.documents.some(document=>document.id===id)).length;}
function voucherCount(group:PayerGroup){return group.voucherIds.filter(id=>props.vouchers.some(voucher=>voucher.id===id&&(voucher.status==='matched'||voucher.entryAttachments?.length||voucher.nameAssociationIds?.includes(group.id)))).length;}
</script>

<template>
 <section class="matched-archive-panel">
  <div v-if="archiveGroups.length" class="draft-notice"><FolderArchive :size="21"/><div><strong>已关联数据已同步展示</strong><p>按分录金额、收款账号及日期核对附件；部分关联的凭证仍需人工复核，完成后可生成正式档案册。</p></div><span class="status matched">已匹配归档</span></div>
  <div v-if="run&&archiveGroups.length" class="match-run-summary"><span><GitBranch :size="16"/>最近执行 {{run.time}}</span><span>已匹配归档 <b>{{archivedDocumentCount}}</b> 份单据</span><span>已关联归档 <b>{{archiveGroups.length}}</b> 组</span></div>
  <div v-if="!archiveGroups.length" class="draft-empty"><FeatureIcon name="archives" :size="82"/><h3>暂无已匹配归档数据</h3><p>请先点击“开始自动匹配”。未关联的数据留在复核池，人工复核并完成关联后才会展示。</p><button class="btn primary" @click="emit('match')"><GitBranch :size="16"/>前往智能匹配</button></div>
  <div v-else class="draft-layout">
   <aside class="payer-groups"><div class="payer-groups-toolbar"><div class="payer-groups-heading"><h3>已关联归档</h3><span>{{archiveGroups.length}} 组</span></div><label class="payer-group-search"><Search :size="16"/><input v-model="query" aria-label="搜索已关联档案" placeholder="搜索付款人、期间"/></label></div>
    <div class="payer-group-list" role="group" aria-label="已关联归档分组"><button v-for="group in filteredGroups" :key="group.id" :class="['payer-group',{selected:selectedGroup?.id===group.id}]" :aria-pressed="selectedGroup?.id===group.id" @click="selectedGroupId=group.id"><span class="group-period">{{group.period}}</span><strong>{{group.payerName||'已关联单据'}}</strong><span>{{groupCount(group)}} 份单据 · {{voucherCount(group)}} 张凭证 · {{group.associationType==='name'?'企业名称关联':'凭证关联'}}</span></button><p v-if="!filteredGroups.length" class="draft-no-results">未找到符合条件的付款人</p></div>
   </aside>
   <div v-if="selectedGroup" class="payer-draft">
    <header class="payer-draft-heading"><div><span class="group-period">{{selectedGroup.period}} · {{selectedGroup.associationType==='name'?'企业名称关联':'已匹配归档'}}</span><h3>{{selectedGroup.payerName||'已关联单据'}}</h3></div><div class="payer-draft-actions"><span class="draft-tag">{{groupDocuments.length}} 份单据 · {{matchedVouchers.length}} 张凭证</span><button v-if="records.length" class="btn preview-jump" @click="jumpToPreview"><BookOpen :size="16"/>查看原件预览</button></div></header>
    <div class="type-totals"><div v-for="sum in sums" :key="sum.type"><span>{{typeLabel(sum.type)}} <small>{{sum.count}} 份</small></span><strong>¥ {{money(sum.amount)}}</strong></div></div><p class="totals-caption">各类单据分别汇总；发票与对应回单不重复累计为凭证金额。</p>
    <section v-if="matchedVouchers.length" class="linked-vouchers">
     <div class="draft-section-title"><h4><CheckCheck :size="17"/>已匹配归档凭证 <span class="section-count">{{matchedVouchers.length}}</span></h4><span>仅展示已关联数据 · 每页 {{listPageSize}} 张</span></div>
     <div class="linked-voucher-header" aria-hidden="true"><span>凭证号</span><span>匹配依据</span><span class="voucher-amount-heading">金额（元）</span><span class="voucher-actions-heading">操作</span></div>
     <div class="linked-voucher-list" role="list" aria-label="已匹配归档凭证">
      <div v-for="voucher in pagedVouchers" :key="voucher.id" :class="['linked-voucher',{'is-selected':selectedVoucherId===voucher.id}]" role="listitem">
       <button :class="['voucher-number',{chosen:selectedVoucherId===voucher.id}]" :title="voucher.no" @click="selectedVoucherId=voucher.id"><FileText :size="16"/>{{voucher.no}}</button>
       <span class="voucher-rule">{{voucher.entryAttachments?.length?(voucher.attachmentReviewRequired?'部分关联 · 请复核':voucher.ruleId||'分录关联'):voucher.status==='matched'?voucher.ruleId||'手工关联':selectedGroup.ruleId+' · 名称关联'}}</span>
       <strong class="voucher-amount">¥ {{money(voucher.amount)}}</strong>
       <div class="linked-voucher-actions">
        <button v-if="voucher.reviewStatus==='pending'" class="text-link review-link" @click="emit('review',voucher)">核对字段</button>
        <button class="text-link" @click="emit('view',voucher)">查看原件</button>
        <button v-if="voucher.status==='matched'" class="btn" @click="emit('generate',voucher)">生成正式档案册</button>
        <button class="btn" @click="emit('reconcile',voucher)">核对凭证附件</button>
       </div>
      </div>
     </div>
     <div class="archive-list-footer"><span>共 {{matchedVouchers.length}} 张凭证</span><el-pagination v-if="matchedVouchers.length>listPageSize" class="voucher-pagination" v-model:current-page="voucherListPage" :page-size="listPageSize" :total="matchedVouchers.length" :pager-count="5" layout="prev, pager, next" size="small" aria-label="关联凭证分页"/></div>
    </section>
    <div class="draft-section-title documents-heading"><h4><FileText :size="17"/>已关联单据 <span class="section-count">{{groupDocuments.length}}</span></h4><span>付款人名称取自原始单据</span></div>
    <el-table :data="pagedDocuments" row-key="id" class="draft-documents" size="default" :max-height="360"><el-table-column label="单据 / 编号" min-width="230"><template #default="{row}"><button class="draft-document-name" :title="row.name" @click="emit('view',row)">{{row.name}}</button><small class="document-number">{{row.number||'编号未录入'}}</small></template></el-table-column><el-table-column label="类型" width="112"><template #default="{row}">{{typeLabel(row.type)}}</template></el-table-column><el-table-column label="付款人（客商）" min-width="190"><template #default="{row}"><span class="party-name">{{payer(row)||'未录入'}}</span></template></el-table-column><el-table-column label="收款人" min-width="190"><template #default="{row}">{{row.payeeName||'未录入'}}</template></el-table-column><el-table-column label="收款账号" min-width="170"><template #default="{row}">{{row.payeeAccount||'未录入'}}</template></el-table-column><el-table-column prop="date" label="日期" width="125"/><el-table-column label="备注" min-width="220"><template #default="{row}"><span style="white-space:pre-wrap">{{row.remarks||'—'}}</span></template></el-table-column><el-table-column label="金额（元）" width="145" align="right"><template #default="{row}"><span class="amount-cell">{{money(row.amount)}}</span></template></el-table-column><el-table-column label="匹配状态" width="135"><template #default><span class="status matched">已匹配归档</span></template></el-table-column><el-table-column label="操作" width="170"><template #default="{row}"><button class="text-link" @click="emit('view',row)">查看原件</button><button v-if="row.extractionStatus==='pending'" class="text-link review-link" @click="emit('review',row)">核对字段</button></template></el-table-column></el-table>
    <div class="archive-list-footer documents-footer"><span>共 {{groupDocuments.length}} 份单据</span><el-pagination v-if="groupDocuments.length>listPageSize" class="document-pagination" v-model:current-page="documentListPage" :page-size="listPageSize" :total="groupDocuments.length" :pager-count="5" layout="prev, pager, next" size="small" aria-label="关联单据分页"/></div>
    <section v-if="records.length" ref="previewSection" class="draft-preview"><div class="draft-preview-heading"><div><h4><BookOpen :size="17"/>原始单据预览</h4><p>直接翻阅上传的 PDF / 图片，保留各银行原始版式；多页原件按页展示。</p></div><el-select v-if="matchedVouchers.length" v-model="selectedVoucherId" aria-label="已关联档案预览范围" style="width:215px"><el-option :label="selectedGroup.associationType==='name'?'企业全部凭证与单据':'全部已关联单据'" value=""/><el-option v-for="voucher in matchedVouchers" :key="voucher.id" :label="voucher.no+(voucher.status==='matched'?' · 凭证及附件':' · 原始凭证')" :value="voucher.id"/></el-select><span v-else class="draft-tag">全部 {{groupDocuments.length}} 份已关联原件</span></div>
     <div class="draft-flip-container"><FlipBook :key="previewKey" ref="book" :title="selectedGroup.payerName+' · 已匹配归档'" :period="selectedGroup.period" :records="records" @page-change="event=>{currentPage=event.page;totalPages=event.total}"/></div>
     <div v-if="totalPages>1" class="draft-page-controls"><button class="icon-btn" :disabled="currentPage<=0" aria-label="工作稿上一页" @click="book?.prev()"><ChevronLeft :size="19"/></button><span>{{currentPage+1}} / {{totalPages||records.length}}</span><button class="icon-btn" :disabled="currentPage>=totalPages-1" aria-label="工作稿下一页" @click="book?.next()"><ChevronRight :size="19"/></button></div>
    </section>
   </div>
  </div>

 </section>
</template>

<style scoped>
.matched-archive-panel{font-size:13px;color:#506985}.draft-notice{display:flex;align-items:center;gap:12px;padding:17px 19px;border:1px solid #dbe8fb;border-radius:11px;background:#eff6ff;color:#3c6599;margin-bottom:15px}.draft-notice>div{flex:1;min-width:0}.draft-notice strong{font-size:15px;font-weight:650;color:#2b5388}.draft-notice p{font-size:12px;line-height:1.8;margin-top:5px;color:#6c83a3}.draft-tag{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;font-size:12px;font-weight:600;line-height:26px;padding:0 9px;border:1px solid #dfdfcf;border-radius:6px;background:#fffbef;color:#94723c}.match-run-summary{display:flex;align-items:center;gap:22px;flex-wrap:wrap;padding:3px 2px 18px;font-size:12px;color:#7a8ba2}.match-run-summary>span{display:inline-flex;align-items:center;gap:6px}.match-run-summary b{font-size:14px;color:#3268ad}.draft-layout{display:grid;grid-template-columns:250px minmax(0,1fr);border:1px solid #e0e8f3;border-radius:12px;overflow:hidden;background:#fff}.payer-groups{min-width:0;background:#fbfcff;border-right:1px solid #e6edf6}.payer-groups-heading{display:flex;justify-content:space-between;align-items:center;padding:19px 17px 14px}.payer-groups-heading h3{font-size:15px;font-weight:650;color:#365780}.payer-groups-heading>span{font-size:12px;color:#8191a7}.payer-group-search{display:flex;align-items:center;gap:7px;padding:8px 10px;margin:0 13px 14px;border:1px solid #e0e7f2;border-radius:8px;color:#91a1b8;background:#fff}.payer-group-search input{width:100%;background:transparent;border:0;font-size:12px;color:#536f94}.payer-group-search input::placeholder{color:#91a0b6}.payer-group-list{max-height:930px;overflow:auto;padding:0 10px 14px}.payer-group{display:flex;flex-direction:column;gap:8px;width:100%;text-align:left;border:1px solid transparent;border-radius:9px;padding:13px 12px;margin-bottom:7px;background:transparent;line-height:1.7}.payer-group:hover{background:#f1f6fe}.payer-group.selected{border-color:#c2d8f9;background:#eef5ff}.group-period{font-size:11px;color:#7d91af}.payer-group strong{font-size:13px;font-weight:600;color:#3f608c;overflow-wrap:anywhere}.payer-group.selected strong{color:#2466ba}.payer-group>span:last-child{font-size:12px;color:#7a90ae}.payer-draft{min-width:0;overflow:hidden}.payer-draft-heading{display:flex;align-items:center;justify-content:space-between;padding:20px 21px;border-bottom:1px solid #edf2f7;gap:15px}.payer-draft-heading h3{font-size:18px;line-height:1.6;font-weight:650;color:#2d4d78;margin-top:4px;overflow-wrap:anywhere}.type-totals{display:flex;gap:12px;flex-wrap:wrap;padding:19px 20px 9px}.type-totals>div{flex:1 1 135px;min-width:0;border:1px solid #e6edf7;border-radius:9px;padding:13px;background:#f9fbff}.type-totals span{display:block;color:#617b9e;font-size:12px}.type-totals small{margin-left:7px;color:#8a9db8;font-size:11px}.type-totals strong{display:block;margin-top:10px;color:#2f5485;font-size:18px;line-height:1.5;letter-spacing:.1px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.totals-caption{font-size:12px;line-height:1.8;color:#8696ac;padding:0 21px 17px}.draft-section-title{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.draft-section-title h4,.draft-preview-heading h4{display:flex;align-items:center;gap:7px;color:#355983;font-size:14px;font-weight:650}.draft-section-title>span{font-size:12px;color:#8899af}.linked-vouchers{margin:0 20px 19px;padding:16px;border:1px solid #e1ebf8;border-radius:9px;background:#fcfdff}.voucher-number.chosen{text-decoration:underline;text-underline-offset:4px}.review-link{color:#b7782d;white-space:nowrap}.no-linked-voucher{display:flex;gap:9px;margin:0 20px 18px;border:1px dashed #dde6f2;background:#fafcff;border-radius:8px;padding:13px 14px;line-height:1.9;font-size:12px;color:#7b90ad}.documents-heading{padding:0 21px 15px}.draft-document-name{font-size:13px;font-weight:600;color:#3b6aa6;line-height:1.7;text-align:left;padding:0;overflow-wrap:anywhere}.document-number{display:block;font-size:12px;line-height:1.8;color:#8a9cb6;overflow-wrap:anywhere}.party-name{font-weight:500;color:#46668c}.reviewed-label{font-size:12px;color:#5f937c}.draft-documents{width:100%}.draft-preview{margin-top:18px;border-top:1px solid #e5edf6}.draft-preview-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:19px 21px;flex-wrap:wrap}.draft-preview-heading p{font-size:12px;color:#8a9cb5;line-height:1.8;margin-top:6px}.draft-flip-container{padding:18px 12px 20px;background:radial-gradient(ellipse at 50% 35%,#f8fafd,#eef2f8)}.draft-page-controls{display:flex;gap:15px;align-items:center;justify-content:center;padding:12px;border-top:1px solid #e7edf6}.draft-page-controls>span{font-size:12px;min-width:50px;text-align:center;color:#6883a7;font-variant-numeric:tabular-nums}.draft-single-sheet{width:min(100% - 24px,410px);aspect-ratio:340/455;margin:0 auto 20px;border:1px solid #e4e6e8;box-shadow:0 5px 15px #384b6410}.draft-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:55px 24px;border:1px solid #e3eaf4;border-radius:12px;background:#fff;color:#97abc8}.draft-empty h3{font-size:17px;color:#526e95;margin:18px 0 9px}.draft-empty p{max-width:470px;font-size:13px;line-height:1.9;color:#8497b2;margin-bottom:23px}.draft-no-results{font-size:12px;line-height:1.8;padding:20px 8px;text-align:center;color:#8b9db5}.unresolved-run{margin-top:18px;border:1px solid #e2e9f3;border-radius:10px;background:#fff;overflow:hidden}.unresolved-run summary{cursor:pointer;padding:17px 19px;color:#496b97;font-size:14px;font-weight:600;line-height:1.7}.unresolved-run summary>span{font-size:12px;color:#8b9db7;font-weight:400;margin-left:12px}.unresolved-voucher{display:flex;align-items:flex-start;gap:17px;padding:14px 20px;border-top:1px solid #edf2f8;line-height:1.8}.unresolved-voucher>span{font-size:13px;color:#738aa8;flex:1;min-width:0}.unresolved-voucher .voucher-number{white-space:nowrap;margin-top:1px}
@media(max-width:1100px){.draft-layout{grid-template-columns:210px minmax(0,1fr)}.payer-group-list{padding-left:7px;padding-right:7px}.payer-group{padding-left:9px;padding-right:9px}.payer-draft-heading,.draft-preview-heading{padding-left:16px;padding-right:16px}.type-totals{padding-left:15px;padding-right:15px}.type-totals strong{font-size:16px}.linked-vouchers{margin-left:15px;margin-right:15px}.draft-section-title>span{font-size:11px}}
@media(max-width:760px){.draft-notice{padding:14px;align-items:flex-start}.draft-notice strong{font-size:14px}.draft-notice p{font-size:12px}.draft-notice>.draft-tag{font-size:11px;padding:0 6px}.match-run-summary{gap:10px 17px;line-height:1.7}.draft-layout{grid-template-columns:1fr}.payer-groups{border-right:0;border-bottom:1px solid #e5edf7}.payer-groups-heading{padding:15px 14px 10px}.payer-group-search{margin-bottom:11px}.payer-group-list{display:flex;gap:9px;max-height:none;overflow-x:auto;padding:0 12px 13px}.payer-group{flex:0 0 220px;max-width:220px;margin:0;padding:11px}.payer-draft-heading{padding:17px 15px}.payer-draft-heading h3{font-size:16px}.type-totals{gap:9px;padding:14px 13px 9px}.type-totals>div{padding:11px;flex-basis:115px}.type-totals strong{font-size:15px}.totals-caption{font-size:11px;padding:0 14px 15px}.linked-vouchers{padding:13px;margin:0 13px 16px}.draft-section-title h4,.draft-preview-heading h4{font-size:13px}.draft-section-title>span{font-size:11px}.no-linked-voucher{margin-left:13px;margin-right:13px;padding:11px;font-size:12px}.documents-heading{padding:0 14px 13px}.draft-preview-heading{padding:16px 14px}.draft-preview-heading p{font-size:11px}.draft-flip-container{padding:13px 8px 15px}.unresolved-run summary{font-size:13px;padding:15px}.unresolved-voucher{padding:13px 14px;gap:10px;flex-wrap:wrap}.unresolved-voucher>span{font-size:12px;flex-basis:calc(100% - 100px)}.draft-empty{padding:40px 17px}.draft-empty p{font-size:12px}}

/* 分组作为顶部横向导航，避免仅有一组时产生贯穿整页的侧边留白。 */
.draft-layout{display:block}.payer-groups{border-right:0;border-bottom:1px solid #e5edf7;padding:15px 18px 12px}.payer-groups-toolbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:12px}.payer-groups-heading{padding:0;gap:11px}.payer-groups-heading>span{background:#eaf0fa;border-radius:5px;padding:3px 7px;white-space:nowrap}.payer-group-search{width:265px;min-width:0;margin:0;padding:8px 11px}.payer-group-list{display:flex;gap:10px;max-height:143px;overflow-x:auto;overflow-y:auto;padding:0 0 3px;scrollbar-width:thin;scrollbar-color:#cad8eb transparent}.payer-group{flex:0 0 300px;max-width:350px;gap:3px;margin:0;padding:10px 13px;border-color:#e2eaf5;background:#fff}.payer-group strong{font-size:14px;line-height:1.6}.payer-group>span:last-child{font-size:11px}.payer-group:only-of-type{display:grid;grid-template-columns:65px minmax(0,1fr) auto;align-items:center;gap:12px;flex-basis:100%;max-width:none}.payer-group:only-of-type>span:last-child{white-space:nowrap}.payer-draft-heading{padding:18px 20px 14px;border-bottom:0;align-items:center}.payer-draft-heading h3{margin-top:2px}.payer-draft-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}.payer-draft-actions .draft-tag{font-size:11px}.preview-jump{min-height:34px;font-size:12px}.type-totals{padding-top:3px;padding-bottom:7px;gap:10px}.type-totals>div{display:flex;align-items:center;justify-content:space-between;gap:15px;flex-basis:220px;padding:11px 14px}.type-totals strong{margin:0;font-size:19px}.type-totals span{white-space:nowrap}.totals-caption{padding-bottom:14px;font-size:11px}.linked-vouchers{padding:14px;margin-bottom:15px}.section-count{display:inline-flex;align-items:center;justify-content:center;min-width:23px;height:21px;padding:0 6px;background:#edf3fc;color:#4b79b7;border-radius:5px;font-size:11px;font-weight:600}.archive-list-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:35px;margin-top:10px;font-size:12px;color:#7a8fa9}.archive-list-footer :deep(.el-pagination){flex-shrink:0}.documents-heading{padding-bottom:12px}.draft-documents :deep(.el-table__cell){padding-top:10px;padding-bottom:10px}.draft-document-name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:13px;line-height:1.6}.document-number{font-size:11px}.documents-footer{margin:0;padding:11px 20px;border-top:1px solid #edf1f7}.draft-preview{margin-top:0;scroll-margin-top:150px}.draft-preview-heading{padding-top:16px;padding-bottom:15px}.draft-notice{padding:13px 17px;margin-bottom:12px}.draft-notice p{margin-top:3px}.match-run-summary{padding-bottom:14px}
@media(max-width:1100px){.payer-draft-actions{gap:7px}.payer-draft-actions .draft-tag{display:none}.type-totals>div{padding:10px 12px}.type-totals strong{font-size:18px}}
@media(max-width:760px){.payer-groups{padding:13px 12px 10px}.payer-groups-toolbar{gap:9px;flex-wrap:wrap;margin-bottom:10px}.payer-groups-heading{padding:0}.payer-groups-heading h3{font-size:14px}.payer-group-search{width:100%;margin:0}.payer-group-list{padding:0 0 3px;max-height:130px}.payer-group{flex-basis:245px;max-width:265px;padding:10px 12px}.payer-group:only-of-type{display:flex;align-items:flex-start;gap:3px;max-width:none}.payer-group:only-of-type>span:last-child{white-space:normal}.payer-group strong{font-size:13px}.payer-draft-heading{padding:16px 14px 12px;align-items:flex-start;gap:10px;flex-wrap:wrap}.payer-draft-heading h3{font-size:17px}.payer-draft-actions{justify-content:flex-start}.preview-jump{min-height:33px;font-size:11px}.type-totals{padding-top:0}.type-totals>div{gap:10px;padding:10px 12px;flex-basis:100%}.type-totals strong{font-size:17px}.linked-vouchers{padding:12px;margin:0 13px 13px}.archive-list-footer{font-size:11px;gap:6px;flex-wrap:wrap}.documents-footer{padding:10px 14px}.draft-preview{scroll-margin-top:205px}.draft-notice>span.status{display:none}}

/* 凭证逐条纵向排列；桌面按列对齐，窄屏分层显示，金额与操作不挤占。 */
.linked-voucher-header,.linked-voucher{display:grid;grid-template-columns:minmax(105px,1fr) minmax(110px,.95fr) minmax(160px,1.15fr) minmax(280px,1.75fr);align-items:center;gap:16px;padding:13px 14px}
.linked-voucher-header{margin-top:13px;background:#f1f5fb;border:1px solid #e5edf7;border-radius:8px 8px 0 0;font-size:12px;font-weight:600;color:#7186a1}
.voucher-amount-heading,.voucher-actions-heading{text-align:right}
.linked-voucher-list{border:1px solid #e5edf7;border-top:0;border-radius:0 0 8px 8px;overflow:hidden;background:#fff}
.linked-voucher{min-width:0;min-height:60px;border-bottom:1px solid #edf1f7;transition:background-color .18s}
.linked-voucher:last-child{border-bottom:0}.linked-voucher:hover{background:#f7faff}.linked-voucher.is-selected{background:#edf4ff}
.linked-voucher>.voucher-number{display:inline-flex;align-items:center;gap:7px;min-width:0;justify-self:start;text-align:left;font-size:14px;font-weight:650;overflow-wrap:anywhere;line-height:1.6}
.voucher-rule{min-width:0;font-size:12px;color:#6d83a0;line-height:1.7;overflow-wrap:anywhere}
.voucher-amount{min-width:0;text-align:right;font-size:16px;color:#2f5686;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.linked-voucher-actions{display:flex;justify-content:flex-end;align-items:center;gap:10px;min-width:0;flex-wrap:wrap}
.linked-voucher-actions .text-link{font-size:12px;padding:3px 0;white-space:nowrap}.linked-voucher-actions .btn{min-height:31px;padding:0 10px;font-size:12px;white-space:nowrap}
@media(max-width:1000px){.linked-voucher-header{display:none}.linked-voucher-list{margin-top:12px;border-top:1px solid #e5edf7;border-radius:8px}.linked-voucher{grid-template-columns:minmax(100px,1fr) minmax(260px,1.5fr);gap:5px 16px;padding:13px}.linked-voucher>.voucher-number{grid-column:1;grid-row:1}.voucher-rule{grid-column:1;grid-row:2}.voucher-amount{grid-column:2;grid-row:1}.linked-voucher-actions{grid-column:2;grid-row:2}}
@media(max-width:760px){.linked-voucher{grid-template-columns:minmax(0,1fr) auto;gap:8px 10px;padding:13px 11px}.linked-voucher>.voucher-number{font-size:14px;grid-column:1;grid-row:1}.voucher-rule{grid-column:2;grid-row:1;text-align:right;font-size:11px}.voucher-amount{grid-column:1/3;grid-row:2;text-align:left;font-size:15px}.linked-voucher-actions{grid-column:1/3;grid-row:3;gap:8px 12px}.linked-voucher-actions .btn{min-height:30px;font-size:11px}.linked-voucher-list{margin-top:11px}}
@media(prefers-reduced-motion:reduce){.linked-voucher{transition:none}}
</style>
