import { reactive, watch, ref, nextTick } from 'vue';
import {authState} from './auth';
import { saveFiles, removeFiles, clearFiles, validateMedia, loadFile } from './fileStorage';
import {emptyArchiveState} from './initialState';
import {amountCents} from './money';
import {voucherInputIssues,inputField} from './voucherValidation';
import {validImportSequence} from './recordOrder';
import {evaluateRules} from './matchingEngine';
import {evaluateMatchPlan} from './matchEvaluation';
import {nameAssociationRule,pruneNameAssociations,detachNameAssociations,visibleArchiveGroups} from './nameAssociation';
import {collectionStatus} from './matchWorkflow';
import {normalizeSupplier} from './matchUtils';
import {receiptEntryRule,RECEIPT_RULE_ID,normalizeBankAccount,entryMoney,attachmentCoverage,clearReceiptReference,writeReceiptReference,businessDate} from './entryAttachments';
import type {EntryEvaluation} from './entryAttachments';
export {normalizeSupplier,supplierSimilarity} from './matchUtils';
import type { ArchiveState, ArchiveBook, Voucher, SourceDocument, MatchRule, GenerateArchiveRequest, VoucherEntry, PayerGroup } from './types';

const STORAGE_KEY = 'langchao-cloud-demo-v1';
const localTimeFormatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
const localTime=()=>localTimeFormatter.format(new Date());
const id = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

export {amountCents} from './money';


function restore(): ArchiveState {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ArchiveState;
      if (Array.isArray(parsed.vouchers) && Array.isArray(parsed.documents) && Array.isArray(parsed.archives) && Array.isArray(parsed.rules) && Array.isArray(parsed.logs)) {
        if(!parsed.rules.some(rule=>rule.id==='R08'))parsed.rules.push(nameAssociationRule());
        if(!parsed.rules.some(rule=>rule.id===RECEIPT_RULE_ID))parsed.rules.unshift(receiptEntryRule());
        pruneNameAssociations(parsed);
        const run=parsed.lastMatchRun;
        const outcomes=Array.isArray(run?.outcomes)?run.outcomes:[];
        const attempted=new Set(outcomes.filter(outcome=>outcome&&!outcome.matched).map(outcome=>outcome.voucherId));
        for(const voucher of parsed.vouchers){
          if(voucher.status==='matched')voucher.matchReviewRequired=false;
          else if(voucher.matchReviewRequired===undefined)voucher.matchReviewRequired=attempted.has(voucher.id)||!!voucher.lastMatchReason?.trim()||voucher.status==='missing';
        }
        for(const doc of parsed.documents){
          if(doc.status==='matched')doc.matchReviewRequired=false;
          else if(doc.matchReviewRequired===undefined){
            // 旧版运行记录保存提交游标，之后导入的新单据不能继承上次“请复核”。
            const inRun=!!run&&(!run.period||doc.date.startsWith(run.period));
            const sequence=validImportSequence(doc.importSequence);
            doc.matchReviewRequired=!!doc.lastMatchReason?.trim()||(inRun&&(!sequence||sequence<=(run?.importSequence||0)));
          }
          if(doc.matchReviewRequired&&!doc.lastMatchReason)doc.lastMatchReason='上次匹配未找到对应凭证，请人工复核后关联';
          delete doc.payerGroupId;
        }
        // 旧版本按同名全归集，恢复时移除未关联单据，避免升级后混入档案展示。
        parsed.payerGroups=matchedPayerGroups(parsed);
        for(const group of parsed.payerGroups)for(const docId of group.documentIds){const doc=parsed.documents.find(item=>item.id===docId);if(doc)doc.payerGroupId=group.id;}
        return parsed;
      }
    }
  } catch { /* 关闭存储或旧数据失效时，展示空工作空间。 */ }
  return emptyArchiveState();
}

const state = reactive<ArchiveState>(restore());
const storageError=ref('');
watch(state, () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state));storageError.value=''; } catch { storageError.value='浏览器未能保存数据，可能存储空间不足或存储权限已关闭。请先导出数据，避免刷新后丢失本次更改。'; } }, { deep: true });
let matching = false;
let writing=false;
async function write<T>(operation:()=>Promise<T>):Promise<T>{ensureIdle();if(writing)throw new Error('数据正在保存，请稍后重试');writing=true;try{return await operation();}finally{writing=false;}}
function syncWrite<T>(operation:()=>T):T{ensureIdle();if(writing)throw new Error('数据正在保存，请稍后重试');return operation();}
const log = (action: string, detail: string) => state.logs.unshift({ id: id('log'), time: localTime(), action, detail, operator: authState.user?.displayName||'操作员' });
/** 只在候选数据成功变更后标记失效；自动执行本身不递增，避免切换页面时重复运行。 */
function bumpMatchDataRevision():void{
 const current=state.matchDataRevision;
 state.matchDataRevision=typeof current==='number'&&Number.isSafeInteger(current)&&current>=0&&current<Number.MAX_SAFE_INTEGER?current+1:1;
}

function validateDate(value: unknown): string {
  const result = String(value ?? '').normalize('NFKC').trim().replace(/[年/.]/g, '-').replace(/月/g, '-').replace(/日/g, '');
  const match = result.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) throw new Error(`日期格式无效：${String(value ?? '')}`);
  const date = `${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`;
  const timestamp = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString().slice(0, 10) !== date) throw new Error(`日期不存在：${date}`);
  return date;
}

/** 支持逗号、引号及带换行的 CSV 字段，不以简单 split(',') 破坏金额/摘要。 */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], value = '', quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
      row.push(value.trim()); value = '';
      if (char !== ',') { if (row.some(Boolean)) rows.push(row); row = []; if (char === '\r' && source[i + 1] === '\n') i++; }
    } else value += char;
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift();
  if (!headers || !rows.length) throw new Error('文件中没有凭证数据');
  if(headers.some(h=>!h)||new Set(headers).size!==headers.length)throw new Error('CSV 列名不能为空或重复，请下载模板重新填写');
  return rows.map((cells, index) => { if (cells.length !== headers.length) throw new Error(`CSV 第 ${index + 2} 行列数不一致`); return Object.fromEntries(headers.map((header, i) => [header, cells[i]!])); });
}

export async function parseVoucherFile(file: File): Promise<Record<string, unknown>[]> {
  if (!/\.(json|csv)$/i.test(file.name)) throw new Error(`${file.name}：结构化凭证请使用 JSON/CSV；PDF/图片请在批量导入中补录字段`);
  if (file.size > 10 * 1024 * 1024) throw new Error('凭证文件不能超过 10 MB');
  const text = await file.text();
  let rows: unknown;
  if (/\.csv$/i.test(file.name)) rows = parseCsv(text); else {
    let parsed: unknown;
    try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error(`${file.name}：JSON 格式错误，请检查逗号、引号或下载模板重新填写`); }
    rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? (parsed as {vouchers?:unknown}).vouchers : undefined;
  }
  if (!Array.isArray(rows) || !rows.length) throw new Error('请上传非空 JSON 数组、{vouchers: [...]} 或 CSV 文件');
  if (rows.length > 5000) throw new Error('浏览器演示单次最多导入 5000 张凭证');
  if(rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error(`${file.name}：每一行必须是凭证对象，请使用模板格式`);
  return rows as Record<string, unknown>[];
}

export interface VoucherPdfMetadata {
  sourceKind:'pdf-text';sourcePages:number[];company?:string;entries:VoucherEntry[];reviewReasons:string[];
}
export interface VoucherDraft { values: Record<string,unknown>; file?:File; origin?:string; metadata?:VoucherPdfMetadata }
export interface DocumentDraft {file:File;fields:Omit<Partial<SourceDocument>,'amount'>&{amount?:unknown}}

