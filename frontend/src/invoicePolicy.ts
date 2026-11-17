import type {InvoiceCarrier,InvoiceVerification,SourceDocument} from './types';

export const invoiceCarriers:readonly InvoiceCarrier[]=['unknown','digital','electronic','paper'];
export const invoiceVerifications:readonly InvoiceVerification[]=['pending','passed','failed'];

export function invoiceCarrier(value:unknown):InvoiceCarrier {
 if(value===undefined||value==='')return 'unknown';
 if(!invoiceCarriers.includes(value as InvoiceCarrier))throw new Error('请选择有效的发票载体');
 return value as InvoiceCarrier;
}
export function invoiceVerification(value:unknown):InvoiceVerification {
 if(value===undefined||value==='')return 'pending';
 if(!invoiceVerifications.includes(value as InvoiceVerification))throw new Error('请选择有效的人工核验结果');
 return value as InvoiceVerification;
}

/** 可见印章只适用于纸票核对；人工登记的核验记录不代表系统已连接税务查验或完成数字验签。 */
export function invoiceArchiveIssue(document:SourceDocument):string|undefined {
 if(document.type!=='invoice')return;
 if(document.invoiceVerification==='failed')return '发票人工核验未通过，请处理后再归档';
 const carrier=document.invoiceCarrier||'unknown';
 if(!invoiceCarriers.includes(carrier)||carrier==='unknown')return '发票载体待确认，请区分数电发票、电子发票或纸质扫描件';
 if(carrier==='paper')return document.seal?undefined:'存在未确认发票章的纸质发票，请核对原件';
 if(!document.fileId)return '电子发票缺少电子原件';
 if(document.invoiceVerification!=='passed'||!document.invoiceVerificationBasis?.trim()||!document.invoiceCheckedAt)return '电子发票需登记人工查验或验签依据，不能仅凭无可见印章直接归档';
}
