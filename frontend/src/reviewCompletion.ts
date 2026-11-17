import {collectionStatus} from './matchWorkflow';
import type {Voucher} from './types';

export interface ReviewCompletionStore {
 state:{vouchers:Voucher[]};
 isVoucherLocked:(voucher:Voucher)=>boolean;
 autoMatch:(period?:string)=>Promise<unknown>;
}

export interface ReviewCompletionResult {
 completed:boolean;
 voucher:Voucher;
 reason:string;
}

/** Complete the explicit review action using the existing matching rules after fields are saved. */
export async function completeVoucherReview(store:ReviewCompletionStore,voucherId:string):Promise<ReviewCompletionResult> {
 const current=()=>{
  const voucher=store.state.vouchers.find(item=>item.id===voucherId);
  if(!voucher)throw new Error('凭证已不存在，请刷新后重试');
  if(store.isVoucherLocked(voucher))throw new Error('凭证已归档锁定，不能继续编辑或复核');
  return voucher;
 };
 let voucher=current();
 if(collectionStatus(voucher)!=='matched'){
  // Use the edited record's period, rather than the current page's optional filter.
  await store.autoMatch(voucher.period);
  voucher=current();
 }
 const completed=collectionStatus(voucher)==='matched';
 return {
  completed,
  voucher,
  reason:voucher.lastMatchReason||(completed?'已匹配归档，已同步电子档案列表':'字段已保存，仍有原始单据或分录关联待复核，请在当前窗口继续确认'),
 };
}
