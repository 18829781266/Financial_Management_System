import {describe,expect,it} from 'vitest';
import {mergeArchiveDisplayGroups} from '../src/archiveDisplayGroups';
import type {PayerGroup} from '../src/types';

const group=(id:string,patch:Partial<PayerGroup>={}):PayerGroup=>({id,period:'2026-09',payerName:'合成科技有限公司',documentIds:[],voucherIds:[],updatedAt:'2026-11-12',...patch});

describe('电子档案同企业显示归集',()=>{
 it('同期间企业名称和凭证分组的成员并集去重，保留原来源ID及关联类型',()=>{
  const groups=[group('name',{associationType:'name',voucherIds:['v1','v2','v1'],documentIds:['d1','d2']}),group('financial',{voucherIds:['v2','v3'],documentIds:['d2','d3','d3']})];
  const before=JSON.stringify(groups);
  const merged=mergeArchiveDisplayGroups(groups);
  expect(merged).toHaveLength(1);
  expect(merged[0]!.voucherIds).toEqual(['v1','v2','v3']);
  expect(merged[0]!.documentIds).toEqual(['d1','d2','d3']);
  expect(merged[0]!.sourceGroupIds).toEqual(['name','financial']);
  expect(merged[0]!.associationKinds).toEqual(['name','voucher']);
  expect(JSON.stringify(groups)).toBe(before);
 });
 it('仅做NFKC和首尾空格归一，近似公司名称不合并',()=>{
  const merged=mergeArchiveDisplayGroups([group('full',{payerName:'　ＡＢＣ科技有限公司　'}),group('ascii',{payerName:'ABC科技有限公司'}),group('similar',{payerName:'ABC科技有限责任公司'})]);
  expect(merged).toHaveLength(2);
  expect(merged[0]!.sourceGroupIds).toEqual(['full','ascii']);
  expect(merged[0]!.payerName).toBe('ABC科技有限公司');
 });
 it('同企业不同期间及不同企业保持独立',()=>{
  const merged=mergeArchiveDisplayGroups([group('sep'),group('oct',{period:'2026-10'}),group('other',{payerName:'另一家科技有限公司'})]);
  expect(merged).toHaveLength(3);
 });
 it('付款人待复核、空名称及未知名称不跨来源合并',()=>{
  const groups=[group('unknown1',{payerName:'付款人未录入'}),group('unknown2',{payerName:'付款人未录入'}),group('review1',{needsPayerReview:true}),group('review2',{needsPayerReview:true}),group('blank1',{payerName:''}),group('blank2',{payerName:''})];
  expect(mergeArchiveDisplayGroups(groups)).toHaveLength(6);
 });
 it('仅单据名称组保留全部单据，不制造凭证或金额字段',()=>{
  const merged=mergeArchiveDisplayGroups([group('docs1',{associationType:'name',documentIds:['d1','d2']}),group('docs2',{associationType:'name',documentIds:['d2','d3']})]);
  expect(merged).toHaveLength(1);
  expect(merged[0]!.voucherIds).toEqual([]);
  expect(merged[0]!.documentIds).toEqual(['d1','d2','d3']);
  expect(merged[0]!.associationKinds).toEqual(['name']);
 });
});