function normalizeVoucher(r:Record<string,unknown>, index:number,origin?:string,requireDate=false,metadata?:VoucherPdfMetadata):Voucher {
    const issues=voucherInputIssues(r,{requireDate,allowIncompletePdf:!!metadata});
    if(issues.length)throw new Error(`第 ${index+1} 行${origin?`（${origin}）`:''}：${issues.map(issue=>issue.message).join('；')}`);
    const field = (...names: string[]) => inputField(r,...names);
    const no = String(field('no', 'voucherNo', 'VoucherNo', '凭证号') ?? '').trim();
    const period = String(field('period', 'Period', '期间') ?? '').trim();
    const supplier = String(field('supplier', 'supplierName', 'SupplierName', '客商') ?? '').trim();
    const summary = String(field('summary', 'abstract', 'Abstract', '摘要') ?? '').trim();
    const amount = amountCents(field('amount', 'Amount', '金额')) / 100;
    const date = validateDate(field('date', 'voucherDate', '日期') ?? `${period}-01`);
    const attachment = field('expectedAttachments','expectedAttachmentCount', '附件数');
    const expectedAttachments = attachment === undefined ? undefined : Number(attachment);
    const voucher:Voucher={id:id('voucher'),no,period,supplier,summary,amount,date,company:String(field('company','companyName','CompanyName','单位名称')??'').trim()||undefined,status:'pending',matchReviewRequired:false,documentIds:[],invoiceNo:String(field('invoiceNo','发票号')??'')||undefined,contractNo:String(field('contractNo','合同号')??'')||undefined,bankNo:String(field('bankNo','bankFlowNo','银行流水号')??'')||undefined,approvalNo:String(field('approvalNo','审批单号')??'')||undefined,expectedAttachments};
    const rawEntries=field('entries','Entries','分录');
    if(rawEntries!==undefined){
      let rows=rawEntries;
      if(typeof rows==='string'){try{rows=JSON.parse(rows);}catch{throw new Error('分录字段需为JSON数组');}}
      if(!Array.isArray(rows)||!rows.length||rows.length>10000)throw new Error('分录需为非空数组，最多10000行');
      voucher.entries=rows.map(entry=>{
        if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error('每条分录必须是对象');
        const row=entry as Record<string,unknown>;
        const debit=(amountCents(row.debit??row.Debit??row['借方']??'0.00')/100).toFixed(2),credit=(amountCents(row.credit??row.Credit??row['贷方']??'0.00')/100).toFixed(2);
        return {summary:String(row.summary??row.Abstract??row['摘要']??''),account:String(row.account??row.Account??row['科目']??''),debit,credit};
      });
    }
    if(metadata){
      if(metadata.sourceKind!=='pdf-text'||!Array.isArray(metadata.sourcePages)||!metadata.sourcePages.length||metadata.sourcePages.some(page=>!Number.isInteger(page)||page<1||page>500)||new Set(metadata.sourcePages).size!==metadata.sourcePages.length)throw new Error('PDF 来源页号无效');
      if(!Array.isArray(metadata.entries)||!metadata.entries.length||metadata.entries.length>10000)throw new Error('PDF 凭证缺少可核对的分录');
      const entries=metadata.entries.map(entry=>({summary:String(entry.summary??''),account:String(entry.account??''),debit:entry.debit?.trim()||'0.00',credit:entry.credit?.trim()||'0.00',sourcePage:entry.sourcePage}));
      let debit=0,credit=0;let hasNegative=false;
      for(const entry of entries){const dr=amountCents(entry.debit),cr=amountCents(entry.credit);debit+=dr;credit+=cr;hasNegative ||= dr<0||cr<0;}
      if(!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit))throw new Error('分录合计超出可精确处理的范围');
      const reasons=Array.isArray(metadata.reviewReasons)?metadata.reviewReasons.map(String).filter(Boolean):[];
      if(!supplier&&!reasons.some(reason=>/客商|往来/.test(reason)))reasons.push('原始凭证未明确唯一客商，需核对往来对象');
      const blocked:string[]=[];
      if(amount<=0)blocked.push('零净额或负净额凭证需按分录人工处理');
      if(hasNegative)blocked.push('含红字分录，需人工核对抵销关系');
      // 按往来辅助科目实际出现的对象计数；不能只依赖中文提示里的“多个”字样。
      const parties=new Set(entries.flatMap(entry=>{
        const name=entry.account.match(/_[^.\s]+\.(.+)$/)?.[1]?.trim();
        return name&&name!==metadata.company&&!/^(待抵扣|暂估|其他|内部往来)$/.test(name)?[name]:[];
      }));
      if(parties.size>1||reasons.some(reason=>/多.{0,6}(客商|往来)|多个.{0,6}(对象|主体|企业|公司)|包含\s*[2-9]\d*\s*个往来客商/.test(reason)))blocked.push('包含多个往来对象，需人工分配附件');
      if(debit!==credit||debit!==amountCents(amount))blocked.push('分录借贷合计与凭证金额不一致，请核对原件');
      Object.assign(voucher,{sourceKind:'pdf-text',sourcePages:[...metadata.sourcePages],company:metadata.company,entries,sourceAmount:amount.toFixed(2),reviewStatus:'pending',reviewReasons:[...new Set([...reasons,...blocked])],autoMatchBlockedReasons:blocked});
    }
    return voucher;
}

function prepareVouchers(drafts:VoucherDraft[]):Voucher[]{
 const keys=new Set(state.vouchers.map(v=>`${v.period}/${v.no}`));
 return drafts.map((draft,index)=>{
  // 来源元数据只由 PDF 解析通道提供；JSON/CSV 字段不能自行打开宽松校验。
  if(draft.metadata&&(!draft.file||!/\.pdf$/i.test(draft.file.name)))throw new Error('PDF 提取元数据必须同时附带原始 PDF 凭证影像');
  const voucher=normalizeVoucher(draft.values,index,draft.origin,!!draft.file,draft.metadata);
  const key=`${voucher.period}/${voucher.no}`;
  if(keys.has(key))throw new Error(`${draft.origin||`第 ${index+1} 行`}：凭证 ${voucher.no} 在 ${voucher.period} 已存在或本批重复`);
  keys.add(key);if(draft.file){voucher.fileId=id('file');voucher.fileName=draft.file.name;}
  return voucher;
 });
}
function prepareDocuments(drafts:DocumentDraft[]):SourceDocument[]{
 const documents:SourceDocument[]=[];
 const keys=new Set(state.documents.filter(doc=>doc.number).map(doc=>`${doc.type}/${doc.date.slice(0,7)}/${doc.number}`));
 for(const {file,fields} of drafts){
  let amount=0;
  try{amount=fields.amount===undefined||String(fields.amount).trim()===''?0:amountCents(fields.amount)/100;}catch(e){throw new Error(`${file.name}：${e instanceof Error?e.message:'请核对金额'}`);}
  if(amount<0)throw new Error(`${file.name}：单据金额不能为负数`);
  const type=fields.type??'invoice';if(!['invoice','bank','contract','approval'].includes(type))throw new Error('单据类型无效');
  // 未读取到日期就保留空值，不把上传日期误作业务日期。
  const date=fields.date?.trim()?validateDate(fields.date):'';
  const supplier=(fields.payerName??fields.supplier??'').trim(),payeeName=fields.payeeName?.trim()??'',number=fields.number?.trim()??'';
  const pending=fields.extractionStatus==='pending'||!supplier||amount<=0||!number||!date;
  const key=`${type}/${date.slice(0,7)}/${number}`;
  if(number&&keys.has(key))throw new Error(`${file.name}：同期间、同类型单据编号 ${number} 已存在`);
  if(number)keys.add(key);
  const reasons=[...(fields.reviewReasons||[])];
  if(!date)reasons.push('未提取到业务日期，请核对原件');
  documents.push({id:id('document'),fileId:id('file'),name:file.name,type,supplier,payerName:supplier,payeeName,partyVersion:2,bankNo:fields.bankNo,receiptNo:fields.receiptNo,payerAccount:normalizeBankAccount(fields.payerAccount),payeeAccount:normalizeBankAccount(fields.payeeAccount),accountVersion:fields.accountVersion??(fields.payeeAccount?1:undefined),remarks:String(fields.remarks||''),amount,date,number,seal:fields.seal===true,status:'pending',matchReviewRequired:false,extractionStatus:pending?'pending':'reviewed',sourceKind:fields.sourceKind,sourcePages:fields.sourcePages?[...fields.sourcePages]:undefined,reviewReasons:pending?[...new Set(reasons)]:[]});
 }
 return documents;
}
async function commitMixedBatch(voucherDrafts:VoucherDraft[],documentDrafts:DocumentDraft[]):Promise<{vouchers:Voucher[];documents:SourceDocument[]}>{
 ensureIdle();
 if(voucherDrafts.length>5000)throw new Error('单批最多 5000 张凭证');
 if(documentDrafts.length>100)throw new Error('一次最多 100 份单据');
 if(!voucherDrafts.length&&!documentDrafts.length)throw new Error('请选择需要导入的凭证或单据');
 // 两类记录共同预校验，任一文件/重复号出错都不产生半批数据。
 const vouchers=prepareVouchers(voucherDrafts),documents=prepareDocuments(documentDrafts);
 for(const draft of voucherDrafts)if(draft.file)await validateMedia(draft.file);
 for(const draft of documentDrafts)await validateMedia(draft.file);
 ensureIdle();
 let sequence=state.documents.reduce((maximum,row)=>Math.max(maximum,validImportSequence(row.importSequence)),state.vouchers.reduce((maximum,row)=>Math.max(maximum,validImportSequence(row.importSequence)),validImportSequence(state.lastImportSequence)));
 if(sequence+vouchers.length+documents.length>Number.MAX_SAFE_INTEGER)throw new Error('导入排序序号超出范围，请先备份并整理本地数据');
 const files=[...voucherDrafts.flatMap((draft,index)=>draft.file?[{id:vouchers[index]!.fileId!,file:draft.file}]:[]),...documentDrafts.map((draft,index)=>({id:documents[index]!.fileId!,file:draft.file}))];
 // IndexedDB 一个事务提交全部文件，成功后再同步写入同一份响应式元数据。
 await saveFiles(files);
  // 导入顺序只在文件事务成功后分配，失败批次既不写记录，也不消耗持久化序号。
  // 同批时间一致但逐行序号递增，因此后导入行稳定排在前面；时钟回拨也不会改变次序。
  const importedAt=new Date().toISOString();
  for(const row of [...vouchers,...documents]){row.importedAt=importedAt;row.importSequence=++sequence;}
  state.lastImportSequence=sequence;
 state.vouchers.push(...vouchers);state.documents.unshift(...documents);
 bumpMatchDataRevision();
 rebuildPayerGroups();
 if(vouchers.length)log('批量导入凭证',`成功导入 ${vouchers.length} 张凭证，${vouchers.filter(v=>v.reviewStatus==='pending').length} 张待复核`);
 if(documents.length)log('批量上传单据',`保存 ${documents.length} 份单据；${documents.filter(d=>d.extractionStatus==='pending').length} 份待补录复核`);
 return {vouchers,documents};
}
async function importMixedBatch(vouchers:VoucherDraft[],documents:DocumentDraft[]):Promise<{vouchers:number;documents:number}>{const result=await commitMixedBatch(vouchers,documents);return {vouchers:result.vouchers.length,documents:result.documents.length};}
async function importVoucherBatch(drafts:VoucherDraft[]):Promise<number>{
 if(!drafts.length||drafts.length>5000)throw new Error('单批需包含 1 至 5000 张凭证');
 return (await commitMixedBatch(drafts,[])).vouchers.length;
}
async function importVouchers(file:File):Promise<number>{return importVoucherBatch((await parseVoucherFile(file)).map(values=>({values,origin:file.name})));}
async function addDocumentBatch(drafts:DocumentDraft[]):Promise<SourceDocument[]>{
 if(!drafts.length||drafts.length>100)throw new Error('一次请选择 1 至 100 份单据');
 return (await commitMixedBatch([],drafts)).documents;
}
async function addDocument(file:File,fields:Partial<SourceDocument>={}):Promise<SourceDocument>{return (await addDocumentBatch([{file,fields}]))[0]!;}

