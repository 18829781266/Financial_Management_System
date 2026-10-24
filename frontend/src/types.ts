/** 浏览器本地数据；生产持久化及并发控制由 Java 服务端负责。 */
export interface VoucherEntry {summary:string;account:string;debit:string;credit:string;sourcePage?:number}

export interface Voucher {
  /** 企业名称关联独立保存，不能当作已通过金额核对的凭证附件关系。 */
  nameAssociationIds?:string[];
  id: string;
  /** 实际导入时间与提交序号，不使用凭证业务日期推断新旧。 */
  importedAt?: string;
  importSequence?: number;
  no: string;
  period: string;
  date: string;
  summary: string;
  supplier: string;
  amount: number;
  status: 'matched' | 'pending' | 'missing';
  /** 仅在一次匹配未命中或已有关联被释放后置为 true，采集时不由字段复核状态推断。 */
  matchReviewRequired?: boolean;
  documentIds: string[];
  confidence?: number;
  ruleId?: string;
  missingReason?: string;
  invoiceNo?: string;
  contractNo?: string;
  bankNo?: string;
  approvalNo?: string;
  expectedAttachments?: number;
  fileId?: string;
  fileName?: string;
  sourceKind?: 'pdf-text';
  sourcePages?: number[];
  company?: string;
  entries?: VoucherEntry[];
  /** 文字层提取后必须经过人工核对，不能直接当成已复核凭证。 */
  reviewStatus?: 'pending' | 'reviewed';
  reviewReasons?: string[];
  /** 零净额、红字或多往来凭证需人工分配证据，复核后仍不自动匹配。 */
  autoMatchBlockedReasons?: string[];
  sourceAmount?: string;
  lastMatchReason?: string;
  lastMatchRuleId?: string;
}

export interface SourceDocument {
  nameAssociationIds?:string[];
  id: string;
  importedAt?: string;
  importSequence?: number;
  name: string;
  type: 'invoice' | 'bank' | 'contract' | 'approval';
  supplier: string;
  /** 原件付款人、收款人分别保存；supplier 为付款人名称的兼容字段。 */
  payerName?: string;
  payeeName?: string;
  partyVersion?: number;
  bankNo?: string;
  receiptNo?: string;
  legacyCounterparty?: string;
  payerGroupId?: string;
  amount: number;
  date: string;
  number: string;
  seal: boolean;
  status: 'matched' | 'pending';
  matchReviewRequired?: boolean;
  lastMatchReason?: string;
  url?: string;
  fileId?: string;
  confidence?: number;
  /** 本地上传不会假装执行 OCR，必须补录并复核结构化字段。 */
  extractionStatus?: 'pending' | 'reviewed';
  sourceKind?: 'pdf-text';
  sourcePages?: number[];
  reviewReasons?: string[];
}

export interface ArchiveRecord {kind:'voucher'|'document';no:string;date:string;supplier:string;amount:number;summary:string;fileId?:string;fileName?:string}

export interface ArchiveBook {
  id: string;
  title: string;
  period: string;
  startVoucherNo: string;
  endVoucherNo: string;
  voucherCount: number;
  pageCount: number;
  amount: number;
  createdAt: string;
  status: 'locked';
  /** 仅真实生成 PDF 字节并计算后才允许填写。演示记录为空。 */
  hash?: string;
  fileId?: string;
}

export interface MatchRule {
  id: string;
  name: string;
  description: string;
  priority: number;
  enabled: boolean;
  /** 百分制置信度阈值，例如 85。 */
  threshold: number;
  /** 元为单位的绝对金额容差，计算时转换为整数分。 */
  tolerance: number;
  dateWindow: number;
  matchType: 'exact' | 'fuzzy' | 'aggregate';
  conditions?: {
    associationScope?:'voucher'|'party';
    partyField?: 'payerName' | 'payeeName' | 'either';
    documentTypes?: SourceDocument['type'][];
    requireDate?: boolean;
    requireAmount?: boolean;
  };
}

/** 包含已执行产生的凭证关联或企业名称关联；不等同于校验后只读锁定的正式 PDF 档案册。 */
export interface PayerGroup {id:string;period:string;payerName:string;documentIds:string[];voucherIds:string[];updatedAt:string;needsPayerReview?:boolean;associationType?:'name';ruleId?:string;confidence?:number}
export interface NameAssociation extends PayerGroup {associationType:'name';ruleId:string;confidence:number;basis:'company'|'counterparty'|'documents';partyField?:'payerName'|'payeeName'|'either';documentTypes?:SourceDocument['type'][]}
export interface MatchOutcome {voucherId:string;matched:boolean;reason:string;ruleId?:string}
export interface MatchRun {importSequence?:number;dataRevision?:number;id:string;time:string;period:string;matched:number;remaining:number;groupCount:number;outcomes:MatchOutcome[];rules:MatchRule[];financialMatched?:number;nameAssociatedVouchers?:number;nameAssociatedDocuments?:number;associatedDocuments?:number;newlyAssociatedDocuments?:number;remainingDocuments?:number}

export interface OperationLog {
  id: string;
  time: string;
  action: string;
  detail: string;
  operator: string;
}

export interface ArchiveState {
  /** 成功提交的最后导入序号，删除记录后仍保留，兼容旧存储缺失该字段。 */
  lastImportSequence?: number;
  /** 匹配候选发生变化时递增；兼容旧存储缺失该字段。 */
  matchDataRevision?: number;
  payerGroups?: PayerGroup[];
  nameAssociations?:NameAssociation[];
  lastMatchRun?: MatchRun;
  vouchers: Voucher[];
  documents: SourceDocument[];
  archives: ArchiveBook[];
  rules: MatchRule[];
  logs: OperationLog[];
}

export interface GenerateArchiveRequest {
  period: string;
  startVoucherNo: string;
  endVoucherNo: string;
}
