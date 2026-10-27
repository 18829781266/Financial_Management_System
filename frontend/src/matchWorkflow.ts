import type {SourceDocument,Voucher} from './types';

export type CollectionStatus='pending'|'matched'|'review';

/**
 * 采集、匹配与字段复核是不同的业务步骤。新采集的 PDF 即使尚未核对字段，
 * 也只显示待匹配；执行匹配后未关联的记录才进入请复核，复核保存不等于关联。
 */
export function collectionStatus(record:Voucher|SourceDocument):CollectionStatus {
 if('no' in record&&record.attachmentReviewRequired)return 'review';
 if(record.status==='matched'||record.nameAssociationIds?.length)return 'matched';
 return record.matchReviewRequired||record.status==='missing'?'review':'pending';
}

export function collectionStatusLabel(record:Voucher|SourceDocument):string {
 return {pending:'待匹配',matched:'已匹配归档',review:'请复核'}[collectionStatus(record)];
}