const voucherNumberCompare = (left: string, right: string) => left.localeCompare(right, 'zh-CN', { numeric: true });
function isVoucherLocked(voucher:Voucher):boolean{return state.archives.some(a=>a.period===voucher.period&&voucherNumberCompare(voucher.no,a.startVoucherNo)>=0&&voucherNumberCompare(voucher.no,a.endVoucherNo)<=0);}
function isDocumentLocked(document:SourceDocument):boolean{return state.vouchers.some(v=>v.documentIds.includes(document.id)&&isVoucherLocked(v));}
function ensureIdle(){if(matching)throw new Error('自动匹配正在执行，请稍后再修改数据');}
function checkIds<T extends {id:string}>(ids:string[],list:T[]):T[]{
  if(!ids.length||new Set(ids).size!==ids.length)throw new Error('请选择不重复的记录');
  return ids.map(id=>{const row=list.find(x=>x.id===id);if(!row)throw new Error('记录已变化，请刷新列表');return row;});
}
async function deleteVouchers(ids:string[]):Promise<number>{
  ensureIdle();const rows=checkIds(ids,state.vouchers);
  if(rows.some(isVoucherLocked))throw new Error('所选记录包含已归档凭证，不能删除；请取消选择已归档记录');
  await removeFiles(rows.flatMap(v=>v.fileId?[v.fileId]:[]));
  ensureIdle();
  detachNameAssociations(state,ids,rows.flatMap(v=>v.documentIds));
  rows.forEach(v=>v.documentIds.forEach(docId=>{const doc=state.documents.find(d=>d.id===docId);if(doc){clearReceiptReference(doc);doc.status='pending';doc.matchReviewRequired=true;doc.lastMatchReason='原关联已释放，请人工复核后重新关联';}}));
  state.vouchers=state.vouchers.filter(v=>!ids.includes(v.id));bumpMatchDataRevision();rebuildPayerGroups();log('批量删除凭证',`删除 ${rows.length} 张凭证：${rows.map(v=>v.no).join('、')}；关联单据已释放`);return rows.length;
}
async function deleteDocuments(ids:string[]):Promise<number>{
  ensureIdle();const rows=checkIds(ids,state.documents);
  if(rows.some(isDocumentLocked))throw new Error('所选单据属于只读档案，不能删除');
  await removeFiles(rows.flatMap(d=>d.fileId?[d.fileId]:[]));ensureIdle();
  // 删除组内任一单据时解除整组，避免留下一张表面已匹配、实际缺附件的凭证。
  state.vouchers.filter(v=>v.documentIds.some(id=>ids.includes(id))).forEach(v=>{
    detachNameAssociations(state,[v.id],v.documentIds);
    v.documentIds.forEach(docId=>{const doc=state.documents.find(d=>d.id===docId);if(doc){clearReceiptReference(doc);doc.status='pending';doc.matchReviewRequired=true;doc.lastMatchReason='原关联已释放，请人工复核后重新关联';}});
    v.documentIds=[];v.entryAttachments=[];v.attachmentReviewRequired=true;v.status='pending';v.matchReviewRequired=true;delete v.ruleId;delete v.confidence;
  });
  state.documents=state.documents.filter(d=>!ids.includes(d.id));bumpMatchDataRevision();rebuildPayerGroups();log('批量删除单据',`删除 ${rows.length} 份单据：${rows.map(d=>d.name).join('、')}；相关凭证返回待匹配`);return rows.length;
}
function updateVoucher(voucherId:string,values:Record<string,unknown>):void{
  ensureIdle();const voucher=state.vouchers.find(v=>v.id===voucherId);
  if(!voucher||isVoucherLocked(voucher))throw new Error('只能编辑或复核未归档的凭证');
  const beforeMatchData=JSON.stringify(voucher);
  const wasMatched=voucher.status==='matched'||!!voucher.entryAttachments?.length;
  const matchReviewRequired=voucher.matchReviewRequired===true;
  const relation={status:voucher.status,documentIds:[...voucher.documentIds],ruleId:voucher.ruleId,confidence:voucher.confidence};
  const metadata:VoucherPdfMetadata|undefined=voucher.sourceKind==='pdf-text'&&voucher.entries?.length?{sourceKind:'pdf-text',sourcePages:voucher.sourcePages||[],company:voucher.company,entries:voucher.entries,reviewReasons:voucher.autoMatchBlockedReasons||[]}:undefined;
  const next=normalizeVoucher(values,0,undefined,!!metadata,metadata);
  if(!next.entries&&voucher.entries)next.entries=JSON.parse(JSON.stringify(voucher.entries));
  if(!metadata&&inputField(values,'company','companyName','CompanyName','单位名称')===undefined)next.company=voucher.company;
  if(metadata&&voucher.sourceAmount!==undefined&&amountCents(next.amount)!==amountCents(voucher.sourceAmount))throw new Error('PDF 凭证金额来自原始分录合计，不能直接改写；请核对原件后重新导入');
  if(wasMatched&&(['no','period','date','supplier','company','amount','summary','invoiceNo','contractNo','bankNo','approvalNo'] as const).some(key=>(next[key]??'')!==(voucher[key]??'')))throw new Error('已匹配凭证若需改动关键字段，请先解除匹配；可直接核对并保存复核');
  if(wasMatched&&next.expectedAttachments!==undefined&&next.expectedAttachments!==voucher.documentIds.length)throw new Error('附件数必须与当前关联单据一致');
  if(state.vouchers.some(v=>v.id!==voucherId&&v.no===next.no&&v.period===next.period))throw new Error('同期间凭证号已存在');
  // 未明确往来对象时仍保留待复核，不能用虚构客商换取自动匹配。
  if(metadata){
   next.reviewStatus=next.supplier||next.amount<=0?'reviewed':'pending';
   next.autoMatchBlockedReasons=[...new Set([...(voucher.autoMatchBlockedReasons||[]),...(next.autoMatchBlockedReasons||[])])];
   next.reviewReasons=next.reviewStatus==='pending'?['原始凭证未明确唯一客商，需核对往来对象']:next.autoMatchBlockedReasons;
   next.sourceAmount=voucher.sourceAmount;
  }
  Object.assign(voucher,next,{id:voucherId,fileId:voucher.fileId,fileName:voucher.fileName,matchReviewRequired:wasMatched?false:matchReviewRequired},wasMatched?relation:{});delete voucher.missingReason;
  if(beforeMatchData!==JSON.stringify(voucher))bumpMatchDataRevision();
  rebuildPayerGroups();
  log(metadata?'复核凭证':'编辑凭证',`已更新 ${voucher.no} 的结构化字段${next.reviewStatus==='pending'?'；往来对象仍待复核':''}`);
}
function updateDocument(documentId:string,fields:DocumentDraft['fields']):void{
  ensureIdle();const doc=state.documents.find(d=>d.id===documentId);
  if(!doc||isDocumentLocked(doc))throw new Error('只能编辑或复核未归档的单据');
  const beforeMatchData=JSON.stringify(doc);
  const supplier=(fields.payerName??fields.supplier??'').trim(),payeeName=fields.payeeName?.trim()??doc.payeeName??'',number=fields.number?.trim()??'',amount=amountCents(fields.amount)/100,date=validateDate(fields.date);
  const payeeAccount=fields.payeeAccount===undefined?doc.payeeAccount:normalizeBankAccount(fields.payeeAccount),payerAccount=fields.payerAccount===undefined?doc.payerAccount:normalizeBankAccount(fields.payerAccount);
  if(fields.payeeAccount?.trim()&&!payeeAccount)throw new Error('收款账号需为完整数字账号或至少4位尾号');
  if(doc.status==='matched'&&((payeeAccount||'')!==(doc.payeeAccount||'')||(payerAccount||'')!==(doc.payerAccount||'')))throw new Error('已匹配单据修改账号前请先解除匹配');
  if(doc.status==='matched'&&(supplier!==(doc.payerName??doc.supplier)||payeeName!==(doc.payeeName??'')||number!==doc.number||amount!==doc.amount||date!==doc.date||fields.type!==doc.type))throw new Error('已匹配单据若需改动关键字段，请先解除匹配；可直接核对并保存复核');
  if((!supplier&&fields.type!=='bank')||!number||amount<=0)throw new Error('请补齐客商、单据编号、正数金额和日期');
  if(!fields.type||!['invoice','bank','contract','approval'].includes(fields.type))throw new Error('单据类型无效');
  if(state.documents.some(d=>d.id!==documentId&&d.type===fields.type&&d.number===number&&d.date.slice(0,7)===date.slice(0,7)))throw new Error('同期间、同类型单据编号已存在');
  Object.assign(doc,{supplier,payerName:supplier,payeeName,partyVersion:2,payerAccount,payeeAccount,accountVersion:1,remarks:fields.remarks===undefined?doc.remarks:String(fields.remarks),number,amount,date,type:fields.type,seal:fields.seal===true,extractionStatus:'reviewed',reviewReasons:[]});
  if(doc.matchedVoucherId!==undefined&&doc.matchedEntryIndex!==undefined){const voucher=state.vouchers.find(v=>v.id===doc.matchedVoucherId);if(voucher)writeReceiptReference(doc,voucher,doc.matchedEntryIndex);}
  if(beforeMatchData!==JSON.stringify(doc))bumpMatchDataRevision();
  rebuildPayerGroups();
  log('复核单据',`已补录并复核 ${doc.name}`);
}

