<script setup lang="ts">
import { computed, defineAsyncComponent, h, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Activity, ArrowDown, ArrowDownToLine, ArrowRight, Bell, BookOpen, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Database, FileCheck2, FileClock, FileSearch, FileText, Files, FolderArchive, Fullscreen, GitBranch, LayoutDashboard, ListFilter, ListTree, LockKeyhole, PanelLeftClose, Plus, RefreshCw, Trash2, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Upload, WandSparkles, X, ZoomIn, ZoomOut, LogOut, UsersRound } from 'lucide-vue-next';

import FeatureIcon from './components/FeatureIcon.vue';
import {authState,logout} from './auth';
const UserManagement=defineAsyncComponent(()=>import('./components/UserManagement.vue'));

import DocumentPage from './components/DocumentPage.vue';
import ArchiveRecordPage from './components/ArchiveRecordPage.vue';
import {loadFile,saveFiles} from './fileStorage';

import RecordEditDialog from './components/RecordEditDialog.vue';
import VoucherAttachmentsDialog from './components/VoucherAttachmentsDialog.vue';

import FilePreviewDialog from './components/FilePreviewDialog.vue';
import { useArchiveStore } from './store';
import { latestImported } from './recordOrder';
import {collectionStatus,collectionStatusLabel} from './matchWorkflow';
import {visibleArchiveGroups} from './nameAssociation';
import type { ArchiveBook, MatchRule, Voucher, SourceDocument, ArchiveRecord } from './types';

// 大型导入、翻页和档案模块按实际入口加载，首页不下载尚未使用的PDF解析代码。
const loadingModule={render:()=>h('div',{class:'module-loading',role:'status'},'正在加载，请稍候…')};
const BatchImportDialog=defineAsyncComponent({loader:()=>import('./components/BatchImportDialog.vue'),loadingComponent:loadingModule,delay:150});
const FlipBook=defineAsyncComponent({loader:()=>import('./components/FlipBook.vue'),loadingComponent:loadingModule,delay:150});
const MatchedArchivePanel=defineAsyncComponent({loader:()=>import('./components/MatchedArchivePanel.vue'),loadingComponent:loadingModule,delay:150});
const ArchiveRangeForm=defineAsyncComponent({loader:()=>import('./components/ArchiveRangeForm.vue'),loadingComponent:loadingModule,delay:150});

