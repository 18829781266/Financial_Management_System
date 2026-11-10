import { reactive, watch, ref, nextTick } from 'vue';
import {authState} from './auth';
import type {AuthUser} from './auth';
import { saveFiles, removeFiles, clearFiles, validateMedia, loadFile } from './fileStorage';
import {emptyArchiveState} from './initialState';
import {amountCents} from './money';
import {voucherInputIssues,inputField} from './voucherValidation';
import {validImportSequence} from './recordOrder';
import {evaluateRules} from './matchingEngine';
import {evaluateMatchPlan} from './matchEvaluation';
import {nameAssociationRule,pruneNameAssociations,detachNameAssociations,associateVoucherWithExistingCompany,visibleArchiveGroups} from './nameAssociation';
import {collectionStatus} from './matchWorkflow';
import {normalizeSupplier} from './matchUtils';
import {receiptEntryRule,RECEIPT_RULE_ID,normalizeBankAccount,entryMoney,attachmentCoverage,clearReceiptReference,writeReceiptReference,requiredReceiptEntries} from './entryAttachments';
import {centsToAmount,documentAllocatedCents,documentRelations,documentRemainingCents,isReferenceDocument} from './evidenceRelations';
export {normalizeSupplier,supplierSimilarity} from './matchUtils';
import type { ArchiveState, ArchiveBook, Voucher, SourceDocument, MatchRule, GenerateArchiveRequest, VoucherEntry, PayerGroup, EntryAllocationInput } from './types';

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
        const receiptMissing=!parsed.rules.some(rule=>rule.id===RECEIPT_RULE_ID);
        if(receiptMissing){
          parsed.rules.unshift(receiptEntryRule());
          // 旧整凭证回单规则没有分录方向与账号约束，升级后必须重算；人工关联不在此列。
          for(const voucher of parsed.vouchers){
            if(voucher.status!=='matched'||!['R03','R06'].includes(voucher.ruleId||'')||!requiredReceiptEntries(voucher).length)continue;
            for(const documentId of voucher.documentIds){const doc=parsed.documents.find(item=>item.id===documentId);if(doc){doc.status='pending';doc.matchReviewRequired=true;}}
            voucher.documentIds=[];voucher.entryAttachments=[];voucher.status='pending';voucher.matchReviewRequired=true;voucher.lastMatchReason='旧回单关联需按分录方向、账号及分摊金额重新核对';delete voucher.ruleId;delete voucher.confidence;
          }
        }
        pruneNameAssociations(parsed);
        const run=parsed.lastMatchRun;
        const outcomes=Array.isArray(run?.outcomes)?run.outcomes:[];
        const attempted=new Set(outcomes.filter(outcome=>outcome&&!outcome.matched).map(outcome=>outcome.voucherId));
        for(const voucher of parsed.vouchers){
          if(voucher.status==='matched')voucher.matchReviewRequired=false;
          else if(voucher.matchReviewRequired===undefined)voucher.matchReviewRequired=attempted.has(voucher.id)||!!voucher.lastMatchReason?.trim()||voucher.status==='missing';
          // 旧版依据只保存在人工附件关系上，升级后迁到独立分录字段，清空关联也可回显。
          const notes={...(voucher.entryReviewNotes||{})};
          for(const link of voucher.entryAttachments||[])if(link.ruleId==='MANUAL'&&link.reason?.trim()&&!notes[String(link.entryIndex)])notes[String(link.entryIndex)]=link.reason.trim();
          if(Object.keys(notes).length)voucher.entryReviewNotes=notes;
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
const log = (action: string, detail: string) => state.logs.unshift({ id: id('log'), time: localTime(), action, detail, operator: authState.user?.displayName||'操作员',operatorId:authState.user?.id,operatorUsername:authState.user?.username });
/** 普通用户只读本人有稳定身份标识的日志；无法确认归属的旧记录仅超级管理员可见。 */
export function visibleOperationLogs(logs:ArchiveState['logs'],user:Pick<AuthUser,'id'|'role'>|null):ArchiveState['logs']{
 if(!user)return [];
 if(user.role==='SUPER_ADMIN')return logs;
 return logs.filter(item=>item.operatorId===user.id);
}
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
    const expectedAttachments = attachment === undefined || String(attachment).trim() === '' ? undefined : Number(attachment);
    const voucher:Voucher={id:id('voucher'),no,period,supplier,summary,amount,date,company:String(field('company','companyName','CompanyName','单位名称')??'').trim()||undefined,businessType:String(field('businessType','业务类型')??'normal') as Voucher['businessType'],status:'pending',matchReviewRequired:false,documentIds:[],invoiceNo:String(field('invoiceNo','发票号')??'')||undefined,contractNo:String(field('contractNo','合同号')??'')||undefined,bankNo:String(field('bankNo','bankFlowNo','银行流水号')??'')||undefined,approvalNo:String(field('approvalNo','审批单号')??'')||undefined,expectedAttachments};
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
  const documentStatus=fields.documentStatus??'normal';
  if(amount<0&&documentStatus!=='red-letter')throw new Error(`${file.name}：负数单据必须显式标识为红字单据`);
  if(!['normal','red-letter','void'].includes(documentStatus))throw new Error(`${file.name}：单据状态无效`);
  const type=fields.type??'invoice';if(!['invoice','bank','contract','approval'].includes(type))throw new Error('单据类型无效');
  // 未读取到日期就保留空值，不把上传日期误作业务日期。
  const date=fields.date?.trim()?validateDate(fields.date):'';
  const supplier=(fields.payerName??fields.supplier??'').trim(),payeeName=fields.payeeName?.trim()??'',number=fields.number?.trim()??'';
  const pending=fields.extractionStatus==='pending'||!supplier||amount===0&&!['contract','approval'].includes(type)||amount<0&&documentStatus!=='red-letter'||!number||!date;
  const key=`${type}/${date.slice(0,7)}/${number}`;
  if(number&&keys.has(key))throw new Error(`${file.name}：同期间、同类型单据编号 ${number} 已存在`);
  if(number)keys.add(key);
  const reasons=[...(fields.reviewReasons||[])];
  if(!date)reasons.push('未提取到业务日期，请核对原件');
  documents.push({id:id('document'),fileId:id('file'),name:file.name,type,supplier,payerName:supplier,payeeName,partyVersion:2,bankNo:fields.bankNo,receiptNo:fields.receiptNo,payerAccount:normalizeBankAccount(fields.payerAccount),payeeAccount:normalizeBankAccount(fields.payeeAccount),accountVersion:fields.accountVersion??(fields.payeeAccount?1:undefined),remarks:String(fields.remarks||''),amount,date,number,documentStatus,seal:fields.seal===true,status:'pending',matchReviewRequired:false,extractionStatus:pending?'pending':'reviewed',sourceKind:fields.sourceKind,sourcePages:fields.sourcePages?[...fields.sourcePages]:undefined,reviewReasons:pending?[...new Set(reasons)]:[]});
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
function voucherEvidenceComplete(voucher:Voucher):boolean {
 if(voucher.noAttachmentRequired)return true;
 if(!voucher.documentIds.length)return false;
 const required=requiredReceiptEntries(voucher);
 return !required.length||attachmentCoverage(voucher,voucher.entryAttachments||[],state.documents);
}
function refreshVoucherState(voucher:Voucher):void {
 const complete=voucherEvidenceComplete(voucher),required=requiredReceiptEntries(voucher);
 voucher.status=complete?'matched':'pending';
 voucher.attachmentReviewRequired=!voucher.noAttachmentRequired&&required.length>0&&!attachmentCoverage(voucher,voucher.entryAttachments||[],state.documents);
 voucher.matchReviewRequired=!complete;
 voucher.evidenceStatus=voucher.noAttachmentRequired?'not-required':complete?'complete':'incomplete';
 if(complete)delete voucher.missingReason;
}
/** 单据状态只是所有分录关系的投影；部分分摊仍保留剩余额度，共享资料不参与金额消耗。 */
function refreshDocumentState(document:SourceDocument):void {
 const relations=documentRelations(document.id,state.vouchers),allocated=documentAllocatedCents(document,state.vouchers),remaining=documentRemainingCents(document,state.vouchers);
 document.allocatedAmount=centsToAmount(allocated);document.remainingAmount=centsToAmount(remaining);
 const complete=isReferenceDocument(document)?relations.length>0:relations.length>0&&remaining===0;
 document.status=complete?'matched':'pending';document.matchReviewRequired=!complete;
 clearReceiptReference(document);
 if(relations.length===1&&relations[0]!.link)writeReceiptReference(document,relations[0]!.voucher,relations[0]!.link.entryIndex);
 else if(relations.length>1){
  const note=`[关联凭证：${relations.length} 张凭证${isReferenceDocument(document)?'共享引用':'分摊核销'}]`;
  document.remarks=[document.remarks?.trim(),note].filter(Boolean).join('\n');document.matchRemark=note;
 }
 if(relations.length)document.lastMatchReason=complete?'已建立有效原始单据关联':`已分摊 ${centsToAmount(Math.abs(allocated))} 元，剩余 ${centsToAmount(Math.abs(remaining))} 元待复核`;
}
function refreshDocuments(ids:Iterable<string>):void {for(const documentId of new Set(ids)){const document=state.documents.find(item=>item.id===documentId);if(document)refreshDocumentState(document);}}
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
  const affected=new Set(rows.flatMap(v=>v.documentIds));
  for(const voucher of rows){voucher.documentIds=[];voucher.entryAttachments=[];}
  state.vouchers=state.vouchers.filter(v=>!ids.includes(v.id));
  refreshDocuments(affected);for(const documentId of affected){const doc=state.documents.find(item=>item.id===documentId);if(doc&&!documentRelations(documentId,state.vouchers).length)doc.lastMatchReason='原关联已释放，请人工复核后重新关联';}
  bumpMatchDataRevision();rebuildPayerGroups();log('批量删除凭证',`删除 ${rows.length} 张凭证：${rows.map(v=>v.no).join('、')}；仅释放本次关联，其他凭证分摊保留`);return rows.length;
}
async function deleteDocuments(ids:string[]):Promise<number>{
  ensureIdle();const rows=checkIds(ids,state.documents);
  if(rows.some(isDocumentLocked))throw new Error('所选单据属于只读档案，不能删除');
  await removeFiles(rows.flatMap(d=>d.fileId?[d.fileId]:[]));ensureIdle();
  const affectedDocuments=new Set<string>();
  state.vouchers.filter(v=>v.documentIds.some(id=>ids.includes(id))).forEach(v=>{
    detachNameAssociations(state,[v.id],v.documentIds);
    v.documentIds.forEach(id=>affectedDocuments.add(id));
    v.documentIds=v.documentIds.filter(id=>!ids.includes(id));
    v.entryAttachments=(v.entryAttachments||[]).filter(link=>!ids.includes(link.documentId));
    delete v.ruleId;delete v.confidence;v.lastMatchReason='部分原始单据已删除，请复核剩余证据及分摊金额';refreshVoucherState(v);
  });
  state.documents=state.documents.filter(d=>!ids.includes(d.id));refreshDocuments(affectedDocuments);bumpMatchDataRevision();rebuildPayerGroups();log('批量删除单据',`删除 ${rows.length} 份单据：${rows.map(d=>d.name).join('、')}；保留其他有效关系并将证据不完整凭证转复核`);return rows.length;
}
function updateVoucher(voucherId:string,values:Record<string,unknown>):void{
  ensureIdle();const voucher=state.vouchers.find(v=>v.id===voucherId);
  if(!voucher||isVoucherLocked(voucher))throw new Error('只能编辑或复核未归档的凭证');
  const beforeMatchData=JSON.stringify(voucher);
  const wasMatched=voucher.status==='matched'||!!voucher.entryAttachments?.length;
  const matchReviewRequired=voucher.matchReviewRequired===true;
  const relation={status:voucher.status,documentIds:[...voucher.documentIds],ruleId:voucher.ruleId,confidence:voucher.confidence};
  const metadata:VoucherPdfMetadata|undefined=voucher.sourceKind==='pdf-text'&&voucher.entries?.length?{sourceKind:'pdf-text',sourcePages:voucher.sourcePages||[],company:voucher.company,entries:voucher.entries,reviewReasons:voucher.autoMatchBlockedReasons||[]}:undefined;
  if(!inputField(values,'supplier','supplierName','SupplierName','客商'))throw new Error('请填写往来客商名称，用于电子档案按客商归集');
  const next=normalizeVoucher(values,0,undefined,!!metadata,metadata);
  if(!next.entries&&voucher.entries)next.entries=JSON.parse(JSON.stringify(voucher.entries));
  if(!metadata&&inputField(values,'company','companyName','CompanyName','单位名称')===undefined)next.company=voucher.company;
  if(metadata&&voucher.sourceAmount!==undefined&&amountCents(next.amount)!==amountCents(voucher.sourceAmount))throw new Error('PDF 凭证金额来自原始分录合计，不能直接改写；请核对原件后重新导入');
  if(wasMatched&&next.expectedAttachments!==undefined&&next.expectedAttachments!==voucher.documentIds.length)throw new Error('附件数必须与当前关联单据一致');
  if(state.vouchers.some(v=>v.id!==voucherId&&v.no===next.no&&v.period===next.period))throw new Error('同期间凭证号已存在');
  // 未明确往来对象时仍保留待复核，不能用虚构客商换取自动匹配。
  if(metadata){
   next.reviewStatus=next.supplier||next.amount<=0?'reviewed':'pending';
   next.autoMatchBlockedReasons=[...new Set([...(voucher.autoMatchBlockedReasons||[]),...(next.autoMatchBlockedReasons||[])])];
   next.reviewReasons=next.reviewStatus==='pending'?['原始凭证未明确唯一客商，需核对往来对象']:next.autoMatchBlockedReasons;
   next.sourceAmount=voucher.sourceAmount;
  }else{
   // 非 PDF 旧异常数据也由本次显式保存完成字段复核；专项 PDF 阻断仅在上方独立保留。
   next.reviewStatus='reviewed';next.reviewReasons=[];
  }
  Object.assign(voucher,next,{id:voucherId,fileId:voucher.fileId,fileName:voucher.fileName,matchReviewRequired:wasMatched?false:matchReviewRequired},wasMatched?relation:{});delete voucher.missingReason;
  if(beforeMatchData!==JSON.stringify(voucher))bumpMatchDataRevision();
  rebuildPayerGroups();
  // 保存客商是显式复核动作；仅限同期、规范化名称完全一致的现有企业组。
  const companyAssociated=associateVoucherWithExistingCompany(state,voucherId,localTime());
  log(metadata?'复核凭证':'编辑凭证',`已更新 ${voucher.no} 的结构化字段${next.reviewStatus==='pending'?'；往来对象仍待复核':''}${companyAssociated?'；已按同名客商归入同期企业档案':''}`);
}
function updateDocument(documentId:string,fields:DocumentDraft['fields']):void{
  ensureIdle();const doc=state.documents.find(d=>d.id===documentId);
  if(!doc||isDocumentLocked(doc))throw new Error('只能编辑或复核未归档的单据');
  const beforeMatchData=JSON.stringify(doc);
  const supplier=(fields.payerName??fields.supplier??'').trim(),payeeName=fields.payeeName?.trim()??doc.payeeName??'',number=fields.number?.trim()??'',amount=amountCents(fields.amount)/100,date=validateDate(fields.date),documentStatus=fields.documentStatus??doc.documentStatus??'normal';
  const payeeAccount=fields.payeeAccount===undefined?doc.payeeAccount:normalizeBankAccount(fields.payeeAccount),payerAccount=fields.payerAccount===undefined?doc.payerAccount:normalizeBankAccount(fields.payerAccount);
  if(fields.payeeAccount?.trim()&&!payeeAccount)throw new Error('收款账号需为完整数字账号或至少4位尾号');
  if(doc.status==='matched'&&((payeeAccount||'')!==(doc.payeeAccount||'')||(payerAccount||'')!==(doc.payerAccount||'')))throw new Error('已匹配单据修改账号前请先解除匹配');
  if(doc.status==='matched'&&(supplier!==(doc.payerName??doc.supplier)||payeeName!==(doc.payeeName??'')||number!==doc.number||amount!==doc.amount||date!==doc.date||documentStatus!==(doc.documentStatus??'normal')||fields.type!==doc.type))throw new Error('已匹配单据若需改动关键字段，请先解除匹配；可直接核对并保存复核');
  if((!supplier&&fields.type!=='bank')||!number||amount===0&&!['contract','approval'].includes(fields.type||'')||amount<0&&documentStatus!=='red-letter')throw new Error('请补齐客商、单据编号、金额和日期；负数单据须标识红字');
  if(!fields.type||!['invoice','bank','contract','approval'].includes(fields.type))throw new Error('单据类型无效');
  if(state.documents.some(d=>d.id!==documentId&&d.type===fields.type&&d.number===number&&d.date.slice(0,7)===date.slice(0,7)))throw new Error('同期间、同类型单据编号已存在');
  Object.assign(doc,{supplier,payerName:supplier,payeeName,partyVersion:2,payerAccount,payeeAccount,accountVersion:1,remarks:fields.remarks===undefined?doc.remarks:String(fields.remarks),number,amount,date,type:fields.type,documentStatus,seal:fields.seal===true,extractionStatus:'reviewed',reviewReasons:[]});
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
  const affected=new Set(v.documentIds);
  v.documentIds=[];v.entryAttachments=[];v.noAttachmentRequired=false;v.attachmentExemptionReason=undefined;refreshVoucherState(v);v.lastMatchReason=`已人工解除关联：${reason.trim()}`;delete v.ruleId;delete v.confidence;
  refreshDocuments(affected);for(const documentId of affected){const doc=state.documents.find(item=>item.id===documentId);if(doc&&!documentRelations(documentId,state.vouchers).length)doc.lastMatchReason='原关联已释放，请人工复核后重新关联';}
  bumpMatchDataRevision();rebuildPayerGroups();
  log('解除匹配',`${v.no}：${reason.trim()}；仅释放当前凭证关系，其他凭证分摊保留`);
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
  const current=new Set(voucher.documentIds);
  if (!['pending','missing'].includes(voucher.status) || isVoucherLocked(voucher) || docs.some(doc => !isReferenceDocument(doc)&&doc.status==='matched'&&!current.has(doc.id))) throw new Error('凭证或单据状态已变化，请刷新后重试');
  voucher.documentIds = [...new Set([...voucher.documentIds,...docs.map(doc=>doc.id)])];
  delete voucher.missingReason;
  voucher.ruleId = ruleId; voucher.confidence = confidence;
  docs.forEach(doc => {doc.lastMatchReason=ruleId==='MANUAL'?'已人工复核并关联凭证':`已按 ${ruleId} 关联凭证`;});
  refreshVoucherState(voucher);refreshDocuments(docs.map(doc=>doc.id));
  if(rebuild)rebuildPayerGroups();
}

