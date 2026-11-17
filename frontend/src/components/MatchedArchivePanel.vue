<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import {BookOpen,CheckCheck,ChevronLeft,ChevronRight,FileText,GitBranch,Search} from 'lucide-vue-next';
import FlipBook from './FlipBook.vue';
import FeatureIcon from './FeatureIcon.vue';
import type {ArchiveBook,ArchiveRecord,MatchRun,PayerGroup,SourceDocument,Voucher} from '../types';
import {findVoucherArchive} from '../archiveNavigation';
import {mergeArchiveDisplayGroups} from '../archiveDisplayGroups';
import type {ArchiveDisplayGroup} from '../archiveDisplayGroups';
import {latestImported} from '../recordOrder';
import {collectionStatus,collectionStatusLabel} from '../matchWorkflow';

const props=defineProps<{groups:PayerGroup[];vouchers:Voucher[];documents:SourceDocument[];archives?:ArchiveBook[];run?:MatchRun;focusGroupId?:string}>();
const emit=defineEmits<{
 view:[record:Voucher|SourceDocument];
 review:[record:Voucher|SourceDocument];
 generate:[voucher:Voucher];
 openArchive:[archive:ArchiveBook];
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
const archivedVouchers=computed(()=>props.vouchers.filter(voucher=>{
 if(voucher.noAttachmentRequired)return voucher.status==='matched';
 if((voucher.status!=='matched'&&!voucher.entryAttachments?.length)||!voucher.documentIds.length)return false;
 return voucher.documentIds.every(id=>{
  const document=props.documents.find(item=>item.id===id);
  return !!document&&(document.status==='matched'||!!voucher.entryAttachments?.some(link=>link.documentId===id));
 });
}));
const validArchiveGroups=computed(()=>props.groups.flatMap(group=>{
 if(group.associationType==='name'){
  const voucherIds=group.voucherIds.filter(id=>props.vouchers.some(voucher=>voucher.id===id&&voucher.nameAssociationIds?.includes(group.id)));
  const documentIds=group.documentIds.filter(id=>props.documents.some(document=>document.id===id&&document.nameAssociationIds?.includes(group.id)));
  return (group.voucherIds.length?voucherIds.length&&documentIds.length:documentIds.length>=2)?[{...group,voucherIds,documentIds}]:[];
 }
 const vouchers=archivedVouchers.value.filter(voucher=>voucher.period===group.period&&(voucher.noAttachmentRequired?group.voucherIds.includes(voucher.id):voucher.documentIds.some(id=>group.documentIds.includes(id))));
 const relatedIds=new Set(vouchers.flatMap(voucher=>voucher.documentIds));
 const documentIds=group.documentIds.filter(id=>relatedIds.has(id)&&props.documents.some(document=>document.id===id));
 const hasExemptVoucher=vouchers.some(voucher=>voucher.noAttachmentRequired&&voucher.status==='matched');
 return (documentIds.length||hasExemptVoucher)&&vouchers.length?[{...group,payerName:group.needsPayerReview?'付款人未录入':group.payerName,documentIds,voucherIds:vouchers.map(voucher=>voucher.id)}]:[];
}));
const archiveGroups=computed(()=>mergeArchiveDisplayGroups(validArchiveGroups.value));
const filteredGroups=computed(()=>{
 const order=new Map(latestImported(props.documents,'prepend').map((document,index)=>[document.id,index]));
 const rank=(group:PayerGroup)=>Math.min(...group.documentIds.map(id=>order.get(id)??Number.MAX_SAFE_INTEGER));
 return archiveGroups.value.filter(group=>`${group.payerName} ${group.period}`.toLowerCase().includes(query.value.normalize('NFKC').trim().toLowerCase())).sort((a,b)=>rank(a)-rank(b)||b.period.localeCompare(a.period));
});
const archivedDocumentCount=computed(()=>new Set(archiveGroups.value.flatMap(group=>group.documentIds)).size);
const selectedGroup=computed(()=>filteredGroups.value.find(group=>group.id===selectedGroupId.value||group.sourceGroupIds.includes(selectedGroupId.value))||filteredGroups.value[0]);
const groupDocuments=computed(()=>{
 const ids=new Set(selectedGroup.value?.documentIds||[]);
 return latestImported(props.documents.filter(document=>ids.has(document.id)),'prepend');
});
const matchedVouchers=computed(()=>{
 const ids=new Set(selectedGroup.value?.voucherIds||[]);
 // Every ID has already passed its original name/financial association validation.
 return latestImported(props.vouchers.filter(voucher=>ids.has(voucher.id)),'append');
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
 const documents=voucher?voucher.documentIds.flatMap(id=>{const document=props.documents.find(candidate=>candidate.id===id);return document?[document]:[];}):groupDocuments.value;
 const evidence:ArchiveRecord[]=documents.map(document=>({kind:'document',no:document.number||'未录入编号',date:document.date,supplier:payer(document),amount:document.amount,summary:`${typeLabel(document.type)} · ${document.name}`,fileId:document.fileId,fileName:document.name}));
 const information=(item:Voucher):ArchiveRecord=>({kind:'voucher',no:item.no,date:item.date,supplier:item.supplier,amount:item.amount,summary:item.summary,fileId:item.fileId,fileName:item.fileName});
 if(selectedGroup.value?.associationKinds.includes('name'))return voucher?[information(voucher),...evidence]:[...matchedVouchers.value.map(information),...evidence];
 return voucher?[information(voucher),...evidence]:evidence;
});
const previewKey=computed(()=>`${selectedGroup.value?.id||''}/${selectedVoucherId.value}/${records.value.map(record=>`${record.kind}:${record.no}:${record.fileId||''}`).join('|')}`);
watch(()=>selectedGroup.value?.id,()=>{voucherListPage.value=1;documentListPage.value=1;selectedVoucherId.value=selectedGroup.value?.associationKinds.includes('name')?'':matchedVouchers.value[0]?.id||'';currentPage.value=0;},{immediate:true});
watch(()=>matchedVouchers.value.map(voucher=>voucher.id).join('|'),()=>{
 if(selectedVoucherId.value&&!matchedVouchers.value.some(voucher=>voucher.id===selectedVoucherId.value))selectedVoucherId.value='';
});
watch(previewKey,()=>{currentPage.value=0;totalPages.value=records.value.length;});
function jumpToPreview(){previewSection.value?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}
function groupCount(group:PayerGroup){return group.documentIds.filter(id=>props.documents.some(document=>document.id===id)).length;}
function voucherCount(group:PayerGroup){return group.voucherIds.filter(id=>props.vouchers.some(voucher=>voucher.id===id)).length;}
function associationLabel(group:ArchiveDisplayGroup){return group.associationKinds.length>1?'企业名称关联＋凭证关联':group.associationKinds[0]==='name'?'企业名称关联':'凭证关联';}
function voucherBasis(voucher:Voucher){
 if(voucher.entryAttachments?.length)return voucher.attachmentReviewRequired?'部分关联 · 请复核':voucher.ruleId||'分录关联';
 if(voucher.status==='matched')return voucher.ruleId||'手工关联';
 const group=props.groups.find(group=>group.associationType==='name'&&selectedGroup.value?.sourceGroupIds.includes(group.id)&&group.voucherIds.includes(voucher.id)&&voucher.nameAssociationIds?.includes(group.id));
 return `${group?.ruleId||'企业名称'} · 名称关联`;
}
function archiveForVoucher(voucher:Voucher){return findVoucherArchive(props.archives||[],voucher);}
function openExistingArchive(voucher:Voucher){const archive=archiveForVoucher(voucher);if(archive)emit('openArchive',archive);}
</script>

<template>
 <section class="matched-archive-panel">
  <div v-if="archiveGroups.length" class="draft-notice"><FeatureIcon name="archives" :size="40"/><div><strong>已关联数据已同步展示</strong><p>按分录金额、收款账号及日期核对附件；部分关联的凭证仍需人工复核，完成后可生成正式档案册。</p></div><span class="status matched">已关联资料</span></div>
  <div v-if="run&&archiveGroups.length" class="match-run-summary"><span><GitBranch :size="16"/>最近执行 {{run.time}}</span><span>已关联资料 <b>{{archivedDocumentCount}}</b> 份单据</span><span>已关联归档 <b>{{archiveGroups.length}}</b> 组</span></div>
  <div v-if="!archiveGroups.length" class="draft-empty"><span class="draft-empty-icon"><FeatureIcon name="archives" :size="88"/></span><h3>暂无已关联资料</h3><p>导入数据后系统会自动匹配。未关联的数据留在复核池，人工复核并完成关联后才会展示。</p><button class="btn primary" @click="emit('match')"><GitBranch :size="16"/>前往智能匹配</button></div>
  <div v-else class="draft-layout">
   <aside class="payer-groups"><div class="payer-groups-toolbar"><div class="payer-groups-heading"><h3>已关联归档</h3><span>{{archiveGroups.length}} 组</span></div><label class="payer-group-search"><Search :size="16"/><input v-model="query" aria-label="搜索已关联档案" placeholder="搜索付款人、期间"/></label></div>
    <div class="payer-group-list" role="group" aria-label="已关联归档分组"><button v-for="group in filteredGroups" :key="group.id" :class="['payer-group',{selected:selectedGroup?.id===group.id}]" :aria-pressed="selectedGroup?.id===group.id" @click="selectedGroupId=group.id"><span class="group-period">{{group.period}}</span><strong>{{group.payerName||'已关联单据'}}</strong><span>{{groupCount(group)}} 份单据 · {{voucherCount(group)}} 张凭证 · {{associationLabel(group)}}</span></button><p v-if="!filteredGroups.length" class="draft-no-results">未找到符合条件的档案</p></div>
   </aside>
   <div v-if="selectedGroup" class="payer-draft">
    <header class="payer-draft-heading"><div><span class="group-period">{{selectedGroup.period}} · {{associationLabel(selectedGroup)}}</span><h3>{{selectedGroup.payerName||'已关联单据'}}</h3></div><div class="payer-draft-actions"><span class="draft-tag">{{groupDocuments.length}} 份单据 · {{matchedVouchers.length}} 张凭证</span><button v-if="records.length" class="btn preview-jump" @click="jumpToPreview"><BookOpen :size="16"/>查看原件预览</button></div></header>
    <div class="type-totals"><div v-for="sum in sums" :key="sum.type"><span>{{typeLabel(sum.type)}} <small>{{sum.count}} 份</small></span><strong>¥ {{money(sum.amount)}}</strong></div></div><p class="totals-caption">各类单据分别汇总；发票与对应回单不重复累计为凭证金额。</p>
    <section v-if="matchedVouchers.length" class="linked-vouchers">
     <div class="draft-section-title"><h4><CheckCheck :size="17"/>已关联凭证 <span class="section-count">{{matchedVouchers.length}}</span></h4><span>仅展示已关联数据 · 每页 {{listPageSize}} 张</span></div>
     <div class="linked-voucher-header" aria-hidden="true"><span>凭证号</span><span>匹配依据</span><span class="voucher-amount-heading">金额（元）</span><span class="voucher-actions-heading">操作</span></div>
     <div class="linked-voucher-list" role="list" aria-label="已关联凭证">
      <div v-for="voucher in pagedVouchers" :key="voucher.id" :class="['linked-voucher',{'is-selected':selectedVoucherId===voucher.id}]" role="listitem">
       <button :class="['voucher-number',{chosen:selectedVoucherId===voucher.id}]" :title="voucher.no" @click="selectedVoucherId=voucher.id"><FileText :size="16"/>{{voucher.no}}</button>
       <span class="voucher-rule">{{voucherBasis(voucher)}}</span>
       <strong class="voucher-amount">¥ {{money(voucher.amount)}}</strong>
       <div class="linked-voucher-actions">
        <button v-if="voucher.reviewStatus==='pending'" class="text-link review-link" @click="emit('review',voucher)">核对字段</button>
        <button class="text-link" @click="emit('view',voucher)">查看原件</button>
        <button v-if="archiveForVoucher(voucher)" class="btn" @click="openExistingArchive(voucher)"><BookOpen :size="14"/>查看档案册</button>
        <button v-else class="btn" @click="emit('generate',voucher)">生成正式档案册</button>
        <button class="btn" @click="emit('reconcile',voucher)">核对凭证附件</button>
       </div>
      </div>
     </div>
     <div class="archive-list-footer"><span>共 {{matchedVouchers.length}} 张凭证</span><el-pagination v-if="matchedVouchers.length>listPageSize" class="voucher-pagination" v-model:current-page="voucherListPage" :page-size="listPageSize" :total="matchedVouchers.length" :pager-count="5" layout="prev, pager, next" size="small" aria-label="关联凭证分页"/></div>
    </section>
   </div>
   <section v-if="selectedGroup" class="archive-evidence" aria-label="已关联单据与原件">
    <div class="draft-section-title documents-heading"><h4><FileText :size="17"/>已关联单据 <span class="section-count">{{groupDocuments.length}}</span></h4><span>付款人名称取自原始单据</span></div>
    <el-table :data="pagedDocuments" row-key="id" class="draft-documents" size="default"><el-table-column label="单据 / 编号" min-width="230"><template #default="{row}"><button class="draft-document-name" :title="row.name" @click="emit('view',row)">{{row.name}}</button><small class="document-number">{{row.number||'编号未录入'}}</small></template></el-table-column><el-table-column label="类型" width="112"><template #default="{row}">{{typeLabel(row.type)}}</template></el-table-column><el-table-column label="付款人（客商）" min-width="190"><template #default="{row}"><span class="party-name">{{payer(row)||'未录入'}}</span></template></el-table-column><el-table-column label="收款人" min-width="190"><template #default="{row}">{{row.payeeName||'未录入'}}</template></el-table-column><el-table-column label="收款账号" min-width="170"><template #default="{row}">{{row.payeeAccount||'未录入'}}</template></el-table-column><el-table-column prop="date" label="日期" width="125"/><el-table-column label="备注" min-width="220"><template #default="{row}"><span style="white-space:pre-wrap">{{row.remarks||'—'}}</span></template></el-table-column><el-table-column label="金额（元）" width="145" align="right"><template #default="{row}"><span class="amount-cell">{{money(row.amount)}}</span></template></el-table-column><el-table-column label="匹配状态" width="135"><template #default="{row}"><span :class="['status',collectionStatus(row)]">{{collectionStatusLabel(row)}}</span><small v-if="row.remainingAmount!==undefined&&Number(row.remainingAmount)!==0" class="match-reason">剩余 ¥ {{money(row.remainingAmount)}} 待复核</small></template></el-table-column><el-table-column label="操作" width="170"><template #default="{row}"><button class="text-link" @click="emit('view',row)">查看原件</button><button v-if="row.extractionStatus==='pending'" class="text-link review-link" @click="emit('review',row)">核对字段</button></template></el-table-column></el-table>
    <div class="archive-list-footer documents-footer"><span>共 {{groupDocuments.length}} 份单据</span><el-pagination v-if="groupDocuments.length>listPageSize" class="document-pagination" v-model:current-page="documentListPage" :page-size="listPageSize" :total="groupDocuments.length" :pager-count="5" layout="prev, pager, next" size="small" aria-label="关联单据分页"/></div>
    <section v-if="records.length" ref="previewSection" class="draft-preview"><div class="draft-preview-heading"><div><h4><BookOpen :size="17"/>原始单据预览</h4><p>直接翻阅上传的 PDF / 图片，保留各银行原始版式；多页原件按页展示。</p></div><el-select v-if="matchedVouchers.length" v-model="selectedVoucherId" aria-label="已关联档案预览范围" style="width:215px"><el-option :label="selectedGroup.associationKinds.includes('name')?'企业全部凭证与单据':'全部已关联单据'" value=""/><el-option v-for="voucher in matchedVouchers" :key="voucher.id" :label="voucher.no+(voucher.status==='matched'?' · 凭证及附件':' · 原始凭证')" :value="voucher.id"/></el-select><span v-else class="draft-tag">全部 {{groupDocuments.length}} 份已关联原件</span></div>
     <div class="draft-flip-container"><FlipBook :key="previewKey" ref="book" :title="selectedGroup.payerName+' · 已关联资料'" :period="selectedGroup.period" :records="records" @page-change="event=>{currentPage=event.page;totalPages=event.total}"/></div>
     <div v-if="totalPages>1" class="draft-page-controls"><button class="icon-btn" :disabled="currentPage<=0" aria-label="工作稿上一页" @click="book?.prev()"><ChevronLeft :size="19"/></button><span>{{currentPage+1}} / {{totalPages||records.length}}</span><button class="icon-btn" :disabled="currentPage>=totalPages-1" aria-label="工作稿下一页" @click="book?.next()"><ChevronRight :size="19"/></button></div>
    </section>
   </section>
  </div>

 </section>
</template>

<style scoped>
.matched-archive-panel{
 --archive-ink:var(--ws-ink);
 --archive-muted:var(--ws-secondary);
 --archive-subtle:var(--ws-muted);
 --archive-line:var(--ws-line);
 --archive-paper:var(--ws-surface);
 --archive-surface:#f7f9fe;
 --archive-accent:var(--ws-accent);
 --archive-selected:var(--ws-accent-soft);
 font-size:13px;color:var(--archive-ink);
}
.draft-notice{display:flex;align-items:center;gap:12px;margin-bottom:14px;padding:15px 18px;border:1px solid #dfE9fa;border-radius:10px;background:#f2f7ff;color:var(--archive-accent)}
.draft-notice>svg{flex-shrink:0}.draft-notice>div{flex:1;min-width:0}
.draft-notice strong{font-size:14px;font-weight:650;color:var(--archive-ink)}
.draft-notice p{max-width:74ch;margin-top:4px;color:var(--archive-muted);font-size:12px;line-height:1.8}
.match-run-summary{display:flex;align-items:center;gap:12px 24px;flex-wrap:wrap;padding:0 2px 17px;color:var(--archive-muted);font-size:12px;line-height:1.8}
.match-run-summary>span{display:inline-flex;align-items:center;gap:6px}.match-run-summary b{font-weight:650;color:var(--archive-ink);font-variant-numeric:tabular-nums}
.draft-layout{display:grid;grid-template-columns:232px minmax(0,1fr);align-items:start;border:1px solid var(--archive-line);border-radius:12px;overflow:hidden;background:var(--archive-paper)}
.payer-groups{grid-column:1;grid-row:1/3;align-self:stretch;min-width:0;border-right:1px solid var(--archive-line);background:var(--archive-surface);padding:22px 12px}
.payer-groups-toolbar{display:grid;gap:16px;padding:0 4px 17px}
.payer-groups-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}
.payer-groups-heading h3{font-size:14px;font-weight:650;color:var(--archive-ink)}
.payer-groups-heading>span{font-size:11px;white-space:nowrap;color:var(--archive-muted);font-variant-numeric:tabular-nums}
.payer-group-search{display:flex;align-items:center;gap:7px;min-width:0;min-height:38px;padding:0 10px;border:1px solid var(--archive-line);border-radius:7px;background:var(--archive-paper);color:var(--archive-subtle);transition:border-color .18s,box-shadow .18s}
.payer-group-search:focus-within{border-color:var(--archive-accent);box-shadow:0 0 0 3px rgb(45 105 230 / .12)}
.payer-group-search>svg{flex-shrink:0}.payer-group-search input{width:100%;min-width:0;outline:none;background:transparent;border:0;padding:10px 0;font:inherit;font-size:12px;color:var(--archive-ink)}
.payer-group-search input::placeholder{color:var(--archive-subtle)}
.payer-group-list{display:grid;align-content:start;gap:7px;max-height:420px;overflow:auto}
.payer-group{display:flex;flex-direction:column;gap:5px;width:100%;min-width:0;text-align:left;border:1px solid transparent;border-radius:8px;padding:13px 12px;background:transparent;line-height:1.65;transition:background-color .18s,border-color .18s}
.payer-group:hover{background:#f0f5ff}.payer-group.selected{border-color:#bfd4f8;background:var(--archive-selected)}
.group-period{font-size:11px;font-weight:500;color:var(--archive-muted);font-variant-numeric:tabular-nums;letter-spacing:.2px}
.payer-group strong{font-size:13px;font-weight:600;color:var(--archive-ink);overflow-wrap:anywhere}
.payer-group.selected strong{color:var(--archive-accent)}
.payer-group>span:last-child{font-size:11px;color:var(--archive-muted);overflow-wrap:anywhere}
.payer-draft{grid-column:2;grid-row:1;min-width:0;overflow:hidden;container-type:inline-size;container-name:archive-detail}
.payer-draft-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:25px 26px 20px}
.payer-draft-heading>div:first-child{min-width:0;flex:1}.payer-draft-heading h3{font-size:21px;font-weight:650;letter-spacing:-.3px;line-height:1.55;margin-top:6px;color:var(--archive-ink);overflow-wrap:anywhere}
.payer-draft-actions{display:flex;align-items:center;justify-content:flex-end;gap:9px;flex-wrap:wrap;max-width:290px;padding-top:1px}
.draft-tag{display:inline-flex;align-items:center;justify-content:center;max-width:100%;white-space:normal;font-size:11px;line-height:1.6;padding:5px 8px;border:1px solid var(--archive-line);border-radius:5px;background:var(--archive-surface);color:var(--archive-muted)}
.preview-jump{font-size:12px;min-height:34px;white-space:nowrap}
.type-totals{display:flex;flex-wrap:wrap;gap:14px 32px;margin:0 26px;padding:17px 0 15px;border-top:1px solid var(--archive-line)}
.type-totals>div{display:flex;flex:1 1 210px;align-items:baseline;justify-content:space-between;gap:16px;min-width:0}
.type-totals span{font-size:12px;color:var(--archive-muted)}.type-totals small{font-size:11px;color:var(--archive-subtle);margin-left:6px;white-space:nowrap}
.type-totals strong{font-size:18px;font-weight:650;line-height:1.5;letter-spacing:-.25px;color:var(--archive-ink);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.totals-caption{padding:0 26px 23px;font-size:11px;line-height:1.8;color:var(--archive-subtle)}
.draft-section-title{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}
.draft-section-title h4,.draft-preview-heading h4{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:650;color:var(--archive-ink)}
.draft-section-title h4>svg,.draft-preview-heading h4>svg{color:var(--archive-muted)}.draft-section-title>span{font-size:11px;line-height:1.7;color:var(--archive-subtle)}
.section-count{display:inline-flex;align-items:center;justify-content:center;min-width:23px;height:21px;padding:0 6px;border-radius:5px;background:var(--archive-selected);color:var(--archive-accent);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}
.linked-vouchers{margin:0 26px 25px;padding:0;background:transparent;border:0;border-radius:0}
.linked-voucher-header,.linked-voucher{display:grid;grid-template-columns:minmax(95px,1fr) minmax(95px,.9fr) minmax(115px,1fr) minmax(235px,1.8fr);align-items:center;gap:14px;padding:14px}
.linked-voucher-header{margin-top:15px;border-top:1px solid var(--archive-line);border-bottom:1px solid var(--archive-line);background:var(--archive-surface);font-size:11px;font-weight:550;color:var(--archive-muted)}
.voucher-amount-heading,.voucher-actions-heading{text-align:right}
.linked-voucher-list{border-bottom:1px solid var(--archive-line)}
.linked-voucher{min-width:0;min-height:71px;border-bottom:1px solid var(--archive-line);transition:background-color .18s}
.linked-voucher:last-child{border-bottom:0}.linked-voucher:hover{background:var(--archive-surface)}.linked-voucher.is-selected{background:#f0f5ff}
.linked-voucher>.voucher-number{display:inline-flex;align-items:center;gap:7px;justify-self:start;min-width:0;text-align:left;line-height:1.7;font-size:13px;font-weight:650;color:var(--archive-accent);overflow-wrap:anywhere}
.linked-voucher>.voucher-number>svg{flex-shrink:0}.voucher-number.chosen{text-decoration:underline;text-underline-offset:4px}
.voucher-rule{min-width:0;font-size:11px;color:var(--archive-muted);line-height:1.7;overflow-wrap:anywhere}
.voucher-amount{min-width:0;text-align:right;font-size:15px;font-weight:650;color:var(--archive-ink);font-variant-numeric:tabular-nums;white-space:nowrap}
.linked-voucher-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px 12px;min-width:0;flex-wrap:wrap}
.linked-voucher-actions .text-link{font-size:12px;padding:3px 0;white-space:nowrap}.linked-voucher-actions .btn{min-height:32px;padding:0 9px;font-size:11px;white-space:nowrap}
.review-link{color:oklch(52% .12 70);white-space:nowrap}
.archive-list-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:33px;margin-top:10px;font-size:11px;color:var(--archive-subtle)}
.archive-list-footer :deep(.el-pagination){flex-shrink:0}.documents-heading{padding:0 26px 15px}
.archive-evidence{grid-column:2;grid-row:2;min-width:0;overflow:hidden;border-top:1px solid var(--archive-line);background:var(--archive-paper)}
.archive-evidence>.documents-heading{padding-top:22px}
.draft-documents{width:100%;--el-table-header-bg-color:var(--archive-surface);--el-table-header-text-color:var(--archive-muted);--el-table-border-color:var(--archive-line)}
.draft-documents :deep(.el-table__cell){padding-top:12px;padding-bottom:12px}.draft-documents :deep(.el-table__header th){font-size:11px}
.draft-document-name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:13px;font-weight:550;line-height:1.7;text-align:left;color:var(--archive-accent);padding:0;overflow-wrap:anywhere}
.document-number{display:block;margin-top:2px;font-size:11px;line-height:1.8;color:var(--archive-subtle);overflow-wrap:anywhere}.party-name{font-weight:500;color:var(--archive-ink)}
.documents-footer{margin:0;padding:12px 26px;border-top:1px solid var(--archive-line)}
.draft-preview{margin-top:4px;border-top:1px solid var(--archive-line);scroll-margin-top:100px}
.draft-preview-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:23px 26px;flex-wrap:wrap}
.draft-preview-heading>div{min-width:0}.draft-preview-heading p{margin-top:6px;font-size:12px;line-height:1.8;color:var(--archive-muted)}
.draft-flip-container{padding:25px 12px;background:#edf2fa}
.draft-page-controls{display:flex;gap:16px;align-items:center;justify-content:center;padding:12px;border-top:1px solid var(--archive-line)}
.draft-page-controls>span{font-size:12px;min-width:55px;text-align:center;color:var(--archive-muted);font-variant-numeric:tabular-nums}
.draft-empty{display:flex;flex-direction:column;align-items:center;text-align:center;min-height:425px;justify-content:center;padding:45px 24px;border:1px solid var(--archive-line);border-radius:12px;background:var(--archive-paper)}
.draft-empty-icon{display:grid;place-items:center;width:88px;height:88px;border:0;border-radius:24px;background:transparent;color:var(--archive-accent)}
.draft-empty h3{font-size:20px;font-weight:600;color:var(--archive-ink);margin:21px 0 10px;line-height:1.5}
.draft-empty p{max-width:470px;font-size:13px;line-height:1.9;color:var(--archive-muted);margin-bottom:23px}
.draft-no-results{font-size:12px;line-height:1.8;padding:24px 10px;text-align:center;color:var(--archive-muted)}
@container archive-detail (max-width:830px){
 .payer-draft-heading{flex-wrap:wrap;gap:13px}.payer-draft-heading>div:first-child{flex-basis:100%}.payer-draft-actions{justify-content:flex-start;max-width:none}
 .linked-voucher-header{display:none}.linked-voucher-list{margin-top:14px;border-top:1px solid var(--archive-line)}
 .linked-voucher{grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);gap:6px 14px;padding:15px 12px}
 .linked-voucher>.voucher-number{grid-column:1;grid-row:1}.voucher-rule{grid-column:1;grid-row:2}.voucher-amount{grid-column:2;grid-row:1}.linked-voucher-actions{grid-column:2;grid-row:2}
}
@container archive-detail (max-width:520px){
 .linked-voucher{grid-template-columns:minmax(0,1fr) auto;gap:9px 12px;padding:16px 9px}
 .voucher-rule{grid-column:1;grid-row:2}.voucher-amount{grid-column:2;grid-row:1}.linked-voucher-actions{grid-column:1/3;grid-row:3;justify-content:flex-start;gap:10px 14px;padding-top:2px}
 .linked-voucher-actions .btn{min-height:35px}.linked-voucher-actions .text-link{min-height:35px;display:inline-flex;align-items:center}
 .payer-draft-heading h3{font-size:19px}.type-totals{gap:11px}.type-totals>div{flex-basis:100%}
}
@media(max-width:1100px){.draft-layout{grid-template-columns:205px minmax(0,1fr)}}
@media(max-width:900px){
 .draft-layout{grid-template-columns:minmax(0,1fr)}.payer-groups{grid-column:1;grid-row:auto;align-self:start;border-right:0;border-bottom:1px solid var(--archive-line);padding:17px 19px}
 .payer-draft,.archive-evidence{grid-column:1;grid-row:auto}
 .payer-groups-toolbar{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:0 0 13px}.payer-groups-heading{gap:12px}.payer-group-search{width:250px;max-width:100%}
 .payer-group-list{display:flex;max-height:156px;gap:9px;overflow-x:auto;overflow-y:auto;padding-bottom:3px}.payer-group{flex:0 0 235px;max-width:270px}
}
@media(max-width:760px){
 .draft-notice{align-items:flex-start;padding:13px 14px;gap:10px}.draft-notice strong{font-size:13px}.draft-notice p{font-size:11px}.draft-notice>span.status{display:none}
 .match-run-summary{gap:6px 15px;padding:0 2px 14px;font-size:11px}
 .payer-groups{padding:15px 14px}.payer-groups-toolbar{display:grid;gap:12px;padding-bottom:12px}.payer-group-search{width:100%;max-width:none}
 .payer-group{flex-basis:220px;padding:11px}
 .payer-draft-heading{padding:20px 16px 17px;gap:12px}.payer-draft-actions{gap:8px}.preview-jump{min-height:36px;font-size:11px}
 .type-totals{margin:0 16px;padding:15px 0 12px}.type-totals strong{font-size:17px}.totals-caption{padding:0 16px 22px}
 .linked-vouchers{margin:0 16px 24px}.draft-section-title>span{font-size:10px}.draft-section-title h4,.draft-preview-heading h4{font-size:13px}
 .archive-list-footer{flex-wrap:wrap;gap:8px}.documents-heading{padding:0 16px 13px}.documents-footer{padding:11px 16px}
 .archive-evidence>.documents-heading{padding-top:19px}
 .draft-preview-heading{padding:19px 16px;gap:13px}.draft-preview-heading p{font-size:11px}.draft-preview-heading :deep(.el-select){max-width:100%}.draft-flip-container{padding:17px 8px}
 .draft-empty{min-height:345px;padding:35px 18px}.draft-empty h3{font-size:18px}.draft-empty p{font-size:12px}
}
@media(prefers-reduced-motion:reduce){.payer-group-search,.payer-group,.linked-voucher{transition:none}}
</style>