function unmatchVoucher(voucherId:string,reason:string):void{
  ensureIdle();const v=state.vouchers.find(v=>v.id===voucherId);
  if(!v||(collectionStatus(v)!=='matched'&&!v.documentIds.length)||isVoucherLocked(v))throw new Error('只能解除未归档凭证的关联');
  if(!reason.trim())throw new Error('请填写解除匹配原因');
  detachNameAssociations(state,[v.id],v.documentIds);
  v.documentIds.forEach(id=>{const d=state.documents.find(d=>d.id===id);if(d){clearReceiptReference(d);d.status='pending';d.matchReviewRequired=true;d.lastMatchReason='原关联已释放，请人工复核后重新关联';}});
  v.documentIds=[];v.entryAttachments=[];v.attachmentReviewRequired=true;v.status='pending';v.matchReviewRequired=true;v.lastMatchReason=`已人工解除关联：${reason.trim()}`;delete v.ruleId;delete v.confidence;bumpMatchDataRevision();rebuildPayerGroups();
  log('解除匹配',`${v.no}：${reason.trim()}；原单据已释放`);
}
function confirmSeal(documentId:string):void{
  ensureIdle();const d=state.documents.find(d=>d.id===documentId);
  if(!d||d.type!=='invoice'||isDocumentLocked(d))throw new Error('只能核验未归档发票的印章');
  d.seal=true;log('核验发票印章',`人工确认 ${d.name} 的发票印章`);
}

function restoreMissing(voucherId:string):void{
  ensureIdle();const v=state.vouchers.find(v=>v.id===voucherId);
  if(!v||v.status!=='missing'||isVoucherLocked(v))throw new Error('请选择未归档的附件缺失凭证');
  v.status='pending';v.matchReviewRequired=true;delete v.missingReason;bumpMatchDataRevision();log('恢复待匹配',`${v.no} 已重新进入匹配池`);
}

function bind(voucher: Voucher, docs: SourceDocument[], ruleId: string, confidence: number, rebuild=true) {
  // 同一单据只允许从待匹配状态进入一次关联，防止重复消费。
  if (!['pending','missing'].includes(voucher.status) || isVoucherLocked(voucher) || docs.some(doc => doc.status !== 'pending')) throw new Error('凭证或单据状态已变化，请刷新后重试');
  voucher.documentIds = docs.map(doc => doc.id);
  delete voucher.missingReason;
  voucher.status = 'matched'; voucher.matchReviewRequired=false; voucher.ruleId = ruleId; voucher.confidence = confidence;
  docs.forEach(doc => { doc.status = 'matched';doc.matchReviewRequired=false;doc.lastMatchReason=ruleId==='MANUAL'?'已人工复核并关联凭证':`已按 ${ruleId} 关联凭证`; });
  if(rebuild)rebuildPayerGroups();
}