/** 档案分组只能来源于真实匹配关系，并按已复核的凭证往来客商归集。 */
function matchedPayerGroups(source:ArchiveState):PayerGroup[]{
 const groups=new Map<string,PayerGroup>();
 const documents=new Map(source.documents.map(doc=>[doc.id,doc]));
 for(const voucher of source.vouchers){
  // 已人工确认的无附件豁免凭证也是完整档案，按凭证期间和往来客商直接归集。
  if(voucher.noAttachmentRequired&&voucher.status==='matched'){
   const payer=voucher.supplier.trim();
   const key=`${voucher.period}/${payer?normalizeSupplier(payer):'__unassigned__'}`;
   let group=groups.get(key);
   if(!group){group={id:`payer:${key}`,period:voucher.period,payerName:payer||'请复核付款人',needsPayerReview:!payer,documentIds:[],voucherIds:[],updatedAt:localTime()};groups.set(key,group);}
   if(!group.voucherIds.includes(voucher.id))group.voucherIds.push(voucher.id);
   continue;
  }
  if((voucher.status!=='matched'&&!voucher.entryAttachments?.length)||!voucher.documentIds.length)continue;
  const evidence=voucher.documentIds.map(docId=>documents.get(docId));
  // 分组来自真实关系；部分分摊的回单也可作为已核实证据，其剩余额度另在复核池管理。
  if(evidence.some(doc=>!doc))continue;
  const reviewedCounterparty=voucher.supplier.trim();
  for(const doc of evidence as SourceDocument[]){
   // 手工复核后的客商是凭证归集口径；旧数据缺客商时才兼容单据付款人。
   const payer=reviewedCounterparty||(doc.payerName??(doc.sourceKind==='pdf-text'?'':doc.supplier)).trim();
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

/** 人工处理绑定到具体分录，并为每份回单记录本次分摊金额。 */
function reconcileEntryAllocations(voucherId:string,entryIndex:number,allocations:EntryAllocationInput[],reason:string):void{
 ensureIdle();
 const voucher=state.vouchers.find(v=>v.id===voucherId);
 if(!voucher||isVoucherLocked(voucher))throw new Error('只能复核未锁定的凭证附件');
 const entry=voucher.entries?.[entryIndex];if(!entry||!Number.isInteger(entryIndex))throw new Error('分录不存在，请重新打开凭证');
 const money=entryMoney(entry);if(!money)throw new Error('该分录金额无效，请先核对原始借贷列');
 if(!reason.trim())throw new Error('请填写人工复核依据');
 if(new Set(allocations.map(item=>item.documentId)).size!==allocations.length)throw new Error('不能重复选择同一单据');
 const old=voucher.entryAttachments||[],own=old.filter(link=>link.entryIndex===entryIndex);
 const docs=allocations.map(item=>state.documents.find(doc=>doc.id===item.documentId));
 if(docs.some(doc=>!doc||isDocumentLocked(doc)))throw new Error('单据不存在或已锁定，请刷新后重试');
 if(docs.some(doc=>doc?.extractionStatus==='pending'&&doc.sourceKind!=='pdf-text'))throw new Error('请先对照原件补录并复核单据字段');
 let settlementTotal=0;
 const links=allocations.map((item,index)=>{
  const doc=docs[index]!,reference=isReferenceDocument(doc)||item.relationType==='reference';
  if(doc.documentStatus==='void')throw new Error('作废单据不能建立关联');
  if(reference){
   if(item.allocatedAmount!==undefined&&amountCents(item.allocatedAmount)!==0)throw new Error('共享引用不消耗单据金额');
   return {entryIndex,documentId:doc.id,side:money.side,ruleId:'MANUAL',reason:reason.trim(),relationType:'reference' as const};
  }
  if(doc.type!=='bank')throw new Error('分录金额分摊仅接受银行回单；发票请使用整凭证关联，合同与审批单请选择共享引用');
  const cents=item.allocatedAmount===undefined?amountCents(doc.amount):amountCents(item.allocatedAmount);
  if(!cents||Math.sign(cents)!==Math.sign(money.cents)||Math.sign(cents)!==Math.sign(amountCents(doc.amount)))throw new Error('分摊金额必须与分录、回单同号且不能为零；红字关系不能抵销蓝字');
  if((cents<0||money.cents<0)&&(voucher.businessType!=='red-letter'||doc.documentStatus!=='red-letter'))throw new Error('负数分摊仅限显式红字凭证与红字回单');
  const oldOwn=own.filter(link=>link.documentId===doc.id).reduce((sum,link)=>sum+(link.allocatedAmount===undefined?amountCents(doc.amount):amountCents(link.allocatedAmount)),0);
  const available=documentRemainingCents(doc,state.vouchers)+oldOwn;
  if(Math.abs(cents)>Math.abs(available)){
   const usedElsewhere=documentRelations(doc.id,state.vouchers).some(relation=>relation.voucher.id!==voucher.id||relation.link?.entryIndex!==entryIndex);
   if(usedElsewhere&&available===0)throw new Error('单据已被其他分录全额关联，不能重复消费');
   throw new Error(`${doc.name} 剩余可分摊金额不足，当前最多可分摊 ${centsToAmount(Math.abs(available))} 元`);
  }
  settlementTotal+=cents;
  return {entryIndex,documentId:doc.id,side:money.side,ruleId:'MANUAL',reason:reason.trim(),allocatedAmount:centsToAmount(cents),relationType:'settlement' as const};
 });
 if(settlementTotal&&settlementTotal!==money.cents)throw new Error(`分摊金额合计 ${centsToAmount(settlementTotal)} 元必须与本条分录金额 ${centsToAmount(money.cents)} 元完全一致`);
 const affected=new Set([...old.map(link=>link.documentId),...allocations.map(item=>item.documentId)]);
 // 依据属于分录本身，不依赖是否仍有关联单据；零关联保存也必须可回显并持久化。
 voucher.entryReviewNotes={...(voucher.entryReviewNotes||{}),[String(entryIndex)]:reason.trim()};
 detachNameAssociations(state,[voucher.id],[...affected]);
 const baseIds=voucher.documentIds.filter(id=>!old.some(link=>link.documentId===id));
 voucher.entryAttachments=[...old.filter(link=>link.entryIndex!==entryIndex),...links];
 voucher.documentIds=[...new Set([...baseIds,...voucher.entryAttachments.map(link=>link.documentId)])];
 voucher.ruleId=voucher.entryAttachments.every(link=>link.ruleId==='MANUAL')?'MANUAL':'R09';voucher.confidence=100;
 refreshVoucherState(voucher);refreshDocuments(affected);
 voucher.lastMatchReason=voucher.status==='matched'?'已按分录完成人工附件复核':'已有分录完成关联，其余分录或金额请复核';
 bumpMatchDataRevision();rebuildPayerGroups();log('分录附件复核',`${voucher.no} 第${entryIndex+1}条摘要关联 ${allocations.length} 份单据；依据：${reason.trim()}`);
}
function reconcileEntry(voucherId:string,entryIndex:number,documentIds:string[],reason:string):void{
 reconcileEntryAllocations(voucherId,entryIndex,documentIds.map(documentId=>({documentId})),reason);
}

function confirmAttachmentExemption(voucherId:string,reason:string):void{
 ensureIdle();const voucher=state.vouchers.find(v=>v.id===voucherId);
 if(!voucher||isVoucherLocked(voucher))throw new Error('只能处理未归档凭证');
 if(voucher.status==='missing')throw new Error('附件缺失不能使用无外部附件豁免，请先补齐原件或恢复待匹配后复核');
 if(!reason.trim())throw new Error('请填写无外部附件的业务依据');
 if(voucher.documentIds.length)throw new Error('已关联外部附件的凭证不能使用附件豁免');
 voucher.noAttachmentRequired=true;voucher.attachmentExemptionReason=reason.trim();voucher.ruleId='MANUAL';voucher.confidence=100;voucher.lastMatchReason=`内部凭证附件豁免：${reason.trim()}`;
 refreshVoucherState(voucher);bumpMatchDataRevision();rebuildPayerGroups();log('确认无外部附件',`${voucher.no}：${reason.trim()}`);
}

async function autoMatch(period?: string): Promise<{ matched: number; remaining: number; grouped:number }> {
 if(matching||writing)throw new Error('其他数据操作正在执行，请稍候');matching=true;
 try{
  await refreshDocumentParties();await refreshDocumentAccounts();
  await new Promise<void>(resolve=>setTimeout(resolve,150));
  const lockedVouchers=new Set(state.vouchers.filter(isVoucherLocked).map(voucher=>voucher.id));
  const lockedDocuments=new Set(state.vouchers.filter(voucher=>lockedVouchers.has(voucher.id)).flatMap(voucher=>voucher.documentIds));
  const targets=state.vouchers.filter(v=>(!period||v.period===period)&&!lockedVouchers.has(v.id)),targetIds=new Set(targets.map(v=>v.id));
  const documents=state.documents.filter(doc=>!lockedDocuments.has(doc.id));
  const alreadyAssociated=new Set(targets.filter(v=>collectionStatus(v)==='matched').map(v=>v.id));
  const beforeDocumentIds=new Set(targets.flatMap(v=>v.documentIds));
  const beforeNameDocumentIds=new Set((state.nameAssociations||[]).filter(group=>!period||group.period===period).flatMap(group=>group.documentIds));
  const rules=JSON.parse(JSON.stringify(state.rules)) as MatchRule[];
  // 重算未完成的 R09 自动关系，人工关系与已完成凭证原样保护。
  const snapshots=targets.map(source=>{
   const voucher=JSON.parse(JSON.stringify(source)) as Voucher;if(voucher.status==='matched')return voucher;
   const automatic=new Set((voucher.entryAttachments||[]).filter(link=>link.ruleId==='R09').map(link=>link.documentId));
   voucher.entryAttachments=(voucher.entryAttachments||[]).filter(link=>link.ruleId==='MANUAL');
   // 同一回单可能一条分录为人工关系、另一条为自动关系。重算自动部分时，
   // 只要人工关系仍引用该单据，就必须保留 documentIds 中的关系索引。
   voucher.documentIds=voucher.documentIds.filter(id=>!automatic.has(id)||voucher.entryAttachments?.some(link=>link.documentId===id));voucher.status='pending';return voucher;
  });
  const context=state.vouchers.filter(v=>!targetIds.has(v.id)&&!lockedVouchers.has(v.id)).map(v=>JSON.parse(JSON.stringify(v)) as Voucher);
  const documentSnapshots=documents.map(doc=>JSON.parse(JSON.stringify(doc)) as SourceDocument);
  const plan=await evaluateMatchPlan([...snapshots,...context],documentSnapshots,rules,localTime());
  const matches=plan.financial.matches.filter(match=>targetIds.has(match.voucherId));
  const voucherById=new Map(state.vouchers.map(v=>[v.id,v])),documentById=new Map(state.documents.map(doc=>[doc.id,doc]));
  // 提交前再验证一次快照对应的可消费状态，失败时不释放任何旧关系。
  for(const match of matches){
   const voucher=voucherById.get(match.voucherId)!,current=new Set(voucher.documentIds);
   for(const documentId of match.documentIds){const doc=documentById.get(documentId);if(!doc||!isReferenceDocument(doc)&&doc.status==='matched'&&!current.has(documentId))throw new Error('候选单据已被其他凭证使用，请刷新后重试');}
  }
  const affected=new Set<string>();
  for(const voucher of targets){
   if(voucher.status==='matched')continue;
   const automatic=new Set((voucher.entryAttachments||[]).filter(link=>link.ruleId==='R09').map(link=>link.documentId));
   automatic.forEach(id=>affected.add(id));
   voucher.entryAttachments=(voucher.entryAttachments||[]).filter(link=>link.ruleId==='MANUAL');
   voucher.documentIds=voucher.documentIds.filter(id=>!automatic.has(id)||voucher.entryAttachments?.some(link=>link.documentId===id));
  }
  for(const match of matches){
   const voucher=voucherById.get(match.voucherId)!;
   if(match.entryAttachments){voucher.entryAttachments=match.entryAttachments;voucher.documentIds=[...new Set([...voucher.documentIds,...match.entryAttachments.map(link=>link.documentId)])];}
   const docs=match.documentIds.map(id=>documentById.get(id)!);docs.forEach(doc=>affected.add(doc.id));
   bind(voucher,docs,match.ruleId,match.confidence,false);
  }
  for(const voucher of targets){refreshVoucherState(voucher);voucher.documentIds.forEach(id=>affected.add(id));}
  refreshDocuments(affected);
  for(const outcome of plan.financial.outcomes.filter(outcome=>targetIds.has(outcome.voucherId))){const voucher=voucherById.get(outcome.voucherId);if(voucher){voucher.lastMatchReason=outcome.reason;voucher.lastMatchRuleId=outcome.ruleId;}}
  const evaluatedNames=period?plan.names.filter(group=>group.period===period):plan.names;
  state.nameAssociations=[...(state.nameAssociations||[]).filter(group=>period&&group.period!==period),...evaluatedNames];pruneNameAssociations(state);
  for(const voucher of targets)associateVoucherWithExistingCompany(state,voucher.id,localTime());
  const named=state.nameAssociations.filter(group=>!period||group.period===period);
  for(const group of named)for(const voucherId of group.voucherIds){
   const voucher=targets.find(v=>v.id===voucherId);if(!voucher||voucher.status==='matched')continue;
   const reason=`${group.ruleId}：${group.basis==='company'?'单位名称':'往来名称'}与付款人或收款人一致，已按企业名称关联；凭证金额关系保留核对`;
   voucher.lastMatchReason=reason;voucher.lastMatchRuleId=group.ruleId;
   const outcome=plan.financial.outcomes.find(item=>item.voucherId===voucherId);if(outcome)Object.assign(outcome,{matched:true,ruleId:group.ruleId,reason});
  }
  for(const voucher of targets){voucher.matchReviewRequired=collectionStatus(voucher)!=='matched';if(voucher.matchReviewRequired&&!voucher.lastMatchReason)voucher.lastMatchReason=voucher.missingReason||'未找到符合当前规则的原始单据，请人工复核后关联';}
  const docReasons=new Map((plan.financial.documentOutcomes||[]).map(item=>[item.documentId,item.reason]));
  for(const doc of documents){
   const inScope=!!period&&doc.date.startsWith(period)||affected.has(doc.id)||docReasons.has(doc.id)||!period;
   if(!inScope)continue;
   if(!documentRelations(doc.id,state.vouchers).length){doc.matchReviewRequired=true;doc.lastMatchReason=docReasons.get(doc.id)||'本次未找到符合当前规则的凭证，请人工复核后关联';}
  }
  rebuildPayerGroups(period);
  const remaining=targets.filter(v=>collectionStatus(v)!=='matched').length;
  const associated=targets.filter(v=>collectionStatus(v)==='matched'&&!alreadyAssociated.has(v.id)).length;
  const groupCount=visibleArchiveGroups(state).filter(group=>!period||group.period===period).length;
  const scopeIds=new Set([...documents.filter(doc=>!period||doc.date.startsWith(period)).map(doc=>doc.id),...affected]);
  const associatedDocuments=state.documents.filter(doc=>scopeIds.has(doc.id)&&collectionStatus(doc)==='matched').length;
  const outcomes=plan.financial.outcomes.filter(outcome=>targetIds.has(outcome.voucherId));
  state.lastMatchRun={importSequence:state.lastImportSequence||0,dataRevision:state.matchDataRevision||0,id:id('match-run'),time:localTime(),period:period||'',matched:associated,financialMatched:matches.length,nameAssociatedVouchers:new Set(named.flatMap(group=>group.voucherIds)).size,nameAssociatedDocuments:new Set(named.flatMap(group=>group.documentIds)).size,associatedDocuments,newlyAssociatedDocuments:[...new Set([...affected,...named.flatMap(group=>group.documentIds)])].filter(id=>!beforeDocumentIds.has(id)&&!beforeNameDocumentIds.has(id)&&(documentRelations(id,state.vouchers).length||named.some(group=>group.documentIds.includes(id)))).length,remainingDocuments:[...scopeIds].filter(id=>{const doc=state.documents.find(item=>item.id===id);return doc&&collectionStatus(doc)!=='matched';}).length,remaining,groupCount,outcomes,rules};
  log('自动匹配',`统一执行回单分录与整凭证规则：新增完成 ${associated} 张凭证，${remaining} 张凭证请复核；共享资料不消耗金额，歧义候选未自动提交`);
  return {matched:associated,remaining,grouped:groupCount};
 }finally{matching=false;}
}

function manualMatch(voucherId: string, documentIds: string[], reason: string): void {
  if (!reason.trim()) throw new Error('请填写人工关联原因');
  const voucher = state.vouchers.find(v => v.id === voucherId);
  ensureIdle();
  if (!voucher || !['pending','missing'].includes(voucher.status)||isVoucherLocked(voucher)) throw new Error('请选择未归档的待处理凭证');
  if(voucher.reviewStatus==='pending')throw new Error('凭证字段尚待复核，请先核对原件并保存复核');
  if(voucher.amount===0||(voucher.amount<0&&voucher.businessType!=='red-letter'))throw new Error('零净额或未标识红字的负净额凭证不能用普通附件总额直接关联，请按分录人工处理');
  if(voucher.autoMatchBlockedReasons?.some(reason=>reason.includes('分录借贷合计')))throw new Error('分录借贷合计与凭证金额不一致，请核对原件后重新导入');
  if (!documentIds.length || new Set(documentIds).size !== documentIds.length) throw new Error('请选择不重复的单据');
  const docs = documentIds.map(docId => state.documents.find(doc => doc.id === docId));
  if (docs.some(doc => !doc || (!isReferenceDocument(doc)&&doc.status!=='pending') || doc.extractionStatus === 'pending' || doc.documentStatus==='void')) throw new Error('单据不存在、已被关联、已作废或等待字段复核');
  const selected = docs as SourceDocument[];
  // 发票、回单按同一证据类型分别核对；合同和审批单只作共享引用，不参与金额凑算。
  const financial=selected.filter(doc=>!isReferenceDocument(doc));
  if(financial.some(doc=>documentRemainingCents(doc,state.vouchers)!==amountCents(doc.amount)))throw new Error('已发生部分分摊的单据不能按整单重复关联，请在分录复核中使用剩余额度');
  if(new Set(financial.map(doc=>doc.type)).size>1)throw new Error('发票与银行回单是互补证据，不能混合相加凑凭证金额，请分别关联');
  const sum = financial.reduce((total, doc) => total + amountCents(doc.amount), 0);
  if (Math.abs(sum - amountCents(voucher.amount)) > 5) throw new Error('所选单据金额合计与凭证金额差额超过 0.05 元');
  if (voucher.expectedAttachments !== undefined && voucher.expectedAttachments !== selected.length) throw new Error(`附件数应为 ${voucher.expectedAttachments} 份`);
  // 金额关系一经人工确认，旧名称组立即退出，避免同一凭证同时出现在两个公司分组。
  detachNameAssociations(state,[voucher.id],documentIds);
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
    if((patch.tolerance!==undefined&&patch.tolerance!==0)||(patch.dateWindow!==undefined&&patch.dateWindow!==30)||(patch.matchType!==undefined&&patch.matchType!=='exact')||patch.conditions?.requireAmount===false||patch.conditions?.requireDate===false||patch.conditions?.associationScope==='party')throw new Error('分录分摊固定要求分摊合计一致、对应方向账号命中、日期差小于30天');
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
    // 自动匹配已确认证据关系时，字段待复核提示不再拦截正式档案；其余财务硬校验继续执行。
    const automaticMatch=voucher.status==='matched'&&!!voucher.ruleId&&voucher.ruleId!=='MANUAL';
    if(voucher.reviewStatus==='pending'&&!automaticMatch)throw new Error(`${voucher.no} 凭证字段尚待复核`);
    if(voucher.autoMatchBlockedReasons?.some(reason=>reason.includes('分录借贷合计')))throw new Error(`${voucher.no} 分录借贷合计不一致，不能归档`);
    if (voucher.status !== 'matched') throw new Error(`${voucher.no} 尚未完成附件匹配${voucher.missingReason ? `：${voucher.missingReason}` : ''}`);
    const docs = voucher.documentIds.map(docId => state.documents.find(doc => doc.id === docId));
    if(voucher.noAttachmentRequired){
      if(!voucher.attachmentExemptionReason?.trim())throw new Error(`${voucher.no} 缺少无外部附件的人工豁免依据`);
      if(docs.length)throw new Error(`${voucher.no} 附件豁免与已关联单据不能同时存在`);
      continue;
    }
    if(docs.some(doc=>doc?.extractionStatus==='pending'))throw new Error(`${voucher.no} 存在尚待复核的附件`);
    if (!docs.length || docs.some(doc => !doc)) throw new Error(`${voucher.no} 附件缺失`);
    if (voucher.expectedAttachments !== undefined && docs.length !== voucher.expectedAttachments) throw new Error(`${voucher.no} 附件数量不符`);
    if (docs.some(doc => doc!.type === 'invoice' && !doc!.seal)) throw new Error(`${voucher.no} 存在未确认发票章的单据`);
    if(voucher.entryAttachments?.length){
      if(!attachmentCoverage(voucher,voucher.entryAttachments,state.documents)||voucher.attachmentReviewRequired)throw new Error(`${voucher.no} 仍有分录附件需要复核`);
      if(voucher.entryAttachments.some(link=>!voucher.documentIds.includes(link.documentId)))throw new Error(`${voucher.no} 分录附件关系不完整`);
      for(const entryIndex of new Set(voucher.entryAttachments.map(link=>link.entryIndex))){
        const entry=voucher.entries?.[entryIndex],money=entry&&entryMoney(entry);
        const total=voucher.entryAttachments.filter(link=>link.entryIndex===entryIndex).reduce((sum,link)=>{
          const doc=state.documents.find(item=>item.id===link.documentId);if(!doc||isReferenceDocument(doc)||link.relationType==='reference')return sum;
          return sum+(link.allocatedAmount===undefined?amountCents(doc.amount):amountCents(link.allocatedAmount));
        },0);
        if(!money||money.cents!==total)throw new Error(`${voucher.no} 第${entryIndex+1}条分录分摊金额不一致`);
      }
    }else{
      const sum = docs.filter(doc=>!isReferenceDocument(doc!)).reduce((total, doc) => total + amountCents(doc!.amount), 0);
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
  return { state, storageError, recordOperation:(action:string,detail:string)=>{log(action,detail);}, refreshDocumentParties:()=>write(async()=>{const count=await refreshDocumentParties();await refreshDocumentAccounts();return count;}), reconcileEntry:(id:string,index:number,ids:string[],reason:string)=>syncWrite(()=>reconcileEntry(id,index,ids,reason)), reconcileEntryAllocations:(id:string,index:number,allocations:EntryAllocationInput[],reason:string)=>syncWrite(()=>reconcileEntryAllocations(id,index,allocations,reason)), confirmAttachmentExemption:(id:string,reason:string)=>syncWrite(()=>confirmAttachmentExemption(id,reason)), importMixedBatch:(vouchers:VoucherDraft[],documents:DocumentDraft[])=>write(()=>importMixedBatch(vouchers,documents)), importVouchers:(file:File)=>write(()=>importVouchers(file)), importVoucherBatch:(drafts:VoucherDraft[])=>write(()=>importVoucherBatch(drafts)), addDocument:(file:File,fields:Partial<SourceDocument>={})=>write(()=>addDocument(file,fields)), addDocumentBatch:(drafts:DocumentDraft[])=>write(()=>addDocumentBatch(drafts)), deleteVouchers:(ids:string[])=>write(()=>deleteVouchers(ids)), deleteDocuments:(ids:string[])=>write(()=>deleteDocuments(ids)), updateVoucher:(id:string,values:Record<string,unknown>)=>syncWrite(()=>updateVoucher(id,values)), updateDocument:(id:string,fields:DocumentDraft['fields'])=>syncWrite(()=>updateDocument(id,fields)), restoreMissing:(id:string)=>syncWrite(()=>restoreMissing(id)), isVoucherLocked, isDocumentLocked, unmatchVoucher:(id:string,reason:string)=>syncWrite(()=>unmatchVoucher(id,reason)), confirmSeal:(id:string)=>syncWrite(()=>confirmSeal(id)), autoMatch, manualMatch:(id:string,ids:string[],reason:string)=>syncWrite(()=>manualMatch(id,ids,reason)), markMissing:(id:string,reason:string)=>syncWrite(()=>markMissing(id,reason)), updateRule:(id:string,patch:Partial<MatchRule>)=>syncWrite(()=>updateRule(id,patch)), generateArchive:(request:GenerateArchiveRequest)=>syncWrite(()=>generateArchive(request)), resetData:()=>write(()=>resetData()) };
}
