import {describe,expect,it} from 'vitest';
import {findVoucherArchive} from '../src/archiveNavigation';
import type {ArchiveBook,Voucher} from '../src/types';

const voucher:Voucher={id:'voucher-23',no:'记-23',period:'2026-09',date:'2026-09-30',summary:'合成档案导航',supplier:'合成公司',amount:100,status:'matched',documentIds:[],fileId:'voucher-file-23'};
const book=(id:string,patch:Partial<ArchiveBook>={}):ArchiveBook=>({id,title:'合成会计凭证档案',period:'2026-09',startVoucherNo:'记-1',endVoucherNo:'记-30',voucherCount:30,pageCount:60,amount:3000,createdAt:'2026-11-12',status:'locked',...patch});

describe('凭证打开已有档案册',()=>{
 it('同册多张凭证按固化成员ID定位，未归档凭证不因同号落入范围误判',()=>{
  const archive=book('exact',{voucherIds:['voucher-23','voucher-24']});
  expect(findVoucherArchive([archive],voucher)).toBe(archive);
  expect(findVoucherArchive([archive],{...voucher,id:'voucher-24',no:'记-24'})).toBe(archive);
  expect(findVoucherArchive([archive],{...voucher,id:'new-voucher-23'})).toBeUndefined();
 });
 it('跨期间相同凭证号或ID不打开另一期间的档案',()=>{
  const archive=book('other-period',{period:'2026-08',voucherIds:[voucher.id]});
  expect(findVoucherArchive([archive],voucher)).toBeUndefined();
  expect(findVoucherArchive([book('old-other-period',{period:'2026-08'})],voucher)).toBeUndefined();
 });
 it('精确成员优先于排在前面的旧版范围档案',()=>{
  const exact=book('exact',{voucherIds:[voucher.id]});
  expect(findVoucherArchive([book('legacy'),exact],voucher)).toBe(exact);
 });
 it('显式空成员或其他成员不回退到凭证号范围与原件信息',()=>{
  const record={kind:'voucher' as const,recordId:voucher.id,no:voucher.no,date:voucher.date,supplier:voucher.supplier,amount:voucher.amount,summary:voucher.summary,fileId:voucher.fileId};
  expect(findVoucherArchive([book('empty',{voucherIds:[],records:[record]})],voucher)).toBeUndefined();
  expect(findVoucherArchive([book('excluded',{voucherIds:['other-id'],records:[record]})],voucher)).toBeUndefined();
 });
 it('旧版本有固化记录时可按凭证记录ID定位',()=>{
  const archive=book('snapshot',{records:[{kind:'voucher',recordId:voucher.id,no:voucher.no,date:voucher.date,supplier:voucher.supplier,amount:100,summary:'合成'}]});
  expect(findVoucherArchive([archive],voucher)).toBe(archive);
  expect(findVoucherArchive([archive],{...voucher,id:'other-id'})).toBeUndefined();
 });
 it('没有记录ID的原件快照仅按同一凭证原文件ID兼容，排除文档文件',()=>{
  const record={kind:'voucher' as const,no:voucher.no,date:voucher.date,supplier:voucher.supplier,amount:100,summary:'合成',fileId:voucher.fileId};
  const archive=book('original',{records:[record]});
  expect(findVoucherArchive([archive],voucher)).toBe(archive);
  expect(findVoucherArchive([archive],{...voucher,fileId:'other-file'})).toBeUndefined();
  expect(findVoucherArchive([book('document-only',{records:[{...record,kind:'document'}]})],voucher)).toBeUndefined();
 });
 it('没有任何成员或原件元数据的旧档案按同期间数字范围唯一兼容',()=>{
  const archive=book('legacy',{startVoucherNo:'记-2',endVoucherNo:'记-30'});
  expect(findVoucherArchive([archive],voucher)).toBe(archive);
  expect(findVoucherArchive([archive],{...voucher,no:'记-100'})).toBeUndefined();
 });
 it('旧版范围重叠时不猜测；有精确ID的档案仍可定位',()=>{
  const archives=[book('legacy-one'),book('legacy-two')];
  expect(findVoucherArchive(archives,voucher)).toBeUndefined();
  const exact=book('exact',{voucherIds:[voucher.id]});
  expect(findVoucherArchive([...archives,exact],voucher)).toBe(exact);
 });
 it('只读查找不修改档案成员、原件快照或凭证',()=>{
  const archives=[book('exact',{voucherIds:[voucher.id]})];
  const before=JSON.stringify({archives,voucher});
  findVoucherArchive(archives,voucher);
  expect(JSON.stringify({archives,voucher})).toBe(before);
 });
});