/** 档案分组只能来源于真实匹配关系，同付款人未关联影像仍留在复核池。 */
function matchedPayerGroups(source:ArchiveState):PayerGroup[]{
 const groups=new Map<string,PayerGroup>();
 const documents=new Map(source.documents.map(doc=>[doc.id,doc]));
 for(const voucher of source.vouchers){
  if((voucher.status!=='matched'&&!voucher.entryAttachments?.length)||!voucher.documentIds.length)continue;
  const evidence=voucher.documentIds.map(docId=>documents.get(docId));
  // 不完整关系不得只拿其中几张影像冒充完整归档证据。
  if(evidence.some(doc=>!doc||doc.status!=='matched'))continue;
  for(const doc of evidence as SourceDocument[]){
   const payer=(doc.payerName??(doc.sourceKind==='pdf-text'?'':doc.supplier)).trim();
   const docPeriod=voucher.entryAttachments?.length?voucher.period:doc.date.slice(0,7);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(docPeriod))continue;
   const key=`${docPeriod}/${payer?normalizeSupplier(payer):'__unassigned__'}`;
   let group=groups.get(key);
   if(!group){group={id:`payer:${key}`,period:docPeriod,payerName:payer||'请复核付款人',needsPayerReview:!payer,documentIds:[],voucherIds:[],updatedAt:localTime()};groups.set(key,group);}
   if(!group.documentIds.includes(doc.id))group.documentIds.push(doc.id);
   if(!group.voucherIds.includes(voucher.id))group.voucherIds.push(voucher.id);
  }
 }
 return [...groups.values()];
}
function rebuildPayerGroups(_period?:string):void{
 pruneNameAssociations(state);
 state.payerGroups=matchedPayerGroups(state);
 const groupByDocument=new Map(state.payerGroups.flatMap(group=>group.documentIds.map(docId=>[docId,group.id] as const)));
 for(const doc of state.documents){delete doc.payerGroupId;const groupId=groupByDocument.get(doc.id);if(groupId)doc.payerGroupId=groupId;}
}
/** 旧版本把外部交易对方误作付款人。优先从已保留的本地原件重新提取，保留旧字段供核对。 */
async function refreshDocumentParties():Promise<number>{
 const legacy=state.documents.filter(doc=>doc.sourceKind==='pdf-text'&&doc.partyVersion!==2&&!isDocumentLocked(doc));
 if(!legacy.length)return 0;
 const [{readPdfText},{parseDocumentPages}]=await Promise.all([import('./pdfText'),import('./pdfDocuments')]);
 let changed=0;
 for(const doc of legacy){
  doc.legacyCounterparty??=doc.supplier;
  try{
   const blob=doc.fileId?await loadFile(doc.fileId):undefined;
   if(!blob)throw new Error('本地原件未找到，请核对付款人');
   const parsed=parseDocumentPages(await readPdfText(new File([blob],doc.name,{type:'application/pdf'})));
   const exact=parsed.filter(item=>item.number&&item.number===doc.number);
   const party=exact.length===1?exact[0]:parsed.length===1?parsed[0]:undefined;
   if(!party)throw new Error('付款人无法唯一识别，请对照原件复核');
   Object.assign(doc,{payerName:party.payerName,payeeName:party.payeeName,supplier:party.payerName,bankNo:party.bankNo,receiptNo:party.receiptNo,partyVersion:2});
   if(!party.payerName){doc.extractionStatus='pending';doc.reviewReasons=[...new Set([...(doc.reviewReasons||[]),'原件未列付款人，请复核'])];}
   changed++;
  }catch(error){
   Object.assign(doc,{payerName:'',supplier:'',partyVersion:2,extractionStatus:'pending'});
   doc.reviewReasons=[...new Set([...(doc.reviewReasons||[]),error instanceof Error?error.message:'付款人需复核'])];
  }
 }
 // 旧版基于“外部对方”做过的自动关联，必须按修正后的角色和当前配置重新验证。
 // 人工关联及已锁定档案保留原证据决策，不能在字段迁移时静默改写。
 let released=0;const migrated=new Set(legacy.map(doc=>doc.id));
 for(const voucher of state.vouchers){
  if(voucher.status!=='matched'||isVoucherLocked(voucher)||voucher.ruleId==='MANUAL'||!voucher.documentIds.some(docId=>migrated.has(docId)))continue;
  const rule=state.rules.find(item=>item.id===voucher.ruleId);if(!rule)continue;
  const checked=evaluateRules([{...voucher,status:'pending'}],state.documents.map(doc=>voucher.documentIds.includes(doc.id)?{...doc,status:'pending'}:doc),[rule]);
  const relation=checked.matches[0];
  if(!relation||relation.documentIds.length!==voucher.documentIds.length||relation.documentIds.some(docId=>!voucher.documentIds.includes(docId))){
   voucher.documentIds.forEach(docId=>{const doc=state.documents.find(item=>item.id===docId);if(doc){clearReceiptReference(doc);doc.status='pending';doc.matchReviewRequired=true;doc.lastMatchReason='原关联已释放，请人工复核后重新关联';}});
   voucher.documentIds=[];voucher.status='pending';voucher.matchReviewRequired=true;delete voucher.ruleId;delete voucher.confidence;voucher.lastMatchReason='付款人字段已按原件修正，请按当前规则重新匹配';released++;
  }
 }
 bumpMatchDataRevision();
 if(state.lastMatchRun){if(released)state.lastMatchRun.rules=[];rebuildPayerGroups();}
 if(released)log('重新校验关联',`付款人语义修正后 ${released} 组旧自动关联需重算，已释放原始单据`);
 if(changed)log('核对付款人',`已从本地原件更新 ${changed} 份单据的付款人与收款人；旧客商值保留供复核`);
 return changed;
}
/** 旧数据无账号字段时直接重读已保存原件；不要求用户重新上传或清空数据。 */
async function refreshDocumentAccounts():Promise<number>{
 const documents=state.documents.filter(doc=>doc.type==='bank'&&doc.sourceKind==='pdf-text'&&doc.accountVersion!==1&&!isDocumentLocked(doc));
 if(!documents.length)return 0;
 const [{readPdfText},{parseDocumentPages}]=await Promise.all([import('./pdfText'),import('./pdfDocuments')]);
 let changed=0;
 for(const doc of documents){
  if(!doc.fileId)continue;
  const source=await loadFile(doc.fileId);if(!source)continue;
  try{
   const parsed=parseDocumentPages(await readPdfText(new File([source],doc.name,{type:'application/pdf'})));
   const candidates=parsed.filter(record=>record.type==='bank'&&(record.number===doc.number||record.receiptNo===doc.receiptNo&&!!doc.receiptNo));
   const record=candidates.length===1?candidates[0]:parsed.length===1?parsed[0]:undefined;
   if(record){doc.payerAccount=record.payerAccount||'';doc.payeeAccount=record.payeeAccount||'';doc.accountVersion=1;changed++;}
  }catch{doc.lastMatchReason='回单原件账号提取失败，请核对原件后补录收款账号';}
  await new Promise<void>(resolve=>setTimeout(resolve,0));
 }
 if(changed){bumpMatchDataRevision();log('提取回单账号',`已从原件补充 ${changed} 份回单的独立收付款账号；未识别账号留待人工复核`);}
 return changed;
}

async function autoMatchEntries(period?:string):Promise<{matched:number;remaining:number;grouped:number}>{
 if(matching||writing)throw new Error('其他数据操作正在执行，请稍候');matching=true;
 try{
  await refreshDocumentParties();await refreshDocumentAccounts();
  const targets=state.vouchers.filter(v=>(!period||v.period===period)&&!isVoucherLocked(v));
  const receiptRule=state.rules.find(rule=>rule.id===RECEIPT_RULE_ID)!;
  if(!receiptRule.enabled){
   for(const voucher of targets)if(voucher.status!=='matched'){voucher.matchReviewRequired=true;voucher.lastMatchReason='金额＋收款账号规则已停用，请启用后重试';}
   log('自动匹配暂停','金额＋收款账号规则已停用，现有关联保留，未执行新的自动关联');
   return {matched:0,remaining:targets.filter(v=>v.status!=='matched').length,grouped:visibleArchiveGroups(state).filter(group=>!period||group.period===period).length};
  }
  const targetIds=new Set(targets.map(v=>v.id));
  const preserved=targets.filter(v=>v.ruleId==='MANUAL'&&v.status==='matched'&&!v.entryAttachments?.length);
  const preservedIds=new Set(preserved.map(v=>v.id));
  const already=new Set(targets.filter(v=>v.status==='matched'&&!v.attachmentReviewRequired).map(v=>v.id));
  const manualLinks=targets.flatMap(v=>(v.entryAttachments||[]).filter(link=>link.ruleId==='MANUAL'));
  const protectedDocuments=new Set([...state.vouchers.filter(v=>!targetIds.has(v.id)||preservedIds.has(v.id)).flatMap(v=>v.documentIds),...manualLinks.map(link=>link.documentId)]);
  const oldDocuments=new Set(targets.flatMap(v=>v.documentIds));
  const beforeDocumentIds=new Set(targets.flatMap(v=>v.entryAttachments||[]).map(link=>link.documentId));
  const dates=targets.map(v=>businessDate(v.date)).filter(Number.isFinite);
  const min=dates.length?Math.min(...dates)-29*86400000:NaN,max=dates.length?Math.max(...dates)+29*86400000:NaN;
  const configuredTypes=new Set(receiptRule.conditions?.documentTypes||['bank']);
  // R09只管理配置允许的银行回单。发票、合同和审批单保留进入R09前的
  // 状态与复核原因，避免本规则运行时误清理其他规则的业务结果。
  const documents=state.documents.filter(doc=>doc.type==='bank'&&configuredTypes.has(doc.type)&&!isDocumentLocked(doc)&&!protectedDocuments.has(doc.id)&&(!period||!doc.date||doc.date.startsWith(period)||oldDocuments.has(doc.id)||(businessDate(doc.date)>=min&&businessDate(doc.date)<=max)));
  const snapshots=targets.filter(v=>!preservedIds.has(v.id)).map(v=>({...JSON.parse(JSON.stringify(v)) as Voucher,status:'pending' as const,nameAssociationIds:[],entryAttachments:(v.entryAttachments||[]).filter(link=>link.ruleId==='MANUAL'),documentIds:(v.entryAttachments||[]).filter(link=>link.ruleId==='MANUAL').map(link=>link.documentId)}));
  const sourceDocuments=documents.map(doc=>({...JSON.parse(JSON.stringify(doc)) as SourceDocument,status:'pending' as const,nameAssociationIds:[]}));
  const rules=JSON.parse(JSON.stringify(state.rules)) as MatchRule[];
  // 匹配计划失败时不清除现有关系。全部候选计算成功以后才一次性提交新关联。
  // 同一回单也可能命中相邻期间的分录；将邻近凭证纳入歧义检测，但只提交本次选定期间。
  const context=period?state.vouchers.filter(v=>!targetIds.has(v.id)&&!isVoucherLocked(v)&&businessDate(v.date)>=min&&businessDate(v.date)<=max).map(v=>JSON.parse(JSON.stringify(v)) as Voucher):[];
  const plan=await evaluateMatchPlan([...snapshots,...context],sourceDocuments,rules,localTime());
  const evaluated=plan.financial as EntryEvaluation;
  const result:EntryEvaluation={...evaluated,matches:evaluated.matches.filter(match=>targetIds.has(match.voucherId)),outcomes:evaluated.outcomes.filter(outcome=>targetIds.has(outcome.voucherId))};
  const byVoucher=new Map(state.vouchers.map(v=>[v.id,v]));const byDocument=new Map(state.documents.map(doc=>[doc.id,doc]));
  detachNameAssociations(state,targets.map(v=>v.id),documents.map(doc=>doc.id));
  for(const doc of documents){clearReceiptReference(doc);doc.status='pending';doc.matchReviewRequired=true;}
  for(const snapshot of snapshots){
   const voucher=byVoucher.get(snapshot.id)!;
   voucher.entryAttachments=snapshot.entryAttachments;voucher.documentIds=snapshot.documentIds;voucher.status='pending';voucher.attachmentReviewRequired=true;voucher.matchReviewRequired=true;delete voucher.ruleId;delete voucher.confidence;
  }
  for(const match of result.matches){const voucher=byVoucher.get(match.voucherId)!;voucher.entryAttachments=match.entryAttachments;voucher.documentIds=[...new Set(match.documentIds)];voucher.ruleId='R09';voucher.confidence=100;}
  for(const voucher of targets){
   if(preservedIds.has(voucher.id))continue;
   for(const link of voucher.entryAttachments||[]){const doc=byDocument.get(link.documentId);if(!doc)continue;doc.status='matched';doc.matchReviewRequired=false;doc.lastMatchReason=link.ruleId==='MANUAL'?'已人工复核并关联分录':'金额、收款账号及日期已逐行核对';writeReceiptReference(doc,voucher,link.entryIndex);}
   const complete=attachmentCoverage(voucher);
   voucher.status=complete?'matched':'pending';voucher.attachmentReviewRequired=!complete;voucher.matchReviewRequired=!complete;
   if(voucher.entryAttachments?.length){voucher.ruleId=voucher.entryAttachments.every(link=>link.ruleId==='MANUAL')?'MANUAL':'R09';voucher.confidence=100;}
  }
  for(const outcome of result.outcomes){const voucher=byVoucher.get(outcome.voucherId);if(voucher){voucher.lastMatchReason=outcome.reason;voucher.lastMatchRuleId=outcome.ruleId;}}
  const docReasons=new Map(result.documentOutcomes.map(item=>[item.documentId,item.reason]));
  for(const doc of documents)if(doc.status!=='matched')doc.lastMatchReason=docReasons.get(doc.id)||'未找到满足联合条件的唯一分录，请人工复核';
  rebuildPayerGroups();
  const remaining=targets.filter(v=>v.status!=='matched').length,matched=targets.filter(v=>v.status==='matched'&&!already.has(v.id)).length;
  const groupCount=visibleArchiveGroups(state).filter(group=>!period||group.period===period).length;
  const scopeIds=new Set([...documents.map(doc=>doc.id),...targets.flatMap(v=>v.documentIds)]);
  const associatedDocuments=state.documents.filter(doc=>scopeIds.has(doc.id)&&doc.status==='matched').length;
  state.lastMatchRun={id:id('match-run'),time:localTime(),period:period||'',matched,remaining,groupCount,outcomes:result.outcomes,rules,importSequence:state.lastImportSequence||0,dataRevision:state.matchDataRevision||0,financialMatched:result.matches.filter(match=>match.complete).length,nameAssociatedVouchers:0,nameAssociatedDocuments:0,associatedDocuments,newlyAssociatedDocuments:result.matches.reduce((sum,match)=>sum+match.entryAttachments.filter(link=>link.ruleId==='R09'&&!beforeDocumentIds.has(link.documentId)).length,0),remainingDocuments:documents.filter(doc=>doc.status!=='matched').length};
  log('自动匹配',`按分录金额＋收款账号（尾号至少4位）＋日期差<30天完成：${targets.length-remaining} 张凭证完成，${associatedDocuments} 份单据已关联并回写凭证号；${remaining} 张凭证及 ${state.lastMatchRun.remainingDocuments} 份单据请复核`);
  return {matched,remaining,grouped:groupCount};
 }finally{matching=false;}
}

