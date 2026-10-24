import type {ArchiveState} from '../../src/types';
import {nameAssociationRule} from '../../src/nameAssociation';

/** 仅测试夹具，生产包不引入演示记录。 */
export function testSeed(): ArchiveState {
  const suppliers = ['京东世纪贸易有限公司', '阿里云计算有限公司', '上海晨光文具有限公司', '中国电信股份有限公司', '深圳市金蝶软件有限公司', '顺丰速运有限公司'];
  const amounts = [4280, 12800, 2360, 1860, 9800, 468];
  const summaries = ['采购办公设备及耗材', '支付云计算服务费', '采购办公用品', '支付企业通信服务费', '支付财务软件服务费', '支付快递物流费'];
  const documents: SourceDocument[] = suppliers.map((supplier, i) => ({ id: `d00${i + 1}`, name: `${['办公设备增值税发票', '云服务增值税发票', '办公用品增值税发票', '企业通信银行回单', '软件服务增值税发票', '物流服务增值税发票'][i]}.pdf`, type: i === 3 ? 'bank' : 'invoice', supplier, amount: amounts[i]!, date: `2026-10-0${i + 1}`, number: `26101000000${i + 1}`, seal: true, status: 'matched', confidence: 99.2, extractionStatus: 'reviewed' }));
  const vouchers: Voucher[] = suppliers.map((supplier, i) => ({ id: `v00${i + 1}`, no: `记-000${i + 1}`, period: '2026-10', date: `2026-10-0${i + 1}`, summary: summaries[i]!, supplier, amount: amounts[i]!, status: 'matched', documentIds: [`d00${i + 1}`], confidence: 99.2, ruleId: i === 3 ? 'R03' : 'R01', invoiceNo: i === 3 ? undefined : `26101000000${i + 1}`, bankNo: i === 3 ? '261010000004' : undefined, expectedAttachments: 1 }));
  vouchers.push(
    { id: 'v007', no: '记-0007', period: '2026-10', date: '2026-10-08', summary: '支付协同办公系统服务费', supplier: '北京致远互联软件有限公司', amount: 3500, status: 'pending', documentIds: [], invoiceNo: '261010000007', expectedAttachments: 1 },
    { id: 'v008', no: '记-0008', period: '2026-10', date: '2026-10-09', summary: '支付腾讯云企业服务费', supplier: '腾讯科技有限公司', amount: 6800, status: 'pending', documentIds: [], contractNo: 'HT-2026-1008', expectedAttachments: 1 },
    { id: 'v009', no: '记-0009', period: '2026-10', date: '2026-10-10', summary: '云资源服务费汇总结算', supplier: '阿里云', amount: 16800, status: 'pending', documentIds: [], expectedAttachments: 2 },
    { id: 'v010', no: '记-0010', period: '2026-10', date: '2026-10-11', summary: '支付银行账户服务手续费', supplier: '招商银行股份有限公司', amount: 120, status: 'pending', documentIds: [], bankNo: 'CMB202610110018', expectedAttachments: 1 },
    { id: 'v011', no: '记-0011', period: '2026-10', date: '2026-10-12', summary: '采购办公家具', supplier: '华润办公用品有限公司', amount: 1590, status: 'missing', documentIds: [], missingReason: '供应商尚未开具发票，已发起补票申请', expectedAttachments: 1 },
    { id: 'v012', no: '记-0012', period: '2026-10', date: '2026-10-13', summary: '支付设备租赁费', supplier: '中科租赁有限公司', amount: 5400, status: 'pending', documentIds: [], expectedAttachments: 1 },
  );
  documents.push(
    { id: 'd007', name: '协同办公服务费发票.pdf', type: 'invoice', supplier: '北京致远互联软件', amount: 3500.01, date: '2026-10-08', number: '261010000007', seal: true, status: 'pending', confidence: 98.8, extractionStatus: 'reviewed' },
    { id: 'd008', name: '腾讯云企业服务合同.pdf', type: 'contract', supplier: '腾讯科技有限公司', amount: 6800, date: '2026-10-09', number: 'HT-2026-1008', seal: true, status: 'pending', confidence: 99.1, extractionStatus: 'reviewed' },
    { id: 'd009', name: '阿里云资源服务发票-01.pdf', type: 'invoice', supplier: '阿里云计算有限公司', amount: 10000, date: '2026-10-10', number: '261010000009', seal: true, status: 'pending', confidence: 99.4, extractionStatus: 'reviewed' },
    { id: 'd010', name: '阿里云资源服务发票-02.pdf', type: 'invoice', supplier: '阿里云计算有限公司', amount: 6800, date: '2026-10-10', number: '261010000010', seal: true, status: 'pending', confidence: 99.2, extractionStatus: 'reviewed' },
    { id: 'd011', name: '招商银行手续费回单.pdf', type: 'bank', supplier: '招商银行股份有限公司', amount: 120, date: '2026-10-11', number: 'CMB202610110018', seal: true, status: 'pending', confidence: 99.6, extractionStatus: 'reviewed' },
    { id: 'd012', name: '待认领差旅交通发票.pdf', type: 'invoice', supplier: '上海交通有限公司', amount: 360, date: '2026-10-14', number: '261010000012', seal: true, status: 'pending', confidence: 98.4, extractionStatus: 'reviewed' },
  );
  return {
    lastImportSequence:0,matchDataRevision:0,payerGroups:[],nameAssociations:[],lastMatchRun:undefined,
    vouchers, documents,
    archives: [
      { id: 'arc-202610-01', title: '2026年10月会计凭证', period: '2026-10', startVoucherNo: '记-0001', endVoucherNo: '记-0006', voucherCount: 6, pageCount: 18, amount: 31568, createdAt: '2026-10-19 14:32:08', status: 'locked' },
      { id: 'arc-202609-01', title: '2026年09月会计凭证', period: '2026-09', startVoucherNo: '记-0001', endVoucherNo: '记-0036', voucherCount: 36, pageCount: 108, amount: 286450.8, createdAt: '2026-10-08 10:16:22', status: 'locked' },
      { id: 'arc-202608-01', title: '2026年08月会计凭证', period: '2026-08', startVoucherNo: '记-0001', endVoucherNo: '记-0042', voucherCount: 42, pageCount: 126, amount: 324860, createdAt: '2026-09-05 09:42:10', status: 'locked' },
      { id: 'arc-202607-01', title: '2026年07月会计凭证', period: '2026-07', startVoucherNo: '记-0001', endVoucherNo: '记-0031', voucherCount: 31, pageCount: 93, amount: 219730.5, createdAt: '2026-08-06 11:08:41', status: 'locked' },
    ],
    rules: [
      { id: 'R01', name: '发票号码精确匹配', description: '发票号码一致，校验金额容差后自动关联', priority: 1, enabled: true, threshold: 95, tolerance: 0.05, dateWindow: 30, matchType: 'exact' },
      { id: 'R02', name: '合同编号精确匹配', description: '以合同编号建立凭证与合同的关联', priority: 2, enabled: true, threshold: 95, tolerance: 0.05, dateWindow: 90, matchType: 'exact' },
      { id: 'R03', name: '银行流水号精确匹配', description: '核对银行流水号及收付款金额', priority: 3, enabled: true, threshold: 95, tolerance: 0.05, dateWindow: 7, matchType: 'exact' },
      { id: 'R04', name: '审批单号精确匹配', description: '按审批单号关联报销或费用审批记录', priority: 4, enabled: true, threshold: 95, tolerance: 0.05, dateWindow: 30, matchType: 'exact' },
      { id: 'R05', name: '发票多字段模糊匹配', description: '综合金额、客商名称相似度与开票日期', priority: 5, enabled: true, threshold: 85, tolerance: 0.05, dateWindow: 7, matchType: 'fuzzy' },
      { id: 'R06', name: '回单多字段模糊匹配', description: '综合金额、交易对手及银行交易日期', priority: 6, enabled: true, threshold: 85, tolerance: 0.05, dateWindow: 7, matchType: 'fuzzy' },
      { id: 'R07', name: '多张发票汇总匹配', description: '同一客商的多张发票金额合计匹配一张凭证', priority: 7, enabled: true, threshold: 90, tolerance: 0.05, dateWindow: 7, matchType: 'aggregate' },
      nameAssociationRule(),
    ],
    logs: [
      { id: 'log-1', time: '2026-10-19 14:32:08', action: '生成档案册', detail: '演示档案：2026年10月会计凭证，记-0001 至 记-0006', operator: '财务管理员' },
      { id: 'log-2', time: '2026-10-19 14:28:36', action: '自动匹配', detail: '按规则优先级关联 6 张凭证与 6 份原始单据', operator: '财务管理员' },
      { id: 'log-3', time: '2026-10-19 14:20:15', action: '导入凭证', detail: '从金蝶 ERP 导入 2026-10 期间凭证 12 张（演示数据）', operator: '财务管理员' },
    ],
  };
}

export function resetTestState(store:{state:ArchiveState}):void{Object.assign(store.state,testSeed());}
