import {describe,expect,it} from 'vitest';
import {collectionStatus,collectionStatusLabel,voucherStatusLabel} from '../src/matchWorkflow';
import type {SourceDocument,Voucher} from '../src/types';

const voucher=(patch:Partial<Voucher>={}):Voucher=>({id:'status-voucher',no:'记-1',period:'2026-09',date:'2026-09-30',summary:'合成状态显示验证',supplier:'合成单位',amount:100,status:'pending',documentIds:[],...patch});
const document=(patch:Partial<SourceDocument>={}):SourceDocument=>({id:'status-document',name:'合成状态原件.pdf',type:'invoice',number:'SYNTHETIC-STATUS',supplier:'合成单位',amount:100,date:'2026-09-30',seal:false,status:'pending',...patch});

describe('匹配状态文案与实际采集状态一致',()=>{
 it('财务匹配成功的凭证及单据统一显示已匹配归档',()=>{
  const v=voucher({status:'matched',documentIds:['status-document'],reviewStatus:'pending'});
  const d=document({status:'matched',extractionStatus:'pending'});
  expect(collectionStatus(v)).toBe('matched');expect(collectionStatus(d)).toBe('matched');
  expect(voucherStatusLabel(v)).toBe('已匹配归档');
  expect(collectionStatusLabel(v)).toBe('已匹配归档');expect(collectionStatusLabel(d)).toBe('已匹配归档');
 });
 it('名称关联已成功的原始pending记录不再被误标为待匹配',()=>{
  const v=voucher({nameAssociationIds:['name:R08:2026-09:synthetic']});
  const d=document({nameAssociationIds:['name:R08:2026-09:synthetic']});
  expect(collectionStatus(v)).toBe('matched');expect(collectionStatus(d)).toBe('matched');
  expect(voucherStatusLabel(v)).toBe('已匹配归档');
  expect(collectionStatusLabel(v)).toBe('已匹配归档');expect(collectionStatusLabel(d)).toBe('已匹配归档');
 });
 it('没有形成关联的新采集记录仍然显示待匹配',()=>{
  expect(voucherStatusLabel(voucher({reviewStatus:'pending'}))).toBe('待匹配');
  expect(collectionStatusLabel(document({extractionStatus:'pending'}))).toBe('待匹配');
 });
 it('未命中及部分附件的人工复核状态不被新文案提升为成功',()=>{
  const v=voucher({matchReviewRequired:true});
  const partial=voucher({status:'matched',attachmentReviewRequired:true});
  expect(collectionStatus(v)).toBe('review');expect(voucherStatusLabel(v)).toBe('待人工复核');
  expect(collectionStatus(partial)).toBe('review');expect(voucherStatusLabel(partial)).toBe('待人工复核');
  expect(collectionStatusLabel(document({matchReviewRequired:true}))).toBe('请复核');
 });
 it('附件缺失凭证保留缺失提示',()=>{
  const v=voucher({status:'missing'});
  expect(collectionStatus(v)).toBe('review');expect(voucherStatusLabel(v)).toBe('附件缺失');
 });
 it('状态文案不改变名称关系、附件关系或原始业务状态',()=>{
  const v=voucher({nameAssociationIds:['name:synthetic']});
  const d=document({nameAssociationIds:['name:synthetic']});
  const before=JSON.stringify({v,d});
  voucherStatusLabel(v);collectionStatusLabel(v);collectionStatusLabel(d);
  expect(JSON.stringify({v,d})).toBe(before);
  expect(v.status).toBe('pending');expect(v.documentIds).toEqual([]);
 });
});