/** 人工处理也绑定到具体摘要行；账号/日期例外必须留理由，金额仍逐行核对。 */
function reconcileEntry(voucherId:string,entryIndex:number,documentIds:string[],reason:string):void{
 ensureIdle();
 const voucher=state.vouchers.find(v=>v.id===voucherId);
 if(!voucher||isVoucherLocked(voucher))throw new Error('只能复核未锁定的凭证附件');
 const entry=voucher.entries?.[entryIndex];if(!entry||!Number.isInteger(entryIndex))throw new Error('分录不存在，请重新打开凭证');
 const money=entryMoney(entry);if(!money)throw new Error('该分录金额无效，请先核对原始借贷列');
 if(!reason.trim())throw new Error('请填写人工复核依据');
 if(new Set(documentIds).size!==documentIds.length)throw new Error('不能重复选择同一单据');
 const old=voucher.entryAttachments||[];
 const current=new Set(old.filter(link=>link.entryIndex===entryIndex).map(link=>link.documentId));
 const docs=documentIds.map(id=>state.documents.find(doc=>doc.id===id));
 if(docs.some(doc=>!doc||isDocumentLocked(doc)||(doc.status==='matched'&&!current.has(doc.id))))throw new Error('单据已被其他分录关联或已锁定，不能重复绑定');
 if(docs.some(doc=>doc?.extractionStatus==='pending'&&doc.sourceKind!=='pdf-text'))throw new Error('请先对照原件补录并复核单据字段');
 const sum=(docs as SourceDocument[]).reduce((total,doc)=>total+amountCents(doc.amount),0);
 if(documentIds.length&&sum!==money.cents)throw new Error('所选附件金额合计必须与本条分录金额完全一致');
 detachNameAssociations(state,[voucher.id],documentIds);
 for(const link of old.filter(link=>link.entryIndex===entryIndex)){const doc=state.documents.find(doc=>doc.id===link.documentId);if(doc){clearReceiptReference(doc);doc.status='pending';doc.matchReviewRequired=true;doc.lastMatchReason='分录附件已解除，请人工复核后重新关联';}}
 voucher.entryAttachments=[...old.filter(link=>link.entryIndex!==entryIndex),...documentIds.map(documentId=>({entryIndex,documentId,side:money.side,ruleId:'MANUAL' as const,reason:reason.trim()}))];
 voucher.documentIds=[...new Set(voucher.entryAttachments.map(link=>link.documentId))];
 for(const doc of docs as SourceDocument[]){doc.status='matched';doc.matchReviewRequired=false;doc.lastMatchReason=`已人工核对凭证${voucher.no}第${entryIndex+1}条分录：${reason.trim()}`;writeReceiptReference(doc,voucher,entryIndex);}
 const complete=attachmentCoverage(voucher);voucher.status=complete?'matched':'pending';voucher.attachmentReviewRequired=!complete;voucher.matchReviewRequired=!complete;voucher.ruleId=voucher.entryAttachments.every(link=>link.ruleId==='MANUAL')?'MANUAL':'R09';voucher.confidence=100;
 voucher.lastMatchReason=complete?'已按分录完成人工附件复核':'已有分录完成关联，其余分录请复核';
 bumpMatchDataRevision();rebuildPayerGroups();log('分录附件复核',`${voucher.no} 第${entryIndex+1}条摘要关联 ${documentIds.length} 份单据；依据：${reason.trim()}`);
}

