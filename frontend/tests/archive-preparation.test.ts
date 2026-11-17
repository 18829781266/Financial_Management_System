import {describe,expect,it} from 'vitest';
import {getArchivePreparation} from '../src/archivePreparation';
import type {GenerateArchiveRequest,SourceDocument,Voucher} from '../src/types';

const voucher=(no:string,patch:Partial<Voucher>={}):Voucher=>({id:'v-'+no,no,period:'2026-09',date:'2026-09-01',summary:'合成归档复核',supplier:'合成交易企业',amount:100,status:'pending',documentIds:[],...patch});
const document=(id:string,patch:Partial<SourceDocument>={}):SourceDocument=>({id,name:id+'.pdf',number:id,type:'bank',supplier:'合成交易企业',date:'2026-09-01',amount:100,seal:false,status:'pending',extractionStatus:'pending',...patch});
const request=(start='记-1',end=start,period='2026-09'):GenerateArchiveRequest=>({period,startVoucherNo:start,endVoucherNo:end});
const blank={pendingDocuments:[],noAttachmentVouchers:[],missingVouchers:[],exemptVouchers:[]};

describe('生成前附件复核提示只反映实际选中凭证',()=>{
 it('使用同期间自然排序闭区间，不将记-10错排进记-2之前，也不影响跨期记录',()=>{
  const one=voucher('记-1'),two=voucher('记-2'),ten=voucher('记-10'),october=voucher('记-2',{id:'october',period:'2026-10',date:'2026-10-01'});
  const result=getArchivePreparation(request('记-2','记-10'),[ten,october,one,two],[]);
  expect(result.noAttachmentVouchers.map(v=>v.id)).toEqual([two.id,ten.id]);
  expect(getArchivePreparation(request('记-2','记-2','2026-10'),[ten,october,one,two],[]).noAttachmentVouchers).toEqual([october]);
 });
 it.each([
  request('记-1','记-2','2026-13'),request('记-1','记-2','2026-9'),request('记-2','记-1'),
  request('','记-2'),request('记-1',' '),request('记-0','记-2'),request('记-1','记-3'),
 ])('无效期间、倒置、空白或不存在端点时不提前提示非选中记录：%j',invalid=>{
  const doc=document('actual');
  expect(getArchivePreparation(invalid,[voucher('记-1',{documentIds:[doc.id]}),voucher('记-2')],[doc])).toEqual(blank);
 });
 it('已完成关系匹配的附件字段仍可待复核，去重共享单据并保留每张凭证号',()=>{
  const pending=document('pending',{status:'matched'}),reviewed=document('reviewed',{status:'matched',extractionStatus:'reviewed'});
  const first=voucher('记-1',{status:'matched',reviewStatus:'reviewed',documentIds:[pending.id,pending.id,reviewed.id]}),second=voucher('记-2',{status:'matched',documentIds:[pending.id]});
  const result=getArchivePreparation(request('记-1','记-2'),[second,first],[pending,reviewed]);
  expect(result.pendingDocuments).toEqual([{document:pending,voucherNos:['记-1','记-2']}]);
  expect(result.noAttachmentVouchers).toEqual([]);expect(result.missingVouchers).toEqual([]);
  pending.extractionStatus='reviewed';
  expect(getArchivePreparation(request('记-1','记-2'),[second,first],[pending,reviewed]).pendingDocuments).toEqual([]);
 });
 it('名称归集候选与其他凭证的待复核附件不会冒充当前凭证的实际附件',()=>{
  const candidate=document('name-only',{nameAssociationIds:['R08-group']}),elsewhere=document('outside');
  const current=voucher('记-1',{nameAssociationIds:['R08-group']}),outside=voucher('记-2',{documentIds:[elsewhere.id]});
  const result=getArchivePreparation(request(),[current,outside],[candidate,elsewhere]);
  expect(result.pendingDocuments).toEqual([]);expect(result.noAttachmentVouchers).toEqual([current]);
 });
 it('零附件只提供人工确认入口，不因凭证字段已复核或附件数为零而自动豁免',()=>{
  const current=voucher('记-1',{reviewStatus:'reviewed',expectedAttachments:0});
  const result=getArchivePreparation(request(),[current],[]);
  expect(result.noAttachmentVouchers).toEqual([current]);expect(result.exemptVouchers).toEqual([]);
  expect(current.noAttachmentRequired).toBeUndefined();expect(current.status).toBe('pending');
 });
 it('标记缺失及悬空关联留在补件复核，不提供无附件确认；已有真实待复核原件仍可定位',()=>{
  const doc=document('real');
  const missing=voucher('记-1',{status:'missing'}),dangling=voucher('记-2',{documentIds:['lost',doc.id]}),partialMissing=voucher('记-3',{status:'missing',documentIds:[doc.id]});
  const result=getArchivePreparation(request('记-1','记-3'),[partialMissing,dangling,missing],[doc]);
  expect(result.missingVouchers).toEqual([missing,dangling,partialMissing]);
  expect(result.noAttachmentVouchers).toEqual([]);expect(result.exemptVouchers).toEqual([]);
  expect(result.pendingDocuments).toEqual([{document:doc,voucherNos:['记-2','记-3']}]);
 });
 it('仅明确已完成、无关联附件且有依据的凭证显示已确认无附件',()=>{
  const complete=voucher('记-1',{status:'matched',noAttachmentRequired:true,attachmentExemptionReason:'内部结转，已核对计算依据'});
  const unfinished=voucher('记-2',{noAttachmentRequired:true,attachmentExemptionReason:'尚未完成'});
  const noReason=voucher('记-3',{status:'matched',noAttachmentRequired:true,attachmentExemptionReason:' '});
  const conflicting=voucher('记-4',{status:'matched',noAttachmentRequired:true,attachmentExemptionReason:'存在外部原件',documentIds:['external']});
  const result=getArchivePreparation(request('记-1','记-4'),[complete,unfinished,noReason,conflicting],[document('external',{extractionStatus:'reviewed'})]);
  expect(result.exemptVouchers).toEqual([complete]);
  expect(result.noAttachmentVouchers).toEqual([]);expect(result.missingVouchers).toEqual([]);
 });
 it('展示读取不修改输入数组、业务状态、复核依据或关联关系',()=>{
  const current=voucher('记-1',{status:'matched',reviewStatus:'reviewed',documentIds:['pending']}),doc=document('pending');
  const vouchers=[current],documents=[doc],selection=request();
  const before=JSON.stringify({vouchers,documents,selection});
  const result=getArchivePreparation(selection,vouchers,documents);
  expect(result.pendingDocuments).toHaveLength(1);
  expect(JSON.stringify({vouchers,documents,selection})).toBe(before);
 });
});
