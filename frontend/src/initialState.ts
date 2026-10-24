import type {ArchiveState} from './types';
import {nameAssociationRule} from './nameAssociation';

/** 默认仅保留系统规则，业务数据始终从空白开始。 */
export function emptyArchiveState():ArchiveState {
 return {lastImportSequence:0,matchDataRevision:0,vouchers:[],documents:[],archives:[],logs:[],payerGroups:[],nameAssociations:[],lastMatchRun:undefined,
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
 };
}