async function autoMatch(period?: string): Promise<{ matched: number; remaining: number; grouped:number }> {
 if(state.rules.some(rule=>rule.id===RECEIPT_RULE_ID))return autoMatchEntries(period);
 if(matching||writing)throw new Error('其他数据操作正在执行，请稍候');matching=true;
 try{
  await refreshDocumentParties();
  await new Promise<void>(resolve=>setTimeout(resolve,150));
  // 一次构建锁定集合，避免每份单据反复扫描全部凭证和档案范围。
  const lockedVouchers=new Set(state.vouchers.filter(isVoucherLocked).map(voucher=>voucher.id));
  const lockedDocuments=new Set(state.vouchers.filter(voucher=>lockedVouchers.has(voucher.id)).flatMap(voucher=>voucher.documentIds));
  const targets=state.vouchers.filter(v=>(!period||v.period===period)&&!lockedVouchers.has(v.id));
  const documents=state.documents.filter(d=>(!period||d.date.startsWith(period))&&!lockedDocuments.has(d.id));
  const alreadyAssociated=new Set(targets.filter(v=>collectionStatus(v)==='matched').map(v=>v.id));
  const alreadyAssociatedDocuments=new Set(documents.filter(doc=>collectionStatus(doc)==='matched').map(doc=>doc.id));
  const rules=JSON.parse(JSON.stringify(state.rules)) as MatchRule[];
  // Worker只接收普通快照，计算完整计划后再提交；期间仍持有匹配锁。
  const {financial:result,names:evaluatedNames}=await evaluateMatchPlan(JSON.parse(JSON.stringify(targets)),JSON.parse(JSON.stringify(documents)),rules,localTime());
  const voucherById=new Map(state.vouchers.map(voucher=>[voucher.id,voucher]));
  const documentById=new Map(state.documents.map(document=>[document.id,document]));
  for(const match of result.matches){const voucher=voucherById.get(match.voucherId)!;const docs=match.documentIds.map(docId=>documentById.get(docId)!);bind(voucher,docs,match.ruleId,match.confidence,false);}
  for(const outcome of result.outcomes){const voucher=voucherById.get(outcome.voucherId);if(voucher){voucher.lastMatchReason=outcome.reason;voucher.lastMatchRuleId=outcome.ruleId;}}
  state.nameAssociations=[...(state.nameAssociations||[]).filter(group=>period&&group.period!==period),...evaluatedNames];
  pruneNameAssociations(state);
  // 统计只读取已经写回且有效的关联，不能把候选计算数量当作已入档数量。
  const named=state.nameAssociations.filter(group=>!period||group.period===period);
  for(const group of named)for(const voucherId of group.voucherIds){
   const voucher=targets.find(v=>v.id===voucherId);if(!voucher||voucher.status==='matched')continue;
   const reason=`${group.ruleId}：${group.basis==='company'?'单位名称':'往来名称'}与付款人或收款人一致，已按企业名称关联；凭证金额关系保留核对`;
   voucher.lastMatchReason=reason;voucher.lastMatchRuleId=group.ruleId;
   const outcome=result.outcomes.find(item=>item.voucherId===voucherId);if(outcome)Object.assign(outcome,{matched:true,ruleId:group.ruleId,reason});
  }
  // 只有本次手动触发覆盖的记录才进入请复核，之后导入或其他期间的记录保持待匹配。
  for(const voucher of targets){
   voucher.matchReviewRequired=collectionStatus(voucher)!=='matched';
   if(voucher.matchReviewRequired&&!voucher.lastMatchReason)voucher.lastMatchReason=voucher.missingReason||'未找到符合当前规则的原始单据，请人工复核后关联';
  }
  for(const doc of documents){
   doc.matchReviewRequired=collectionStatus(doc)!=='matched';
   if(doc.matchReviewRequired)doc.lastMatchReason='本次未找到符合当前规则的凭证，请人工复核后关联';
   else if(doc.status!=='matched')doc.lastMatchReason='付款人或收款人名称一致，已按企业名称关联并同步至电子档案';
  }
  rebuildPayerGroups(period);
  const remaining=targets.filter(v=>collectionStatus(v)!=='matched').length;
  const associated=targets.filter(v=>collectionStatus(v)==='matched'&&!alreadyAssociated.has(v.id)).length;
  const groupCount=visibleArchiveGroups(state).filter(group=>!period||group.period===period).length;
  const sourceScope=state.documents.filter(doc=>!period||doc.date.startsWith(period));
  const associatedDocuments=sourceScope.filter(doc=>collectionStatus(doc)==='matched').length;
  const newlyAssociatedDocuments=documents.filter(doc=>collectionStatus(doc)==='matched'&&!alreadyAssociatedDocuments.has(doc.id)).length;
  state.lastMatchRun={importSequence:state.lastImportSequence||0,dataRevision:state.matchDataRevision||0,id:id('match-run'),time:localTime(),period:period||'',matched:associated,financialMatched:result.matches.length,nameAssociatedVouchers:new Set(named.flatMap(group=>group.voucherIds)).size,nameAssociatedDocuments:new Set(named.flatMap(group=>group.documentIds)).size,associatedDocuments,newlyAssociatedDocuments,remainingDocuments:sourceScope.length-associatedDocuments,remaining,groupCount,outcomes:result.outcomes,rules};
  log('自动匹配',`按已保存规则完成：凭证金额关联 ${result.matches.length} 张；企业名称关联 ${state.lastMatchRun.nameAssociatedVouchers} 张凭证、${state.lastMatchRun.nameAssociatedDocuments} 份单据；本次新增关联 ${associated} 张凭证，未关联 ${remaining} 张`);
  return {matched:associated,remaining,grouped:groupCount};
 }finally{matching=false;}
}

function manualMatch(voucherId: string, documentIds: string[], reason: string): void {
  if (!reason.trim()) throw new Error('请填写人工关联原因');
  const voucher = state.vouchers.find(v => v.id === voucherId);
  ensureIdle();
  if (!voucher || !['pending','missing'].includes(voucher.status)||isVoucherLocked(voucher)) throw new Error('请选择未归档的待处理凭证');
  if(voucher.reviewStatus==='pending')throw new Error('凭证字段尚待复核，请先核对原件并保存复核');
  if(voucher.amount<=0)throw new Error('零净额或负净额凭证需按分录人工处理，不能用正数附件总额直接关联');
  if(voucher.autoMatchBlockedReasons?.some(reason=>reason.includes('分录借贷合计')))throw new Error('分录借贷合计与凭证金额不一致，请核对原件后重新导入');
  if (!documentIds.length || new Set(documentIds).size !== documentIds.length) throw new Error('请选择不重复的单据');
  const docs = documentIds.map(docId => state.documents.find(doc => doc.id === docId));
  if (docs.some(doc => !doc || doc.status !== 'pending' || doc.extractionStatus === 'pending' || !doc.date.startsWith(voucher.period))) throw new Error('单据不存在、已被关联或等待字段复核');
  const selected = docs as SourceDocument[];
  const sum = selected.reduce((total, doc) => total + amountCents(doc.amount), 0);
  if (Math.abs(sum - amountCents(voucher.amount)) > 5) throw new Error('所选单据金额合计与凭证金额差额超过 0.05 元');
  if (voucher.expectedAttachments !== undefined && voucher.expectedAttachments !== selected.length) throw new Error(`附件数应为 ${voucher.expectedAttachments} 份`);
  bind(voucher, selected, 'MANUAL', 100);
  bumpMatchDataRevision();
  log('手工关联', `${voucher.no} 关联 ${selected.length} 份单据；原因：${reason.trim()}`);
}

function markMissing(voucherId: string, reason: string): void {
  ensureIdle();
  if (!reason.trim()) throw new Error('请填写附件缺失原因');
  const voucher = state.vouchers.find(v => v.id === voucherId);
  if (!voucher || voucher.status === 'matched' || isVoucherLocked(voucher)) throw new Error('只有未匹配凭证可以标记附件缺失');
  const changed=voucher.status!=='missing'||voucher.missingReason!==reason.trim();
  detachNameAssociations(state,[voucher.id],[]);
  voucher.status = 'missing'; voucher.matchReviewRequired=true; voucher.missingReason = reason.trim();
  if(changed)bumpMatchDataRevision();
  log('标记附件缺失', `${voucher.no}：${reason.trim()}`);
}

function updateRule(ruleId: string, patch: Partial<MatchRule>): void {
  const rule = state.rules.find(r => r.id === ruleId);
  if (!rule) throw new Error('规则不存在');
  if(ruleId===RECEIPT_RULE_ID){
    if((patch.tolerance!==undefined&&patch.tolerance!==0)||(patch.dateWindow!==undefined&&patch.dateWindow!==30)||(patch.matchType!==undefined&&patch.matchType!=='exact')||patch.conditions?.requireAmount===false||patch.conditions?.requireDate===false||patch.conditions?.associationScope==='party')throw new Error('逐行匹配固定要求金额完全一致、收款账号命中、日期差小于30天');
  }
  const next = { ...rule, ...patch };
  if (!Number.isFinite(next.threshold) || next.threshold < 0 || next.threshold > 100) throw new Error('阈值必须在 0 至 100 之间');
  if (next.tolerance < 0 || amountCents(next.tolerance) > 10000) throw new Error('金额容差需为 0 至 100 元');
  if (!Number.isInteger(next.dateWindow) || next.dateWindow < 0 || next.dateWindow > 366) throw new Error('日期窗口需为 0 至 366 天');
  if(!Number.isInteger(next.priority)||next.priority<1||next.priority>100)throw new Error('优先级需为 1 至 100 的整数');
  if(!['exact','fuzzy','aggregate'].includes(next.matchType))throw new Error('请选择有效的匹配策略');
  const conditions={...rule.conditions,...patch.conditions};
  if(conditions.associationScope&&!['voucher','party'].includes(conditions.associationScope))throw new Error('关联用途无效');
  if(conditions.associationScope==='party'){conditions.requireAmount=false;conditions.requireDate=false;}
  if(conditions.associationScope==='party'&&next.matchType==='aggregate')throw new Error('企业名称关联请选择精确或模糊匹配策略');
  if(conditions.partyField&&!['payerName','payeeName','either'].includes(conditions.partyField))throw new Error('匹配名称字段无效');
  if(conditions.documentTypes&&(!conditions.documentTypes.length||conditions.documentTypes.some(type=>!['invoice','bank','contract','approval'].includes(type))))throw new Error('请至少选择一种有效单据类型');
  if((conditions.requireDate!==undefined&&typeof conditions.requireDate!=='boolean')||(conditions.requireAmount!==undefined&&typeof conditions.requireAmount!=='boolean'))throw new Error('校验条件必须为开关值');
  Object.assign(rule, {enabled:next.enabled,priority:next.priority,matchType:next.matchType,conditions,threshold:next.threshold,tolerance:next.tolerance,dateWindow:next.dateWindow});
  log('更新匹配规则', `${rule.id} ${rule.name}：${rule.enabled ? '启用' : '停用'}，优先级 ${rule.priority}，策略 ${rule.matchType}，阈值 ${rule.threshold}%，容差 ${rule.tolerance.toFixed(2)} 元`);
}