const store = useArchiveStore();
const { state, storageError } = store;
const compactQuery=window.matchMedia('(max-width:760px)');
const compactLayout=ref(compactQuery.matches);
const onCompactChange=(event:MediaQueryListEvent)=>{compactLayout.value=event.matches;};
onMounted(()=>compactQuery.addEventListener('change',onCompactChange));
onBeforeUnmount(()=>compactQuery.removeEventListener('change',onCompactChange));
const isSuperAdmin=computed(()=>authState.user?.role==='SUPER_ADMIN');
const accountName=computed(()=>authState.user?.displayName||'');
const accountInitial=computed(()=>Array.from(accountName.value)[0]||'用');
const accountRole=computed(()=>isSuperAdmin.value?'超级管理员':'普通用户');
const signingOut=ref(false);
let workspaceDisposed=false;
onBeforeUnmount(()=>{workspaceDisposed=true;if(signingOut.value)ElMessageBox.close();});
async function signOut(){
 if(signingOut.value)return;
 signingOut.value=true;
 try{
  // 仅明确确认后才撤销服务端会话，取消、关闭或按 Escape 均保留登录。
  try{await ElMessageBox.confirm('确认退出当前账号吗？退出后需要重新登录，已保存的业务数据不会删除。','退出登录确认',{confirmButtonText:'确认退出',cancelButtonText:'取消',type:'warning',closeOnClickModal:false});}
  catch(error){if(error==='cancel'||error==='close')return;throw error;}
  if(workspaceDisposed)return;
  await logout();
 }catch(error){notifyError(error);}
 finally{signingOut.value=false;}
}
const nav = computed(()=>[
  { id:'overview', label:'工作台', icon:LayoutDashboard },
  { id:'data', label:'数据采集', icon:Database },
  { id:'match', label:'智能匹配', icon:GitBranch },
  { id:'exceptions', label:'异常处理', icon:FileClock },
  { id:'archives', label:'电子档案', icon:FolderArchive },
  { id:'rules', label:'规则配置', icon:SlidersHorizontal },
  { id:'logs', label:'操作日志', icon:ListTree },
  ...(isSuperAdmin.value?[{id:'users',label:'用户管理',icon:UsersRound}]:[]),
]);
const active = ref('archives');
watch(isSuperAdmin,value=>{if(!value&&active.value==='users')active.value='archives';});
const titles:Record<string,string> = {overview:'财务档案工作台',data:'数据采集',match:'智能凭证匹配',exceptions:'异常处理',archives:'电子会计档案',rules:'匹配规则配置',logs:'操作日志',users:'用户管理'};
const subtitles:Record<string,string> = {overview:'从数据采集到安全归档，掌握每一笔凭证的流转。',data:'统一采集 ERP 凭证与原始单据，让业务数据有序流转。',match:'按规则自动关联凭证与单据，让每一笔账都有据可循。',exceptions:'聚焦未匹配凭证与孤儿单据，补齐财务证据链。',archives:'让凭证有序归档，让每一次查阅触手可及。',rules:'以可配置规则驱动匹配，兼顾效率与准确性。',logs:'记录每一次关键操作，确保业务过程清晰可追溯。',users:'管理团队登录账号，为每位成员分配合适的访问权限。'};
const period = ref('');
const archiveSearch = ref('');
const archivePeriod = ref('');
const query = ref('');
const globalQuery = ref('');
const dataTab = ref('vouchers');
const exceptionTab=ref('vouchers');
const showDocuments=computed(()=>(active.value==='data'&&dataTab.value==='documents')||(active.value==='exceptions'&&exceptionTab.value==='documents'));
const batchOpen=ref(false);const batchKind=ref<'vouchers'|'documents'>('vouchers');
const editOpen=ref(false);const editKind=ref<'voucher'|'document'>('voucher');const editRecord=ref<Voucher|SourceDocument>();
const previewOpen=ref(false);const previewFile=ref<{fileId?:string;name?:string;legacyUrl?:string}>({});
const selectedVoucherIds=ref<string[]>([]),selectedDocumentIds=ref<string[]>([]);
const listPage=ref(1),pageSize=ref(10);
const voucherTable=ref<{clearSelection:()=>void}>(),documentTable=ref<{clearSelection:()=>void}>();
const archiveTab = ref(state.lastMatchRun||state.payerGroups?.length?'matching':'books');
const orderedRules=computed(()=>{const current=state.rules.find(rule=>rule.id==='R09');return current?[current]:[...state.rules].sort((a,b)=>a.priority-b.priority);});
const payerGroups=computed(()=>visibleArchiveGroups(state).filter(group=>!archivePeriod.value||group.period===archivePeriod.value));
const partySyncing=ref(false);
onMounted(async()=>{partySyncing.value=true;try{await store.refreshDocumentParties();}catch(error){notifyError(error);}finally{partySyncing.value=false;}});
const statusFilter = ref('all');
const minAmount = ref<number | undefined>();
const maxAmount = ref<number | undefined>();
const advanced = ref(false);
const selectedArchiveId = ref('');
const selectedArchive = computed<ArchiveBook | undefined>(() => state.archives.find(x=>x.id===selectedArchiveId.value) || state.archives[0]);
const filteredArchives = computed(()=>state.archives.filter(x=>(!archivePeriod.value || x.period===archivePeriod.value) && `${x.title} ${x.startVoucherNo} ${x.endVoucherNo}`.includes(archiveSearch.value)));
const pending = computed(()=>state.vouchers.filter(x=>collectionStatus(x)!=='matched'));
const reviewVouchers=computed(()=>state.vouchers.filter(x=>collectionStatus(x)==='review'));
const reviewDocuments=computed(()=>state.documents.filter(x=>collectionStatus(x)==='review'));
const matched = computed(()=>state.vouchers.filter(x=>collectionStatus(x)==='matched'));
const matchRate = computed(()=>state.vouchers.length ? (matched.value.length/state.vouchers.length*100).toFixed(1) : '0.0');
const orderedVouchers=computed(()=>latestImported(state.vouchers,'append'));
const orderedDocuments=computed(()=>latestImported(state.documents,'prepend'));
const filteredVouchers = computed(()=>orderedVouchers.value.filter(x=>{
  const keyword = query.value.toLowerCase();
  return (!period.value || x.period===period.value) && `${x.no} ${x.supplier} ${x.summary} ${x.invoiceNo||''} ${x.contractNo||''}`.toLowerCase().includes(keyword)
  && (statusFilter.value==='all'||(statusFilter.value==='missing'?x.status==='missing':collectionStatus(x)===statusFilter.value)) && (active.value!=='exceptions'||collectionStatus(x)==='review')
  && (active.value!=='archives'||archiveTab.value!=='search'||collectionStatus(x)==='matched')
  && (minAmount.value===undefined||x.amount>=minAmount.value) && (maxAmount.value===undefined||x.amount<=maxAmount.value);
}));
const availablePeriods=computed(()=>Array.from(new Set([...state.vouchers.map(v=>v.period),...state.documents.filter(d=>d.date).map(d=>d.date.slice(0,7)),...state.archives.map(a=>a.period)])).sort().reverse());
function afterImported(){clearSelection();query.value='';period.value='';statusFilter.value='all';listPage.value=1;}
const filteredDocs = computed(()=>orderedDocuments.value.filter(x=>(!period.value||x.date.startsWith(period.value))&&`${x.name} ${x.number} ${x.supplier} ${x.payeeAccount||''} ${x.remarks||''}`.toLowerCase().includes(query.value.toLowerCase())&&(statusFilter.value==='all'||collectionStatus(x)===statusFilter.value)&&(active.value!=='exceptions'||collectionStatus(x)==='review')&&(minAmount.value===undefined||x.amount>=minAmount.value)&&(maxAmount.value===undefined||x.amount<=maxAmount.value)));
const pagedVouchers=computed(()=>filteredVouchers.value.slice((listPage.value-1)*pageSize.value,listPage.value*pageSize.value));
const pagedDocs=computed(()=>filteredDocs.value.slice((listPage.value-1)*pageSize.value,listPage.value*pageSize.value));
watch([active,dataTab,exceptionTab,archiveTab,query,period,statusFilter,minAmount,maxAmount,pageSize],()=>{listPage.value=1;clearSelection();});
watch(listPage,clearSelection);
watch([()=>filteredVouchers.value.length,()=>filteredDocs.value.length],()=>{listPage.value=Math.min(listPage.value,Math.max(1,Math.ceil((showDocuments.value?filteredDocs.value.length:filteredVouchers.value.length)/pageSize.value)));});
function clearSelection(){selectedVoucherIds.value=[];selectedDocumentIds.value=[];voucherTable.value?.clearSelection();documentTable.value?.clearSelection();}
function openBatch(){batchKind.value=dataTab.value==='documents'?'documents':'vouchers';batchOpen.value=true;}
function edited(){clearSelection();}
function openEdit(record:Voucher|SourceDocument,kind:'voucher'|'document'){editRecord.value=record;editKind.value=kind;editOpen.value=true;}
function viewFile(record:Voucher|SourceDocument){previewFile.value={fileId:record.fileId,name:'fileName'in record?record.fileName:'name'in record?record.name:'凭证影像',legacyUrl:'url'in record?record.url:undefined};previewOpen.value=true;}
async function unmatch(v:Voucher){try{const result=await ElMessageBox.prompt('请填写解除匹配原因，关联单据将返回待匹配。','解除匹配',{confirmButtonText:'确认解除',cancelButtonText:'取消',inputValidator:(value:string)=>!!value?.trim()||'请填写原因'});store.unmatchVoucher(v.id,result.value);ElMessage.success('匹配已解除，凭证和单据已返回待匹配');}catch(e){if(e!=='cancel'&&e!=='close')notifyError(e);}}
async function seal(d:SourceDocument){try{await ElMessageBox.confirm('请确认已检查原件，发票确有有效印章。系统将记录本次人工核验。','核验发票印章',{confirmButtonText:'已核验，确认有章',cancelButtonText:'取消'});store.confirmSeal(d.id);ElMessage.success('印章核验已记录');}catch(e){if(e!=='cancel'&&e!=='close')notifyError(e);}}
async function restore(v:Voucher){try{store.restoreMissing(v.id);ElMessage.success('凭证已恢复待匹配');}catch(e){notifyError(e);}}
async function deleteSelected(){
 const ids=[...(showDocuments.value?selectedDocumentIds.value:selectedVoucherIds.value)];if(!ids.length)return;
 try{await ElMessageBox.confirm(`确认删除选中的 ${ids.length} ${showDocuments.value?'份单据':'张凭证'}？删除后将处理关联关系并记录日志，操作无法撤销。`,'批量删除确认',{confirmButtonText:'确认删除',cancelButtonText:'取消',type:'warning'});}catch{return;}
 busy.value=true;try{const count=await(showDocuments.value?store.deleteDocuments(ids):store.deleteVouchers(ids));clearSelection();listPage.value=1;ElMessage.success(`已删除 ${count} 条记录，关联关系已同步更新`);}catch(e){notifyError(e);}finally{busy.value=false;}
}
const book = ref<InstanceType<typeof FlipBook>>();
const bookPage = ref(2);
const pageCount = ref(10);
const zoom = ref(100);
const showCatalog = ref(false);
const viewer = ref<HTMLElement>();
const previewVoucher = computed(()=>state.vouchers.find(x=>x.period===selectedArchive.value?.period && x.status==='matched') || state.vouchers[0]);
const sampleCategories = ['凭证封面','档案目录','记账凭证','增值税发票','发票查验','银行电子回单','费用审批单','技术服务合同','归档校验','档案封底'];
const originalCategories=ref<string[]>([]);
const archiveRecords=computed<ArchiveRecord[]>(()=>{
 const a=selectedArchive.value;if(!a||a.id.startsWith('arc-'))return [];
 return state.vouchers.filter(v=>v.status==='matched'&&v.period===a.period&&v.no.localeCompare(a.startVoucherNo,'zh-CN',{numeric:true})>=0&&v.no.localeCompare(a.endVoucherNo,'zh-CN',{numeric:true})<=0).flatMap(v=>[
  {kind:'voucher' as const,no:v.no,date:v.date,supplier:v.supplier,amount:v.amount,summary:v.summary,fileId:v.fileId,fileName:v.fileName},
  ...v.documentIds.flatMap(id=>{const d=state.documents.find(d=>d.id===id&&d.status==='matched');return d?[{kind:'document' as const,no:d.number,date:d.date,supplier:d.supplier,amount:d.amount,summary:d.name,fileId:d.fileId,fileName:d.name}]:[];})
 ]);
});
const categories=computed(()=>archiveRecords.value.length?(originalCategories.value.length?originalCategories.value:archiveRecords.value.map(r=>r.kind==='voucher'?r.no:r.summary)):sampleCategories);
watch(()=>selectedArchive.value?.id,()=>{originalCategories.value=[];});
const dialog = ref('');
const helpOpen = ref(false);
const busy = ref(false);
const autoBusy = ref(false);
const autoProgress = ref(0);
const exportBusy = ref(false);
const pdfNodes = ref<HTMLElement>();
const pdfTemplateActive=ref(false);
const createForm = ref({period:'',startVoucherNo:'',endVoucherNo:''});
const archiveSelectionValid=ref(false);
function openArchiveGenerator(voucher?:Voucher){
 if(busy.value||exportBusy.value)return;
 if(voucher&&store.isVoucherLocked(voucher)){ElMessage.info('该凭证已归档，请直接查看已有档案册');return;}
 const actualPeriods=[...new Set(state.vouchers.map(v=>v.period).filter(month=>/^\d{4}-(0[1-9]|1[0-2])$/.test(month)))].sort().reverse();
 const unarchived=actualPeriods.filter(month=>state.vouchers.some(v=>v.period===month&&!store.isVoucherLocked(v)));
 const preferred=archivePeriod.value||period.value;
 const selectedPeriod=voucher?.period||(unarchived.includes(preferred)?preferred:unarchived[0]||actualPeriods[0]||'');
 createForm.value={period:selectedPeriod,startVoucherNo:voucher?.no||'',endVoucherNo:voucher?.no||''};
 archiveSelectionValid.value=false;dialog.value='create';
}
const attachmentOpen=ref(false);
const attachmentVoucher=ref<Voucher>();
function openAttachments(voucher:Voucher){attachmentVoucher.value=voucher;attachmentOpen.value=true;}
const focusVoucher = ref<Voucher>();
const focusNameGroups=computed(()=>(state.nameAssociations||[]).filter(group=>group.voucherIds.includes(focusVoucher.value?.id||'')));
const archiveGroupId=ref('');
const selectedDocIds = ref<string[]>([]);
const manualReason = ref('');
const missingReason = ref('');
const editingRule = ref<MatchRule>();
const ruleForm=ref({threshold:85,tolerance:0.05,dateWindow:7,priority:5,matchType:'fuzzy' as MatchRule['matchType'],partyField:'payerName' as 'payerName'|'payeeName'|'either',documentTypes:['invoice'] as SourceDocument['type'][],requireAmount:true,requireDate:true,associationScope:'voucher' as 'voucher'|'party'});
watch(()=>ruleForm.value.associationScope,scope=>{if(scope==='party'){ruleForm.value.requireAmount=false;ruleForm.value.requireDate=false;}});
const manualCandidates = computed(()=>state.documents.filter(x=>x.status==='pending'&&x.extractionStatus!=='pending'&&x.date.startsWith(focusVoucher.value?.period||'')).sort((a,b)=>Math.abs(a.amount-(focusVoucher.value?.amount||0))-Math.abs(b.amount-(focusVoucher.value?.amount||0))));
const selectedTotal = computed(()=>selectedDocIds.value.reduce((sum,id)=>sum+(state.documents.find(x=>x.id===id)?.amount||0),0));
const moneyFormatter=new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const money = (n:number)=>moneyFormatter.format(n);
const statusLabel = (s:string)=>({matched:'已匹配归档',pending:'待匹配',missing:'附件缺失',locked:'已归档',invoice:'增值税发票',bank:'银行回单',contract:'合同',approval:'审批单'}[s]||s);
function navigate(id:string){ if(id==='users'&&!isSuperAdmin.value){ElMessage.error('仅超级管理员可以管理用户');return;}if(busy.value||exportBusy.value){ElMessage.info('正在处理，请稍候');return;}active.value=id; query.value=''; statusFilter.value='all';minAmount.value=undefined;maxAmount.value=undefined; }
function doGlobalSearch(){query.value=globalQuery.value;active.value='search';period.value='';statusFilter.value='all';minAmount.value=undefined;maxAmount.value=undefined;}
function selectArchive(a:ArchiveBook){if(exportBusy.value||busy.value)return;selectedArchiveId.value=a.id;bookPage.value=2;zoom.value=100;}
function onPage(e:{page:number;total:number}){bookPage.value=e.page;pageCount.value=e.total;}
function onOriginalPages(pages:{label:string}[]){originalCategories.value=pages.map(page=>page.label);pageCount.value=pages.length;bookPage.value=0;}
async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await viewer.value?.requestFullscreen();}catch{ElMessage.info('当前浏览器不支持全屏，请使用浏览器缩放。');}}
async function runAuto(){
  if(active.value!=='match'){navigate('match');return;}
  if(autoBusy.value||partySyncing.value)return; autoBusy.value=true;autoProgress.value=8;
  const timer=setInterval(()=>{autoProgress.value=Math.min(92,autoProgress.value+13);},170);
  try{const result=await store.autoMatch(period.value);autoProgress.value=100;archiveTab.value='matching';archiveGroupId.value='';archivePeriod.value=period.value;ElMessage.success({message:`匹配完成：新增关联 ${result.matched} 张凭证、${state.lastMatchRun?.newlyAssociatedDocuments||0} 份单据；当前范围已匹配归档 ${state.lastMatchRun?.associatedDocuments||0} 份单据，${state.lastMatchRun?.remainingDocuments||0} 份单据请复核`,grouping:true});}catch(e){notifyError(e);}finally{clearInterval(timer);autoBusy.value=false;}
}
function notifyError(e:unknown){ElMessage.error(e instanceof Error ? e.message : '操作未完成，请重试');}
function openManual(v:Voucher){if(state.rules.some(rule=>rule.id==='R09')){openAttachments(v);return;}if(v.reviewStatus==='pending'){ElMessage.info('请先核对凭证提取字段，再进行匹配');openEdit(v,'voucher');return;}focusVoucher.value=v;selectedDocIds.value=[];manualReason.value='';dialog.value='manual';}
function openMissing(v:Voucher){focusVoucher.value=v;missingReason.value=v.missingReason||'';dialog.value='missing';}
async function bindManual(){if(!focusVoucher.value)return;try{await store.manualMatch(focusVoucher.value.id,selectedDocIds.value,manualReason.value);dialog.value='';ElMessage.success('凭证与单据已关联，证据链已更新');}catch(e){notifyError(e);}}
async function saveMissing(){if(!focusVoucher.value)return;try{await store.markMissing(focusVoucher.value.id,missingReason.value);dialog.value='';ElMessage.success('已记录附件缺失原因');}catch(e){notifyError(e);}}
function showEvidence(v:Voucher){focusVoucher.value=v;dialog.value='evidence';}
function editRule(r:MatchRule){if(r.id==='R09'){ElMessage.info('金额必须完全一致；收款账号至少保留4位尾号；日期差严格小于30天。可通过规则开关暂停或启用自动匹配。');return;}editingRule.value=r;ruleForm.value={threshold:r.threshold<=1?r.threshold*100:r.threshold,tolerance:r.tolerance,dateWindow:r.dateWindow,priority:r.priority,matchType:r.matchType,partyField:r.conditions?.partyField||'payerName',documentTypes:r.conditions?.documentTypes?[...r.conditions.documentTypes]:r.matchType==='aggregate'?['invoice']:r.id==='R06'||r.id==='R03'?['bank']:r.id==='R02'?['contract']:r.id==='R04'?['approval']:['invoice'],requireAmount:r.conditions?.requireAmount!==false,requireDate:r.conditions?.requireDate!==false,associationScope:r.conditions?.associationScope||'voucher'};dialog.value='rule';}
function saveRule(){if(!editingRule.value)return;try{store.updateRule(editingRule.value.id,{threshold:ruleForm.value.threshold,tolerance:ruleForm.value.tolerance,dateWindow:ruleForm.value.dateWindow,priority:ruleForm.value.priority,matchType:ruleForm.value.matchType,conditions:{associationScope:ruleForm.value.associationScope,partyField:ruleForm.value.partyField,documentTypes:[...ruleForm.value.documentTypes],requireAmount:ruleForm.value.requireAmount,requireDate:ruleForm.value.requireDate}});dialog.value='';ElMessage.success('规则配置已更新');}catch(e){notifyError(e);}}
function toggleRule(r:MatchRule){try{store.updateRule(r.id,{enabled:!r.enabled});}catch(e){notifyError(e);}}
async function createArchive(){busy.value=true;try{const a=await store.generateArchive(createForm.value);selectedArchiveId.value=a.id;period.value=a.period;archivePeriod.value='';await nextTick();try{await ensureArchivePdf(a);}catch(e){state.archives=state.archives.filter(item=>item.id!==a.id);state.logs.unshift({id:crypto.randomUUID(),time:new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}),action:'归档生成失败',detail:'PDF 生成失败，已撤销本次档案及其锁定',operator:accountName.value||'操作员'});throw e;}dialog.value='';active.value='archives';archiveTab.value='books';ElMessage.success('档案册 PDF 已生成，原件与文件摘要已保存');}catch(e){notifyError(e);}finally{busy.value=false;}}
function downloadBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportCsv(){const rows=showDocuments.value?[['单据名称','单据编号','日期','类型','客商','金额','状态'],...filteredDocs.value.map(d=>[d.name,d.number,d.date,statusLabel(d.type),d.supplier,d.amount,collectionStatusLabel(d)])]:[['凭证号','期间','日期','摘要','客商','金额','状态'],...filteredVouchers.value.map(v=>[v.no,v.period,v.date,v.summary,v.supplier,v.amount,collectionStatusLabel(v)])];downloadBlob(new Blob(['\uFEFF'+rows.map(r=>r.map(c=>'"'+String(c).replaceAll('"','""')+'"').join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),showDocuments.value?'单据检索结果.csv':'凭证检索结果.csv');}
async function ensureArchivePdf(a:ArchiveBook):Promise<Blob>{
 if(a.fileId){const saved=await loadFile(a.fileId);if(saved)return saved;throw new Error('档案文件未找到，请检查浏览器本地存储');}
 pdfTemplateActive.value=true;
 try{
 await nextTick();await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
 const nodes=pdfNodes.value?.querySelectorAll<HTMLElement>('.export-sheet');if(!nodes?.length)throw new Error('档案信息页尚未准备完成');
 const {toJpeg}=await import('html-to-image');let output:ArrayBuffer;let pages=0;
 if(archiveRecords.value.length){
  const {PDFDocument}=await import('pdf-lib');const pdf=await PDFDocument.create();
  const records=[...archiveRecords.value];
  for(let i=0;i<records.length;i++){
   const record=records[i]!;const file=record.fileId?await loadFile(record.fileId):undefined;
   if(record.fileId&&!file)throw new Error(`${record.fileName||record.no} 原始文件已丢失，无法归档`);
   if(file&&/\.pdf$/i.test(record.fileName||'')){
    let original;try{original=await PDFDocument.load(await file.arrayBuffer());}catch{throw new Error(`${record.fileName} 无法读取，请先检查 PDF 是否加密或损坏`);}
    const copied=await pdf.copyPages(original,original.getPageIndices());copied.forEach(p=>pdf.addPage(p));
   }else if(file){
    const bytes=await file.arrayBuffer();const image=/\.png$/i.test(record.fileName||'')?await pdf.embedPng(bytes):await pdf.embedJpg(bytes);const page=pdf.addPage([595,842]);const fit=image.scale(Math.min(555/image.width,802/image.height));page.drawImage(image,{x:(595-fit.width)/2,y:(842-fit.height)/2,width:fit.width,height:fit.height});
   }else{
    const uri=await toJpeg(nodes[i]!,{quality:0.92,pixelRatio:1.5,backgroundColor:'#ffffff',skipFonts:true});const bytes=await(await fetch(uri)).arrayBuffer();const image=await pdf.embedJpg(bytes);const page=pdf.addPage([595,842]);page.drawImage(image,{x:15,y:15,width:565,height:812});
   }
  }
  pdf.setTitle(`汇通云本地档案 ${a.period}`);pdf.setSubject('原件及结构化信息整理；非可信时间戳或法定存证');pages=pdf.getPageCount();output=(await pdf.save()).buffer as ArrayBuffer;
 }else{
  const {jsPDF}=await import('jspdf');const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
  for(let i=0;i<nodes.length;i++){const uri=await toJpeg(nodes[i]!,{quality:0.92,pixelRatio:1.5,backgroundColor:'#ffffff',skipFonts:true});if(i)pdf.addPage();pdf.addImage(uri,'JPEG',10,10,190,277);}
  pdf.setProperties({title:`汇通云演示档案 ${a.period}`,subject:'演示样张，不是正式会计存档'});output=pdf.output('arraybuffer');pages=nodes.length;
 }
 const bytes=await crypto.subtle.digest('SHA-256',output);const hash=Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('');
 const blob=new Blob([output],{type:'application/pdf'}),fileId=crypto.randomUUID();await saveFiles([{id:fileId,file:blob}]);a.fileId=fileId;a.hash=hash;a.pageCount=pages;return blob;
 }finally{pdfTemplateActive.value=false;}
}
async function exportPdf(){
 const a=selectedArchive.value;if(exportBusy.value||!a)return;exportBusy.value=true;
 try{const blob=await ensureArchivePdf(a);const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());const actual=Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,'0')).join('');if(actual!==a.hash)throw new Error('文件摘要校验失败，停止下载');localStorage.setItem('langchao:last-export-hash',actual);downloadBlob(blob,`汇通云_${a.id.startsWith('arc-')?'演示样册':'本地档案'}_${a.period}.pdf`);ElMessage.success('PDF 已导出，SHA-256 校验通过');}catch(e){notifyError(e);}finally{exportBusy.value=false;}
}
const resetBusy=ref(false);
async function reset(){
 if(resetBusy.value||busy.value||exportBusy.value||autoBusy.value||partySyncing.value){ElMessage.info('正在处理数据，请稍后再重置');return;}
 resetBusy.value=true;
 try{
  await ElMessageBox.confirm('将清空本浏览器的全部凭证、原始单据、关联记录、档案册、操作日志及上传文件，恢复默认匹配规则。清空后不再恢复演示数据，此操作无法撤销。','重置并清空数据',{confirmButtonText:'重置',cancelButtonText:'取消',type:'warning'});
  busy.value=true;await store.resetData();
  previewOpen.value=false;editOpen.value=false;batchOpen.value=false;dialog.value='';helpOpen.value=false;
  focusVoucher.value=undefined;editRecord.value=undefined;previewFile.value={};selectedDocIds.value=[];
  selectedArchiveId.value='';archiveGroupId.value='';originalCategories.value=[];bookPage.value=0;
  query.value='';globalQuery.value='';archiveSearch.value='';period.value='';archivePeriod.value='';
  statusFilter.value='all';minAmount.value=undefined;maxAmount.value=undefined;listPage.value=1;
  archiveTab.value='matching';clearSelection();ElMessage.success('所有数据和文件已清空');
 }catch(error){if(error!=='cancel'&&error!=='close')notifyError(error);}
 finally{busy.value=false;resetBusy.value=false;}
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#" aria-label="汇通云 · 电子会计档案" @click.prevent="navigate('archives')"><span class="brand-mark"><img src="/huitong-cloud.svg" width="44" height="44" alt="" decoding="async"/></span><span>汇通云<small>HUITONG CLOUD</small></span></a>
      <div class="workspace-switch"><FeatureIcon name="cloud" :size="32" compact/><span>企业财务档案中心<small>企业工作空间</small></span><ChevronDown :size="14"/></div>
      <p class="nav-caption">财务工作空间</p>
      <nav><button v-for="item in nav" :key="item.id" :title="item.label" :aria-label="item.label" :class="['nav-item',{active:active===item.id}]" @click="navigate(item.id)"><FeatureIcon :name="item.id" :size="34" compact/><span>{{item.label}}</span><span v-if="item.id==='exceptions' && (reviewVouchers.length+reviewDocuments.length)" class="nav-count">{{reviewVouchers.length+reviewDocuments.length}}</span><i v-if="item.id==='archives'" class="nav-dot"/></button></nav>
      <div class="sidebar-bottom"><div class="storage"><div><span><ShieldCheck :size="15"/> 安全归档空间</span><span>本地存储</span></div><small>原始文件与业务记录保存在当前浏览器</small></div><button class="settings-nav" @click="helpOpen=true"><CircleHelp :size="18"/>使用帮助与系统说明<ChevronRight :size="14"/></button><div class="profile"><span class="avatar">{{accountInitial}}</span><span :title="accountName">{{accountName}}<small><span>{{accountRole}}</span><span>已登录</span></small></span><button v-if="isSuperAdmin" class="icon-btn" title="重置并清空数据" aria-label="重置并清空数据" :disabled="resetBusy||busy||exportBusy||autoBusy||partySyncing" @click="reset"><RefreshCw :size="19"/></button></div></div>
    </aside>

    <div class="main-shell">
      <header class="topbar"><div class="breadcrumb"><PanelLeftClose :size="18"/><span>财务档案中心</span><ChevronRight :size="13"/><strong>{{titles[active]||'凭证检索'}}</strong></div><div class="header-right"><div class="global-search"><Search :size="16"/><input v-model="globalQuery" placeholder="搜索凭证、单据、档案…" aria-label="全局搜索" @keyup.enter="doGlobalSearch"/><kbd>↵</kbd></div><button class="icon-btn" title="使用帮助" @click="helpOpen=true"><CircleHelp :size="19"/></button><button class="notification icon-btn" title="查看操作日志" @click="navigate('logs')"><Bell :size="19"/><i/></button><span class="header-divider"/><span class="avatar small" :title="accountName">{{accountInitial}}</span><button class="icon-btn" title="退出登录" aria-label="退出登录" :disabled="signingOut||busy||exportBusy||autoBusy" @click="signOut"><LogOut :size="19"/></button></div></header>
      <main><el-alert v-if="storageError" :title="storageError" type="error" :closable="false" show-icon style="margin-bottom:16px"/>
        <div :class="['page-heading',{'archive-page-heading':active==='archives'}]"><div><div class="eyebrow"><span/>财务档案中心 <span class="eyebrow-divider">/</span> 全流程数字归档</div><h1>{{titles[active]||'凭证与档案检索'}}</h1><p>{{subtitles[active]||'通过凭证号、发票号、客商及金额范围，快速找到所需凭证。'}}</p></div><div class="heading-actions"><span class="demo-label"><i/>本地工作空间</span><template v-if="active==='archives'"><button v-if="archiveTab!=='matching'" class="btn" :disabled="exportBusy||!selectedArchive" @click="exportPdf"><ArrowDownToLine :size="16"/>{{exportBusy?'正在生成 PDF…':'导出档案册'}}</button><button class="btn primary" @click="openArchiveGenerator()"><Plus :size="17"/>生成档案册</button></template><button v-else-if="active==='data'" class="btn primary" @click="openBatch"><Upload :size="16"/>{{dataTab==='vouchers'?'批量导入凭证':'批量上传单据'}}</button><button v-else-if="active==='match'||active==='overview'" class="btn primary" :disabled="autoBusy||partySyncing" @click="runAuto"><WandSparkles :size="17"/>{{partySyncing?'核对付款人…':autoBusy?'正在匹配…':active==='overview'?'前往智能匹配':'开始自动匹配'}}</button></div></div>

        <UserManagement v-if="active==='users'&&isSuperAdmin"/>

        <section class="metrics" v-if="['archives','overview','match','exceptions'].includes(active)">
          <article class="metric"><FeatureIcon :name="active==='archives'?'archives':'data'" :size="48"/><div><p>{{active==='archives'?'已归档册数':'记账凭证总数'}}<span class="info-dot">i</span></p><strong>{{active==='archives'?state.archives.length:state.vouchers.length}}<small>{{active==='archives'?'册':'张'}}</small></strong><span class="metric-note"><span class="green-dot"/>{{active==='archives'?'按期间有序归档':'ERP 凭证数据'}}</span></div><span class="metric-spark spark-blue"><i/><i/><i/><i/><i/><i/><i/></span></article>
          <article class="metric"><FeatureIcon name="verified" :size="48"/><div><p>已关联凭证<span class="info-dot">i</span></p><strong>{{matched.length}}<small>张</small></strong><span class="metric-note">关联 {{state.documents.filter(d=>collectionStatus(d)==='matched').length}} 份原始单据</span></div><span class="metric-spark spark-purple"><i/><i/><i/><i/><i/><i/><i/></span></article>
          <article class="metric"><FeatureIcon name="match" :size="48"/><div><p>关联覆盖率<span class="info-dot">i</span></p><strong>{{matchRate}}<small>%</small></strong><span class="metric-note">根据当前凭证实时计算</span></div><svg class="mini-line" width="75" height="32" viewBox="0 0 75 32"><path d="M1 29 12 23 22 26 33 14 44 17 56 7 65 10 74 2" fill="none" stroke="#31b3a4" stroke-width="2"/></svg></article>
          <article class="metric"><FeatureIcon name="exceptions" :size="48"/><div><p>待处理凭证<span class="info-dot">i</span></p><strong>{{pending.length}}<small>张</small></strong><button class="metric-link" @click="navigate('exceptions')">前往异常处理 <ArrowRight :size="12"/></button></div><span class="metric-ring"><Check :size="22"/></span></article>
        </section>

        <template v-if="active==='archives'">
          <div class="section-tabs"><div><button :class="{selected:archiveTab==='books'}" @click="archiveTab='books'"><BookOpen :size="17"/>档案册管理<span>{{state.archives.length}}</span></button><button :class="{selected:archiveTab==='matching'}" @click="archiveTab='matching'"><GitBranch :size="17"/>已匹配归档<span>{{payerGroups.length}}</span></button><button :class="{selected:archiveTab==='search'}" @click="archiveTab='search'"><FileSearch :size="17"/>凭证检索</button><button :class="{selected:archiveTab==='history'}" @click="archiveTab='history'"><Clock3 :size="17"/>归档记录</button></div><span><ShieldCheck :size="14"/> 全流程可追溯</span></div>
          <MatchedArchivePanel v-if="archiveTab==='matching'" :groups="payerGroups" :focus-group-id="archiveGroupId" :vouchers="state.vouchers" :documents="state.documents" :run="state.lastMatchRun" @view="viewFile" @review="record=>openEdit(record,'no' in record?'voucher':'document')" @reconcile="openAttachments" @generate="openArchiveGenerator" @match="navigate('match')"/>
          <section v-else-if="archiveTab==='books'" class="archive-workspace">
            <aside class="archive-list"><div class="list-title"><h3>我的档案册 <span>{{filteredArchives.length}}</span></h3><button class="icon-btn" title="生成档案册" @click="openArchiveGenerator()"><Plus :size="18"/></button></div><div class="archive-search"><Search :size="15"/><input v-model="archiveSearch" placeholder="搜索档案名称、凭证号" aria-label="搜索档案册"/></div><div class="archive-filter"><el-select v-model="archivePeriod" size="small" placeholder="全部期间" clearable><el-option v-for="p in availablePeriods" :key="p" :label="p.replace('-','年')+'月'" :value="p"/></el-select><span>按期间排序 <ArrowDown :size="12"/></span></div><div class="book-list"><button v-for="a in filteredArchives" :key="a.id" :class="['book-card',{selected:selectedArchive?.id===a.id}]" @click="selectArchive(a)"><span class="mini-cover"><span>会计凭证</span><i/><i/><i/><small>{{a.period}}</small></span><div><h4>{{a.title}}</h4><p>{{a.startVoucherNo}} — {{a.endVoucherNo}}</p><span class="book-meta">{{a.voucherCount}} 张凭证 <b>·</b> {{a.pageCount}} 页</span><span class="archive-badge"><LockKeyhole :size="10"/>已归档</span></div><ChevronRight :size="15" class="book-arrow"/></button><div v-if="!filteredArchives.length" class="empty"><FeatureIcon name="archives" :size="60"/><p>当前期间暂无档案册</p><button class="text-link" @click="openArchiveGenerator()">生成第一本档案册</button></div></div><div class="list-footer"><LockKeyhole :size="13"/>归档后只读，保留完整证据链</div></aside>
            <section ref="viewer" class="viewer"><template v-if="selectedArchive"><div class="viewer-heading"><div><span class="file-type"><BookOpen :size="21"/></span><div><h3>{{selectedArchive.title}}<span class="verified-pill"><ShieldCheck :size="11"/>{{archiveRecords.length?'原件预览':'演示样册'}}</span></h3><p>{{selectedArchive.period.replace('-',' 年 ')}} 月 <b>·</b> {{selectedArchive.startVoucherNo}} — {{selectedArchive.endVoucherNo}} <b>·</b> {{selectedArchive.voucherCount}} 张凭证</p></div></div><div><button class="icon-btn" title="档案信息与存证" @click="dialog='archiveInfo'"><ShieldCheck :size="18"/></button><button class="icon-btn" title="全屏预览" @click="toggleFullscreen"><Fullscreen :size="18"/></button></div></div>
              <div class="book-stage"><span class="preview-label"><span/>仿真翻页预览</span><div v-if="showCatalog" class="catalog-popup"><h4>档案目录 <button class="icon-btn" @click="showCatalog=false"><X :size="14"/></button></h4><button v-for="(name,i) in categories" :key="i" :class="{current:bookPage===i}" @click="book?.goTo(i);showCatalog=false"><span>{{String(i+1).padStart(2,'0')}}</span>{{name}}</button></div><div class="book-wrapper" :style="{transform:`scale(${zoom/100})`}"><FlipBook :key="selectedArchive.id" ref="book" :title="selectedArchive.title" :period="selectedArchive.period" :voucher-no="previewVoucher?.no" :supplier="previewVoucher?.supplier" :amount="previewVoucher?.amount" :records="archiveRecords.length?archiveRecords:undefined" @page-change="onPage" @pages-ready="onOriginalPages"/></div><div class="flip-hint"><svg width="19" height="17" viewBox="0 0 19 17"><path d="m4 5 4-3 4 3M8 2v8c0 5 7 5 7 0V7" stroke="currentColor" fill="none" stroke-width="1.2"/></svg>拖动页角或点击页面，即可翻页 <span>← →</span> 键盘也能翻阅</div></div>
              <div class="viewer-toolbar"><div><button :class="['tool-button',{pressed:showCatalog}]" @click="showCatalog=!showCatalog"><ListTree :size="16"/>目录</button><span class="tool-divider"/><button class="icon-btn" title="缩小" :disabled="zoom<=75" @click="zoom=Math.max(75,zoom-5)"><ZoomOut :size="16"/></button><span class="zoom-value">{{zoom}}%</span><button class="icon-btn" title="放大" :disabled="zoom>=115" @click="zoom=Math.min(115,zoom+5)"><ZoomIn :size="16"/></button></div><div class="page-controls"><button class="icon-btn" aria-label="上一页" :disabled="bookPage<=0" @click="book?.prev()"><ChevronLeft :size="19"/></button><span><b>{{String(Math.min(bookPage+1,pageCount)).padStart(2,'0')}}</b> / {{String(pageCount).padStart(2,'0')}}</span><button class="icon-btn" aria-label="下一页" :disabled="bookPage>=pageCount-1" @click="book?.next()"><ChevronRight :size="19"/></button></div><button class="tool-button" @click="book?.goTo(0)"><BookOpen :size="16"/>{{archiveRecords.length?'查看首页':'查看封面'}}</button></div>
              <div class="thumbnail-strip"><button v-for="(name,i) in categories.slice(0,8)" :key="i" :class="['thumbnail',{selected:bookPage===i||bookPage===i-1}]" :aria-label="`跳转到${name}`" @click="book?.goTo(i)"><span :class="['thumb-paper',{'thumb-cover':i===0}]"><strong>{{name}}</strong><i/><i/><i/><i/><i/><span v-if="i===3" class="thumb-seal"/></span><small>{{i+1}}<span>{{name}}</span></small></button></div>
            </template><div v-else class="empty archive-empty"><FeatureIcon name="archives" :size="96"/><h3>让每一份凭证，妥善归档</h3><p>完成数据采集与关联后，在这里生成、查阅和翻阅电子档案。</p><button class="btn primary" @click="navigate('data')"><Upload :size="16"/>去采集数据</button><span class="empty-assurance"><ShieldCheck :size="14"/>原件留存 · 关联清晰 · 便捷查阅</span></div></section>
          </section>
          <section v-else-if="archiveTab==='history'" class="panel"><div class="panel-heading"><h3>归档记录</h3><span>档案册信息与生成记录</span></div><el-table :data="state.archives"><el-table-column prop="title" label="档案册名称" min-width="200"/><el-table-column prop="period" label="会计期间"/><el-table-column prop="voucherCount" label="凭证数量"/><el-table-column prop="createdAt" label="生成时间" min-width="180"/><el-table-column label="状态"><template #default><span class="status matched"><LockKeyhole :size="12"/>已归档</span></template></el-table-column><el-table-column label="操作"><template #default="{row}"><button class="text-link" @click="selectArchive(row);archiveTab='books'">查看档案</button></template></el-table-column></el-table></section>
        </template>

        <template v-if="active==='overview'"><section class="workspace-hero"><div class="hero-copy"><span class="hero-kicker"><span/> FINANCE WORKSPACE</span><h2>财务有据，<span>归档有序。</span></h2><p>从第一张凭证开始，将数据采集、智能关联与电子归档连接起来。</p><div class="hero-actions"><button class="btn primary" @click="navigate('data');dataTab='vouchers';openBatch()"><Upload :size="17"/>开始采集凭证</button><button class="text-link" @click="navigate('rules')">查看匹配规则 <ArrowRight :size="16"/></button></div></div><div class="hero-illustration" aria-hidden="true"><span class="hero-orbit"/><div class="hero-document back"><i/><i/><i/></div><div class="hero-document front"><FeatureIcon name="archives" :size="64"/><strong>电子会计档案</strong><span><span/> 凭证与原件有序留存</span></div><span class="hero-floating hero-floating-one"><FeatureIcon name="verified" :size="40"/>证据可追溯</span><span class="hero-floating hero-floating-two"><FeatureIcon name="match" :size="34"/>智能关联</span></div></section><div class="overview-grid"><section class="panel"><div class="panel-heading"><h3>归档流程</h3><span>完整财务证据链</span></div><div class="workflow"><button v-for="(item,i) in [{name:'数据采集',text:'ERP 凭证与单据接入',id:'data',icon:Database},{name:'智能匹配',text:'按规则关联凭证与主体',id:'match',icon:GitBranch},{name:'异常复核',text:'补齐与确认关联关系',id:'exceptions',icon:FileCheck2},{name:'电子归档',text:'PDF 合并与哈希存证',id:'archives',icon:FolderArchive}]" :key="item.id" @click="navigate(item.id)"><FeatureIcon :name="item.id" :size="56"/><strong>{{item.name}}</strong><small>{{item.text}}</small><ChevronRight v-if="i<3" :size="16" class="workflow-arrow"/></button></div><div class="info-banner"><Sparkles :size="19"/><span>当前启用 {{state.rules.filter(r=>r.enabled).length}} 条规则，{{pending.length}} 张凭证等待匹配。</span><button class="text-link" @click="navigate('rules')">管理规则 <ArrowRight :size="13"/></button></div></section><section class="panel"><div class="panel-heading"><h3>待办事项</h3><span>需要你的关注</span></div><button class="todo" @click="navigate('exceptions')"><FeatureIcon name="exceptions" :size="42"/><span><strong>待匹配凭证</strong><small>检查候选单据，处理匹配异常</small></span><b>{{pending.length}}</b><ChevronRight :size="16"/></button><button class="todo" @click="navigate('data');dataTab='documents'"><FeatureIcon name="data" :size="42"/><span><strong>未关联原始单据</strong><small>补充凭证或手工绑定关联</small></span><b>{{state.documents.filter(x=>collectionStatus(x)!=='matched').length}}</b><ChevronRight :size="16"/></button></section></div><section class="panel activity-panel"><div class="panel-heading"><h3>最近操作</h3><button class="text-link" @click="navigate('logs')">查看全部 <ArrowRight :size="14"/></button></div><div v-if="!state.logs.length" class="activity-empty"><FeatureIcon name="logs" :size="40"/><div><strong>还没有操作记录</strong><p>完成首次采集后，操作将自动记录在这里。</p></div></div><div v-for="log in state.logs.slice(0,5)" :key="log.id" class="activity-row"><span class="activity-icon"><Activity :size="16"/></span><div><strong>{{log.action}}</strong><p>{{log.detail}}</p></div><span>{{log.time}}</span></div></section></template>

        <template v-if="active==='match'"><div class="engine-banner"><FeatureIcon name="match" :size="64"/><div><h3>智能规则引擎</h3><p>从精确标识到金额汇总，按优先级逐级匹配；存在歧义的结果进入人工复核。</p></div><span class="engine-state"><i/>{{autoBusy?'规则执行中':'规则引擎就绪'}}</span></div><div class="rule-chain"><span v-for="(r,i) in orderedRules" :key="r.id" :class="{muted:!r.enabled}"><b>{{r.id}}</b>{{r.name}}<ChevronRight v-if="i<state.rules.length-1" :size="13"/></span></div><el-progress v-if="autoBusy" :percentage="autoProgress" :stroke-width="5" :show-text="false"/></template>

        <section v-if="active==='match'&&state.lastMatchRun" class="panel match-run-summary"><div class="panel-heading"><div><h3>最近匹配结果</h3><p>{{state.lastMatchRun.time}} · {{state.lastMatchRun.period||'全部期间'}}</p></div><button class="btn" @click="active='archives';archiveTab='matching'">查看已匹配归档 <ArrowRight :size="15"/></button></div><div class="match-run-stats"><span>新增匹配 <b>{{state.lastMatchRun.matched}}</b> 张凭证</span><span>已关联分组 <b>{{state.lastMatchRun.groupCount}}</b> 组</span><span v-if="state.lastMatchRun.associatedDocuments!==undefined">已关联单据 <b>{{state.lastMatchRun.associatedDocuments}}</b> 份</span><span v-if="state.lastMatchRun.newlyAssociatedDocuments!==undefined">本次新增 <b>{{state.lastMatchRun.newlyAssociatedDocuments}}</b> 份单据</span><span v-if="state.lastMatchRun.remainingDocuments!==undefined">请复核 <b>{{state.lastMatchRun.remainingDocuments}}</b> 份单据</span><span>未关联 <b>{{state.lastMatchRun.remaining}}</b> 张凭证</span></div><p class="match-run-note">只有实际关联成功的凭证及单据展示到电子档案。未关联数据保留在复核池，人工核对并完成关联后再展示。</p></section>
        <template v-if="active==='data'"><div class="section-tabs"><div><button :class="{selected:dataTab==='vouchers'}" @click="dataTab='vouchers';query='';statusFilter='all';minAmount=undefined;maxAmount=undefined"><FileText :size="17"/>记账凭证<span>{{state.vouchers.length}}</span></button><button :class="{selected:dataTab==='documents'}" @click="dataTab='documents';query='';statusFilter='all';minAmount=undefined;maxAmount=undefined"><Files :size="17"/>原始单据<span>{{state.documents.length}}</span></button></div><span><Database :size="14"/>支持金蝶 / 用友 / SAP 数据适配</span></div><div class="info-banner" v-if="dataTab==='documents'"><CircleHelp :size="17"/><span>客商名称取原件付款人，收款人单独保留。导入后待匹配；点击开始自动匹配后，成功显示已匹配归档，未关联显示请复核。</span></div></template>

        <div v-if="active==='exceptions'" class="section-tabs"><div><button :class="{selected:exceptionTab==='vouchers'}" @click="exceptionTab='vouchers';statusFilter='all'">请复核凭证<span>{{reviewVouchers.length}}</span></button><button :class="{selected:exceptionTab==='documents'}" @click="exceptionTab='documents';statusFilter='all'">请复核单据<span>{{reviewDocuments.length}}</span></button></div><span>先核对字段，再手工关联；未关联数据不进入电子档案</span></div>
        <section class="panel records-panel" v-if="['match','exceptions','search'].includes(active)||(active==='data')||(active==='archives'&&archiveTab==='search')">
          <div class="record-filters"><div class="filter-search"><Search :size="16"/><input v-model="query" :placeholder="showDocuments?'搜索单据名称、编号、客商':'搜索凭证号、发票号、合同号、客商'" aria-label="搜索凭证或单据"/></div><el-select v-model="period" placeholder="全部期间" clearable style="width:145px"><el-option v-for="p in availablePeriods" :key="p" :label="p.replace('-','年')+'月'" :value="p"/></el-select><el-select v-model="statusFilter" style="width:125px"><el-option label="全部状态" value="all"/><el-option label="已匹配归档" value="matched"/><el-option label="待匹配" value="pending"/><el-option label="请复核" value="review"/><el-option v-if="!showDocuments" label="附件缺失" value="missing"/></el-select><button class="btn" :class="{pressed:advanced}" @click="advanced=!advanced"><ListFilter :size="16"/>筛选</button><button class="icon-btn" title="导出检索结果 CSV" @click="exportCsv"><ArrowDownToLine :size="18"/></button></div><div class="bulk-actions"><span>已选 <b>{{showDocuments?selectedDocumentIds.length:selectedVoucherIds.length}}</b> 条（本页）<small> · 已归档记录不可勾选删除</small></span><span class="list-sort-hint"><ArrowDown :size="13"/>最新导入在前</span><button class="btn danger" :disabled="busy||autoBusy||!(showDocuments?selectedDocumentIds.length:selectedVoucherIds.length)" @click="deleteSelected"><Trash2 :size="14"/>批量删除</button></div><div v-if="advanced" class="advanced-filters"><span>金额范围</span><el-input-number v-model="minAmount" :min="0" :precision="2" placeholder="最低金额"/><span>—</span><el-input-number v-model="maxAmount" :min="0" :precision="2" placeholder="最高金额"/><button class="text-link" @click="minAmount=undefined;maxAmount=undefined;query='';statusFilter='all'">清空条件</button></div>
          <el-table v-if="showDocuments" ref="documentTable" :key="'documents-'+active" :data="pagedDocs" row-key="id" @selection-change="(rows:SourceDocument[])=>selectedDocumentIds=rows.map(r=>r.id)"><el-table-column type="selection" width="46" :selectable="(row:SourceDocument)=>!store.isDocumentLocked(row)"/><el-table-column prop="name" label="单据名称" min-width="220"><template #default="{row}"><div class="document-cell"><span class="doc-icon"><FileText :size="17"/></span><button class="text-link doc-name" @click="viewFile(row)">{{row.name}}<small>{{row.number||'未补录编号'}}</small></button></div></template></el-table-column><el-table-column label="类型" width="120"><template #default="{row}">{{statusLabel(row.type)}}</template></el-table-column><el-table-column prop="payerName" label="客商名称（付款人）" min-width="220"><template #default="{row}"><span class="supplier-cell">{{(row.payerName??(row.sourceKind==='pdf-text'?'':row.supplier))||'请复核付款人'}}</span><small v-if="row.payeeName" class="doc-payee">收款人：{{row.payeeName}}</small></template></el-table-column><el-table-column label="金额（元）" align="right" width="140"><template #default="{row}"><span class="amount-cell">{{money(row.amount)}}</span></template></el-table-column><el-table-column label="收款账号" min-width="175"><template #default="{row}">{{row.payeeAccount||'未录入'}}</template></el-table-column><el-table-column prop="date" label="单据日期" width="130"/><el-table-column label="备注" min-width="230"><template #default="{row}"><span style="white-space:pre-wrap">{{row.remarks||'—'}}</span></template></el-table-column><el-table-column label="状态" width="145"><template #default="{row}"><span :class="['status',collectionStatus(row)]">{{collectionStatusLabel(row)}}</span><small v-if="row.lastMatchReason&&collectionStatus(row)==='review'" class="match-reason" :title="row.lastMatchReason">{{row.lastMatchReason}}</small><small v-if="row.nameAssociationIds?.length&&row.status!=='matched'" class="doc-payee">按付款 / 收款名称关联</small></template></el-table-column><el-table-column label="操作" width="285" :fixed="compactLayout?false:'right'"><template #default="{row}"><button class="text-link" @click="viewFile(row)">查看原件</button><button v-if="!store.isDocumentLocked(row)&&(row.status!=='matched'||row.extractionStatus==='pending')" class="text-link subtle" @click="openEdit(row,'document')">补录复核</button><button v-if="row.type==='invoice'&&!row.seal&&!store.isDocumentLocked(row)" class="text-link subtle" @click="seal(row)">核验印章</button></template></el-table-column></el-table>
          <el-table v-else ref="voucherTable" :key="'vouchers-'+active" :data="pagedVouchers" row-key="id" @row-dblclick="showEvidence" @selection-change="(rows:Voucher[])=>selectedVoucherIds=rows.map(r=>r.id)"><el-table-column type="selection" width="46" :selectable="(row:Voucher)=>!store.isVoucherLocked(row)"/><el-table-column v-if="!compactLayout" type="index" :index="(index:number)=>(listPage-1)*pageSize+index+1" label="序号" width="66"/><el-table-column prop="no" label="凭证号" min-width="115"><template #default="{row}"><button class="voucher-number" @click="showEvidence(row)"><FileText :size="15"/>{{row.no}}</button></template></el-table-column><el-table-column prop="summary" label="凭证摘要 / 客商" min-width="235"><template #default="{row}"><div class="summary-cell">{{row.summary}}<small>{{row.supplier||'请复核客商'}}</small></div></template></el-table-column><el-table-column label="金额（元）" align="right" min-width="125"><template #default="{row}"><span class="amount-cell">{{money(row.amount)}}</span></template></el-table-column><el-table-column prop="date" label="凭证日期" width="125"/><el-table-column label="匹配状态" width="145"><template #default="{row}"><span :class="['status',collectionStatus(row)]"><CheckCheck v-if="row.status==='matched'" :size="12"/>{{collectionStatusLabel(row)}}</span><small v-if="row.lastMatchReason&&row.status!=='matched'" class="match-reason" :title="row.lastMatchReason">{{row.lastMatchReason}}</small></template></el-table-column><el-table-column label="置信度" width="100"><template #default="{row}"><span :class="{'confidence':row.status==='matched'}">{{row.confidence ? `${(row.confidence<=1?row.confidence*100:row.confidence).toFixed(1)}%`:'—'}}</span></template></el-table-column><el-table-column label="操作" width="285" :fixed="compactLayout?false:'right'"><template #default="{row}"><button v-if="row.status==='matched'" class="text-link" @click="showEvidence(row)">关联穿透</button><template v-else><button class="text-link" @click="openManual(row)">手工匹配</button><button v-if="row.status!=='missing'" class="text-link subtle" @click="openMissing(row)">标记缺失</button><button v-else class="text-link subtle" @click="restore(row)">恢复待匹配</button><button v-if="!store.isVoucherLocked(row)" class="text-link subtle" @click="openEdit(row,'voucher')">{{row.reviewStatus==='pending'?'补录':'编辑'}}</button></template><button v-if="row.status==='matched'&&row.reviewStatus==='pending'&&!store.isVoucherLocked(row)" class="text-link subtle" @click="openEdit(row,'voucher')">核对字段</button><button v-if="collectionStatus(row)==='matched'&&!store.isVoucherLocked(row)" class="text-link subtle" @click="unmatch(row)">解除匹配</button><button v-if="row.fileId" class="text-link subtle" @click="viewFile(row)">原件</button></template></el-table-column></el-table><div class="table-footer"><span>共 {{showDocuments?filteredDocs.length:filteredVouchers.length}} 条记录 <span class="muted-text">· 当前浏览器本地数据</span></span><el-pagination v-model:current-page="listPage" v-model:page-size="pageSize" :page-sizes="[10,20,50,100]" :total="showDocuments?filteredDocs.length:filteredVouchers.length" layout="sizes, prev, pager, next" small/></div>
        </section>

        <template v-if="active==='rules'"><div class="info-banner"><GitBranch :size="18"/><span>回单逐行核对金额、收款账号与日期。候选不唯一或条件不符时，转入人工复核。</span><span class="tag">金额＋账号＋日期</span></div><div class="rules-grid"><article v-for="r in orderedRules" :key="r.id" :class="['rule-card',{disabled:!r.enabled}]"><div class="rule-card-top"><FeatureIcon :name="r.matchType==='exact'?'verified':r.matchType==='aggregate'?'match':'rules'" :size="36"/><span class="rule-id">{{r.id}}</span><span class="priority">优先级 {{r.priority}}</span><el-switch :model-value="r.enabled" @change="toggleRule(r)"/></div><h3>{{r.name}}</h3><p>{{r.description}}</p><div class="rule-properties"><span>置信阈值<b>{{Math.round(r.threshold<=1?r.threshold*100:r.threshold)}}%</b></span><span>金额容差<b>¥ {{money(r.tolerance)}}</b></span><span>日期窗口<b>{{r.dateWindow}} 天</b></span></div><button class="btn" @click="editRule(r)"><Settings2 :size="15"/>{{r.id==='R09'?'查看匹配条件':'配置规则'}}</button></article></div></template>
        <section class="panel" v-if="active==='logs'"><div class="panel-heading"><h3>操作审计记录</h3><span>{{state.logs.length}} 条记录 · 操作留痕</span></div><el-table :data="state.logs"><el-table-column prop="time" label="操作时间" width="200"/><el-table-column prop="action" label="操作类型" width="150"/><el-table-column prop="detail" label="操作详情" min-width="350"/><el-table-column prop="operator" label="操作人" width="150"/></el-table></section>
        <footer class="page-footer"><span>汇通云 · 电子会计档案管理</span><span><ShieldCheck :size="13"/>数据有据可依，归档有迹可循<span class="footer-dot">·</span>V 2.7</span></footer>
      </main>
    </div>

    <BatchImportDialog v-if="batchOpen" v-model="batchOpen" :kind="batchKind" @imported="afterImported"/>
    <RecordEditDialog v-model="editOpen" :kind="editKind" :record="editRecord" @saved="edited"/>
    <FilePreviewDialog v-model="previewOpen" v-bind="previewFile"/>
    <VoucherAttachmentsDialog v-model="attachmentOpen" :voucher="attachmentVoucher" :documents="state.documents" @view="viewFile"/>
    <el-dialog v-model="helpOpen" title="使用帮助与系统说明" width="650px"><div class="help-content"><div class="help-brand"><ShieldCheck :size="32"/><div><h3>汇通云 · 电子会计档案</h3><p>从凭证采集到原始单据查阅</p></div></div><p>业务数据保存在当前浏览器中。导入、规则配置、自动匹配、手工关联和操作记录均保存在当前浏览器。</p><ol><li><b>采集数据：</b>批量导入 ZIP、JSON / CSV 或 PDF / 图片。文字型 PDF 读取字段、合并凭证续页并分拆回单；扫描影像需人工补录。提取结果需从列表复核。</li><li><b>执行匹配：</b>按每条分录核对回单金额与收款账号（尾号至少4位），日期差须小于30天；不确定的候选留待人工复核。</li><li><b>处理异常：</b>手工选择单据、填写关联原因，或记录附件缺失。</li><li><b>查阅档案：</b>点击页角、拖动页面或使用 ← →；目录与缩略图可直接跳转。</li></ol><div class="info-banner"><CircleHelp :size="19"/><span>样册和前端导出的 PDF 为演示文件。正式归档、OCR 识别、ERP 接入及只读存证由配套 Java 后端完成，需配置 MySQL、Redis 与 OCR 服务。</span></div><p class="muted-text">匹配率、OCR 准确率与匹配准确率需使用真实标注数据分别评估，界面不提供未经验证的准确率承诺。</p></div></el-dialog>
    <el-dialog :model-value="dialog!==''" @close="dialog=''" :title="({create:'生成电子档案册',manual:'手工匹配凭证',missing:'标记附件缺失',rule:'配置匹配规则',import:'导入 ERP 凭证',upload:'上传原始单据',evidence:'凭证关联证据链',archiveInfo:'档案信息与文件存证'} as Record<string,string>)[dialog]" :width="dialog==='manual'||dialog==='evidence'?'780px':'580px'" destroy-on-close>
      <template v-if="dialog==='create'"><div class="info-banner"><ShieldCheck :size="18"/><span>校验关联状态、金额、附件数量和发票印章，合并所上传原件；未提供影像的记录生成标明来源的信息页。</span></div><ArchiveRangeForm v-model="createForm" :vouchers="state.vouchers" :archives="state.archives" @validity-change="archiveSelectionValid=$event"/><p class="muted-text">档案 PDF 保存在当前浏览器并计算 SHA-256。正式会计存证仍需后台归档与企业复核；信息页不能替代原始单据。</p></template>
      <template v-else-if="dialog==='manual'&&focusVoucher"><div class="voucher-summary"><span><FileText :size="19"/>{{focusVoucher.no}}</span><strong>¥ {{money(focusVoucher.amount)}}</strong><p>{{focusVoucher.summary}} · {{focusVoucher.supplier}}</p></div><h4 class="dialog-subtitle">推荐候选单据 <small>按与凭证的金额差排序，可多选</small></h4><el-checkbox-group v-model="selectedDocIds" class="candidate-list"><el-checkbox v-for="d in manualCandidates" :key="d.id" :value="d.id"><span><b>{{d.name}}</b><small>{{d.supplier}} · {{d.date}} · {{d.number}}</small></span><strong>¥ {{money(d.amount)}}</strong></el-checkbox><div v-if="!manualCandidates.length" class="empty">暂无未关联单据，请先上传原始单据。</div></el-checkbox-group><div class="selection-total">已选 {{selectedDocIds.length}} 份单据 <strong>合计 ¥ {{money(selectedTotal)}}</strong></div><el-form label-position="top"><el-form-item label="关联原因（必填）"><el-input v-model="manualReason" type="textarea" :rows="2" placeholder="填写人工复核依据，系统将记录操作日志"/></el-form-item></el-form></template>
      <template v-else-if="dialog==='missing'&&focusVoucher"><div class="voucher-summary"><span>{{focusVoucher.no}}</span><strong>¥ {{money(focusVoucher.amount)}}</strong><p>{{focusVoucher.summary}}</p></div><el-form label-position="top"><el-form-item label="附件缺失原因（必填）"><el-input v-model="missingReason" type="textarea" :rows="4" placeholder="例如：供应商尚未提供纸质发票，预计月底补齐"/></el-form-item></el-form></template>
      <template v-else-if="dialog==='rule'&&editingRule"><div class="rule-dialog-title"><span class="rule-id">{{editingRule.id}}</span><h3>{{editingRule.name}}</h3></div><div class="rule-config-fields"><el-form label-position="top"><div class="form-columns"><el-form-item label="执行优先级（数字越小越先执行）"><el-input-number v-model="ruleForm.priority" :min="1" :max="100" :precision="0"/></el-form-item><el-form-item label="匹配策略"><el-select v-model="ruleForm.matchType"><el-option label="精确匹配" value="exact"/><el-option label="模糊匹配" value="fuzzy"/><el-option label="同类单据汇总" value="aggregate"/></el-select></el-form-item></div><el-form-item label="关联用途"><el-select v-model="ruleForm.associationScope"><el-option label="凭证金额与附件核对" value="voucher"/><el-option label="企业名称关联" value="party"/></el-select></el-form-item><el-form-item label="名称字段"><el-select v-model="ruleForm.partyField"><el-option label="付款人名称（默认客商）" value="payerName"/><el-option label="收款人名称" value="payeeName"/><el-option label="付款人或收款人（企业名称）" value="either"/></el-select></el-form-item><el-form-item label="适用单据类型"><el-checkbox-group v-model="ruleForm.documentTypes"><el-checkbox value="invoice">发票</el-checkbox><el-checkbox value="bank">银行回单</el-checkbox><el-checkbox value="contract">合同</el-checkbox><el-checkbox value="approval">审批单</el-checkbox></el-checkbox-group></el-form-item><el-form-item label="匹配置信阈值（%）"><el-slider v-model="ruleForm.threshold" :min="50" :max="100" show-input/></el-form-item><div class="form-columns"><el-form-item label="校验金额"><el-switch v-model="ruleForm.requireAmount" :disabled="ruleForm.associationScope==='party'"/></el-form-item><el-form-item label="金额绝对容差（元）"><el-input-number v-model="ruleForm.tolerance" :min="0" :max="100" :precision="2" :step="0.01" :disabled="!ruleForm.requireAmount||ruleForm.associationScope==='party'"/></el-form-item></div><div class="form-columns"><el-form-item label="校验日期"><el-switch v-model="ruleForm.requireDate" :disabled="ruleForm.associationScope==='party'"/></el-form-item><el-form-item label="日期匹配窗口（天）"><el-input-number v-model="ruleForm.dateWindow" :min="0" :max="366" :precision="0" :disabled="!ruleForm.requireDate||ruleForm.associationScope==='party'"/></el-form-item></div></el-form><p class="muted-text">企业名称关联按付款人 / 收款人归集同期间至少两份原始单据；已有对应凭证时同步关联凭证单位。该关联不代替凭证金额核对。汇总金额仍不混加发票与银行回单。配置保存后用于下一次自动匹配；正式归档仍执行金额及复核校验。</p></div></template>
      <template v-else-if="dialog==='evidence'&&focusVoucher"><div class="voucher-summary"><span><FileText :size="19"/>{{focusVoucher.no}}</span><strong>¥ {{money(focusVoucher.amount)}}</strong><p>{{focusVoucher.summary}} · {{focusVoucher.supplier}}</p></div><el-alert v-if="focusVoucher.reviewReasons?.length" :title="focusVoucher.reviewReasons.join('；')" type="warning" :closable="false"/><p v-if="focusVoucher.sourcePages?.length" class="muted-text">来源第 {{focusVoucher.sourcePages.join('、')}} 页 · {{focusVoucher.entries?.length||0}} 条分录</p><el-table v-if="focusVoucher.entries?.length" :data="focusVoucher.entries" max-height="230" size="small"><el-table-column prop="summary" label="摘要" min-width="150"/><el-table-column prop="account" label="科目" min-width="150"/><el-table-column prop="debit" label="借方" align="right" width="110"/><el-table-column prop="credit" label="贷方" align="right" width="110"/></el-table><div class="evidence-flow"><div class="evidence-node"><span class="metric-icon blue"><Database :size="21"/></span><div><h4>ERP 记账凭证</h4><p>{{focusVoucher.no}} · {{focusVoucher.date}}</p></div><span :class="['status',collectionStatus(focusVoucher)]">{{collectionStatusLabel(focusVoucher)}}</span></div><div class="relation-link"><GitBranch :size="15"/>{{focusVoucher.ruleId||focusNameGroups[0]?.ruleId||'尚未建立关联'}}<button v-if="focusVoucher.fileId" class="text-link" @click="viewFile(focusVoucher)">查看凭证原件</button><span v-if="focusVoucher.confidence">置信度 {{(focusVoucher.confidence<=1?focusVoucher.confidence*100:focusVoucher.confidence).toFixed(1)}}%</span></div><div v-for="group in focusNameGroups" :key="group.id" class="info-banner"><GitBranch :size="17"/><span>{{group.ruleId}} · 企业名称关联：{{group.payerName}} · {{group.documentIds.length}} 份原件。名称关联记录单位归属，凭证金额关系保留核对。</span><button class="text-link" @click="archiveGroupId=group.id;active='archives';archiveTab='matching';dialog=''">查看企业原件</button></div><div v-for="id in focusVoucher.documentIds" :key="id" class="evidence-node"><span class="metric-icon purple"><FileText :size="21"/></span><div><button class="text-link" @click="viewFile(state.documents.find(d=>d.id===id)!)">{{state.documents.find(d=>d.id===id)?.name}}</button><p>{{state.documents.find(d=>d.id===id)?.number}} · {{state.documents.find(d=>d.id===id)?.date}}</p></div><strong>¥ {{money(state.documents.find(d=>d.id===id)?.amount||0)}}</strong></div><div v-if="!focusVoucher.documentIds.length" class="empty"><FileSearch :size="30"/><p>{{focusVoucher.missingReason||'暂无关联单据，可通过手工匹配补齐证据链。'}}</p></div></div></template>
      <template v-else-if="dialog==='archiveInfo'&&selectedArchive"><div class="archive-info-icon"><ShieldCheck :size="40"/></div><h3 class="center-text">{{selectedArchive.title}}</h3><div class="info-row"><span>会计期间</span><strong>{{selectedArchive.period}}</strong></div><div class="info-row"><span>凭证范围</span><strong>{{selectedArchive.startVoucherNo}} — {{selectedArchive.endVoucherNo}}</strong></div><div class="info-row"><span>凭证数量 / 页数</span><strong>{{selectedArchive.voucherCount}} 张 / {{selectedArchive.pageCount}} 页</strong></div><div class="info-row"><span>当前状态</span><span class="status matched"><LockKeyhole :size="12"/>演示只读档案</span></div><div class="hash-box"><span>SHA-256 文件摘要</span><code>{{selectedArchive.hash||'尚未导出 PDF；导出时计算实际文件摘要。'}}</code></div><div class="info-banner"><CircleHelp :size="17"/><span>浏览器本地状态不构成正式防篡改存证。正式档案的哈希与锁定状态由 Java 后端持久化。</span></div></template>
      <template #footer><button class="btn" @click="dialog=''">{{['evidence','archiveInfo'].includes(dialog)?'关闭':'取消'}}</button><button v-if="!['evidence','archiveInfo'].includes(dialog)" class="btn primary" :disabled="busy||(dialog==='create'&&!archiveSelectionValid)" @click="dialog==='create'?createArchive():dialog==='manual'?bindManual():dialog==='missing'?saveMissing():saveRule()"><RefreshCw v-if="busy" class="spin" :size="15"/>{{busy?'处理中…':dialog==='create'?'校验并生成':dialog==='import'?'确认导入':dialog==='manual'?'确认关联':'保存'}}</button></template>
    </el-dialog>
    <div v-if="pdfTemplateActive" ref="pdfNodes" class="pdf-export" aria-hidden="true"><template v-if="archiveRecords.length"><div v-for="(record,i) in archiveRecords" :key="`${record.kind}-${i}`" class="export-sheet"><ArchiveRecordPage :record="record" :index="i"/></div></template><template v-else-if="selectedArchive"><div v-for="i in 8" :key="i" class="export-sheet"><DocumentPage :page="i-1" :period="selectedArchive?.period||'2026-10'" :voucher-no="previewVoucher?.no" :supplier="previewVoucher?.supplier" :amount="previewVoucher?.amount"/><span class="export-watermark">演示样张 · 非正式会计档案</span></div></template></div>
  </div>
</template>