function generateArchive(request: GenerateArchiveRequest): ArchiveBook {
  ensureIdle();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(request.period)) throw new Error('请选择正确的会计期间');
  if (!request.startVoucherNo.trim() || !request.endVoucherNo.trim() || voucherNumberCompare(request.startVoucherNo, request.endVoucherNo) > 0) throw new Error('凭证号范围无效');
  const vouchers = state.vouchers.filter(v => v.period === request.period && voucherNumberCompare(v.no, request.startVoucherNo) >= 0 && voucherNumberCompare(v.no, request.endVoucherNo) <= 0);
  if (!vouchers.length) throw new Error('所选期间和范围内没有凭证');
  if (!vouchers.some(v => v.no === request.startVoucherNo) || !vouchers.some(v => v.no === request.endVoucherNo)) throw new Error('起止凭证号必须存在');
  if (state.archives.some(a => a.period === request.period && voucherNumberCompare(a.startVoucherNo, request.endVoucherNo) <= 0 && voucherNumberCompare(a.endVoucherNo, request.startVoucherNo) >= 0)) throw new Error('该范围与已有只读档案重叠，请选择未归档凭证');
  for (const voucher of vouchers) {
    if(voucher.reviewStatus==='pending')throw new Error(`${voucher.no} 凭证字段尚待复核`);
    if(voucher.autoMatchBlockedReasons?.some(reason=>reason.includes('分录借贷合计')))throw new Error(`${voucher.no} 分录借贷合计不一致，不能归档`);
    if (voucher.status !== 'matched') throw new Error(`${voucher.no} 尚未完成附件匹配${voucher.missingReason ? `：${voucher.missingReason}` : ''}`);
    const docs = voucher.documentIds.map(docId => state.documents.find(doc => doc.id === docId));
    if(docs.some(doc=>doc?.extractionStatus==='pending'))throw new Error(`${voucher.no} 存在尚待复核的附件`);
    if (!docs.length || docs.some(doc => !doc)) throw new Error(`${voucher.no} 附件缺失`);
    if (voucher.expectedAttachments !== undefined && docs.length !== voucher.expectedAttachments) throw new Error(`${voucher.no} 附件数量不符`);
    if (docs.some(doc => doc!.type === 'invoice' && !doc!.seal)) throw new Error(`${voucher.no} 存在未确认发票章的单据`);
    if(voucher.entryAttachments?.length){
      if(!attachmentCoverage(voucher)||voucher.attachmentReviewRequired)throw new Error(`${voucher.no} 仍有分录附件需要复核`);
      if(voucher.documentIds.length!==voucher.entryAttachments.length||new Set(voucher.entryAttachments.map(link=>link.documentId)).size!==voucher.entryAttachments.length)throw new Error(`${voucher.no} 分录附件关系不完整或重复`);
      for(const entryIndex of new Set(voucher.entryAttachments.map(link=>link.entryIndex))){
        const entry=voucher.entries?.[entryIndex],money=entry&&entryMoney(entry);
        const total=voucher.entryAttachments.filter(link=>link.entryIndex===entryIndex).reduce((sum,link)=>sum+amountCents(state.documents.find(doc=>doc.id===link.documentId)?.amount),0);
        if(!money||money.cents!==total)throw new Error(`${voucher.no} 第${entryIndex+1}条分录附件金额不一致`);
      }
    }else{
      const sum = docs.reduce((total, doc) => total + amountCents(doc!.amount), 0);
      if (Math.abs(sum - amountCents(voucher.amount)) > 5) throw new Error(`${voucher.no} 附件金额不一致`);
    }
  }
  const [year, month] = request.period.split('-');
  const archive: ArchiveBook = { id: id('archive'), title: `${year}年${month}月会计凭证`, period: request.period, startVoucherNo: request.startVoucherNo, endVoucherNo: request.endVoucherNo, voucherCount: vouchers.length, pageCount: vouchers.length + vouchers.reduce((total, v) => total + v.documentIds.length, 0) + 2, amount: vouchers.reduce((total, v) => total + amountCents(v.amount), 0) / 100, createdAt: localTime(), status: 'locked' };
  state.archives.unshift(archive);
  log('生成档案册', `本地演示档案 ${archive.title}，${archive.startVoucherNo} 至 ${archive.endVoucherNo}；PDF 与 SHA-256 由实际导出步骤生成`);
  // 返回响应式对象，使后续 PDF 文件ID/哈希写入也能触发持久化。
  return state.archives.find(item=>item.id===archive.id)!;
}

/** 显式清空本工作空间的全部数据，包含未被列表引用的原件及生成PDF。 */
async function resetData():Promise<void>{
 // 先等待先前的数据保存完成，避免旧的 watch 回调在清空期间把旧记录写回。
 await nextTick();
 const previous=localStorage.getItem(STORAGE_KEY),previousHash=localStorage.getItem('langchao:last-export-hash');
 const initial=emptyArchiveState();
 try{
  // 先确认空状态可持久化；保存失败时绝不先删除文件。
  localStorage.setItem(STORAGE_KEY,JSON.stringify(initial));
  localStorage.removeItem('langchao:last-export-hash');
 }catch{
  try{if(previous===null)localStorage.removeItem(STORAGE_KEY);else localStorage.setItem(STORAGE_KEY,previous);}catch{storageError.value='无法保存清空状态，请保持当前页面并重试';}
  throw new Error('无法保存清空状态，请检查浏览器存储权限后重试');
 }
 try{await clearFiles();}catch(error){
  // 文件事务失败时回退元数据，不对用户报告虚假的成功。
  try{
   if(previous===null)localStorage.removeItem(STORAGE_KEY);else localStorage.setItem(STORAGE_KEY,previous);
   if(previousHash!==null)localStorage.setItem('langchao:last-export-hash',previousHash);
  }catch{storageError.value='文件清理失败且无法恢复本地存储，请保持当前页面并重试';}
  throw error;
 }
 Object.assign(state,initial);storageError.value='';
}

export function useArchiveStore() {
  return { state, storageError, refreshDocumentParties:()=>write(async()=>{const count=await refreshDocumentParties();await refreshDocumentAccounts();return count;}), reconcileEntry:(id:string,index:number,ids:string[],reason:string)=>syncWrite(()=>reconcileEntry(id,index,ids,reason)), importMixedBatch:(vouchers:VoucherDraft[],documents:DocumentDraft[])=>write(()=>importMixedBatch(vouchers,documents)), importVouchers:(file:File)=>write(()=>importVouchers(file)), importVoucherBatch:(drafts:VoucherDraft[])=>write(()=>importVoucherBatch(drafts)), addDocument:(file:File,fields:Partial<SourceDocument>={})=>write(()=>addDocument(file,fields)), addDocumentBatch:(drafts:DocumentDraft[])=>write(()=>addDocumentBatch(drafts)), deleteVouchers:(ids:string[])=>write(()=>deleteVouchers(ids)), deleteDocuments:(ids:string[])=>write(()=>deleteDocuments(ids)), updateVoucher:(id:string,values:Record<string,unknown>)=>syncWrite(()=>updateVoucher(id,values)), updateDocument:(id:string,fields:DocumentDraft['fields'])=>syncWrite(()=>updateDocument(id,fields)), restoreMissing:(id:string)=>syncWrite(()=>restoreMissing(id)), isVoucherLocked, isDocumentLocked, unmatchVoucher:(id:string,reason:string)=>syncWrite(()=>unmatchVoucher(id,reason)), confirmSeal:(id:string)=>syncWrite(()=>confirmSeal(id)), autoMatch, manualMatch:(id:string,ids:string[],reason:string)=>syncWrite(()=>manualMatch(id,ids,reason)), markMissing:(id:string,reason:string)=>syncWrite(()=>markMissing(id,reason)), updateRule:(id:string,patch:Partial<MatchRule>)=>syncWrite(()=>updateRule(id,patch)), generateArchive:(request:GenerateArchiveRequest)=>syncWrite(()=>generateArchive(request)), resetData:()=>write(()=>resetData()) };
}
