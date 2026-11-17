import {describe,expect,it,vi} from 'vitest';
import {createSSRApp,defineComponent,h} from 'vue';
import {renderToString} from 'vue/server-renderer';

vi.mock('../src/components/FlipBook.vue',()=>({default:{render:()=>null}}));

import MatchedArchivePanel from '../src/components/MatchedArchivePanel.vue';
import type {ArchiveBook,PayerGroup,SourceDocument,Voucher} from '../src/types';

const Column=defineComponent({name:'ElTableColumn',setup:()=>()=>null});
const Table=defineComponent({props:['data'],setup:(props,{slots})=>()=>{
 const columns=slots.default?.().filter(node=>node.type===Column)||[];
 return h('table',{},[h('tbody',{},(props.data||[]).map((row:unknown)=>h('tr',{},columns.map(column=>{
  const children=column.children as {default?:(value:unknown)=>unknown[]}|undefined;
  return h('td',{},children?.default?children.default({row}):String((row as Record<string,unknown>)[column.props?.prop]??''));
 }))))]);
}});
const Empty=defineComponent({setup:()=>()=>null});

async function render(groups:PayerGroup[],vouchers:Voucher[],documents:SourceDocument[],archives:ArchiveBook[]=[],focusGroupId?:string){
 const app=createSSRApp({render:()=>h(MatchedArchivePanel,{groups,vouchers,documents,archives,focusGroupId})});
 app.component('ElTable',Table);app.component('ElTableColumn',Column);
 for(const name of ['ElPagination','ElSelect','ElOption','FlipBook','FeatureIcon'])app.component(name,Empty);
 return renderToString(app);
}

function fixture(){
 const company='山西炜恒新材料科技有限公司';
 const voucher:Voucher={id:'v-23',no:'记-23',period:'2026-06',date:'2026-06-30',summary:'合成部分付款',supplier:company,amount:100,status:'matched',matchReviewRequired:false,reviewStatus:'reviewed',documentIds:['d-23'],entries:[{summary:'支付材料款',account:'1002 银行存款',debit:'0.00',credit:'100.00'}],entryAttachments:[{entryIndex:0,documentId:'d-23',side:'credit',ruleId:'MANUAL',reason:'合成记-23人工复核',allocatedAmount:'100.00',relationType:'settlement'}]};
 const receipt:SourceDocument={id:'d-23',name:'记-23-部分分摊回单.pdf',type:'bank',supplier:'合成付款方',payerName:'合成付款方',payeeName:company,amount:150,date:'2026-06-30',number:'SYNTHETIC-23',seal:false,status:'pending',matchReviewRequired:true,extractionStatus:'reviewed',allocatedAmount:'100.00',remainingAmount:'50.00'};
 const group:PayerGroup={id:'payer:synthetic-23',period:'2026-06',payerName:company,documentIds:[receipt.id],voucherIds:[voucher.id],updatedAt:'2026-11-08'};
 return {voucher,receipt,group};
}

function mixedFixture(){
 const {voucher,receipt,group}=fixture();
 const nameId='name:synthetic-company';
 const named:Voucher={...voucher,id:'name-voucher',no:'记-24',status:'pending',documentIds:[],entryAttachments:[],nameAssociationIds:[nameId]};
 const shared:SourceDocument={...receipt,nameAssociationIds:[nameId]};
 const invoice:SourceDocument={...receipt,id:'name-document',name:'合成名称发票.pdf',type:'invoice',amount:200,number:'NAME-INV',nameAssociationIds:[nameId]};
 const nameGroup:PayerGroup={...group,id:nameId,associationType:'name',ruleId:'R08',voucherIds:[named.id],documentIds:[shared.id,invoice.id,shared.id]};
 return {voucher,named,shared,invoice,group,nameGroup};
}

describe('电子档案真实关系可见性',()=>{
 it('记-23使用部分分摊回单完成人工归档后，凭证及关联原件仍在公司分组直接可见',async()=>{
  const {voucher,receipt,group}=fixture();
  const html=await render([group],[voucher],[receipt]);
  expect(html).toContain('山西炜恒新材料科技有限公司');
  expect(html).toContain('记-23');
  expect(html).toContain('记-23-部分分摊回单.pdf');
  expect(html).not.toContain('暂无已匹配归档数据');
 });
 it('人工确认无外部附件后，电子档案显示公司、凭证及正式归档入口',async()=>{
  const {voucher,group}=fixture();
  const exempt:Voucher={...voucher,id:'v-exempt',no:'记-24',summary:'内部结转',documentIds:[],entryAttachments:[],noAttachmentRequired:true,attachmentExemptionReason:'合成内部结转无需外部单据',ruleId:'MANUAL'};
  const exemptGroup:PayerGroup={...group,id:'payer:synthetic-exempt',documentIds:[],voucherIds:[exempt.id]};
  const html=await render([exemptGroup],[exempt],[]);
  expect(html).toContain('山西炜恒新材料科技有限公司');
  expect(html).toContain('记-24');
  expect(html).toContain('0 份单据 · 1 张凭证');
  expect(html).toContain('生成正式档案册');
  expect(html).not.toContain('暂无已匹配归档数据');
 });
 it('已有正式档案的凭证显示查看档案册，不再出现生成入口',async()=>{
  const {voucher,receipt,group}=fixture();
  const archive:ArchiveBook={id:'book-synthetic',title:'合成已归档凭证',period:voucher.period,startVoucherNo:voucher.no,endVoucherNo:voucher.no,voucherCount:1,pageCount:2,amount:voucher.amount,createdAt:'2026-11-12',status:'locked',voucherIds:[voucher.id]};
  const html=await render([group],[voucher],[receipt],[archive]);
  expect(html).toContain('查看档案册');
  expect(html).not.toMatch(/<button\b[^>]*>生成正式档案册<\/button>/);
 });
 it('同号但不属于档案固化成员的凭证保留生成入口',async()=>{
  const {voucher,receipt,group}=fixture();
  const archive:ArchiveBook={id:'book-other',title:'合成其他凭证档案',period:voucher.period,startVoucherNo:voucher.no,endVoucherNo:voucher.no,voucherCount:1,pageCount:2,amount:voucher.amount,createdAt:'2026-11-12',status:'locked',voucherIds:['different-voucher-id']};
  const html=await render([group],[voucher],[receipt],[archive]);
  expect(html).toMatch(/<button\b[^>]*>生成正式档案册<\/button>/);
  expect(html).not.toContain('查看档案册');
 });
 it('同公司同期间名称组与凭证组只显示一个入口，成员去重且不改变名称凭证状态',async()=>{
  const data=mixedFixture();
  const groups=[data.nameGroup,data.group],vouchers=[data.voucher,data.named],documents=[data.shared,data.invoice];
  const before=JSON.stringify({groups,vouchers,documents});
  const html=await render(groups,vouchers,documents);
  expect((html.match(/class="payer-group(?: selected)?"/g)||[])).toHaveLength(1);
  expect(html).toContain('2 份单据 · 2 张凭证');
  expect(html).toContain('企业名称关联＋凭证关联');
  expect((html.match(/role="listitem"/g)||[])).toHaveLength(2);
  expect(html).toContain('R08 · 名称关联');
  expect(html).toContain('分录关联');
  expect((html.match(/<button\b[^>]*>生成正式档案册<\/button>/g)||[])).toHaveLength(2);
  const totals=html.match(/<div class="type-totals"[\s\S]*?<\/div><\/div>/)?.[0]||'';
  expect(totals).toContain('银行回单');expect(totals).toContain('150.00');
  expect(totals).toContain('200.00');expect(totals).not.toContain('300.00');
  expect(JSON.stringify({groups,vouchers,documents})).toBe(before);
  expect(data.named.status).toBe('pending');
 });
 it('名称关联且待核对字段的凭证保留生成入口，不冒充完成附件匹配',async()=>{
  const data=mixedFixture();data.named.reviewStatus='pending';
  const before=JSON.stringify(data.named);
  const html=await render([data.nameGroup],[data.named],[data.shared,data.invoice]);
  expect(html).toContain('R08 · 名称关联');
  expect(html).toContain('核对字段');
  expect(html).toMatch(/<button\b[^>]*>生成正式档案册<\/button>/);
  expect(html).not.toContain('查看档案册');
  expect(JSON.stringify(data.named)).toBe(before);
 });
 it('部分附件关联仍保留正式生成入口，交由生成流程校验完整性',async()=>{
  const {voucher,receipt,group}=fixture();voucher.status='pending';voucher.attachmentReviewRequired=true;
  const html=await render([group],[voucher],[receipt]);
  expect(html).toContain('部分关联 · 请复核');
  expect(html).toMatch(/<button\b[^>]*>生成正式档案册<\/button>/);
  expect(voucher.status).toBe('pending');
  expect(voucher.documentIds).toEqual([receipt.id]);
 });
 it('仅单据名称组继续展示全部原件，不生成虚构凭证',async()=>{
  const data=mixedFixture();
  const group:PayerGroup={...data.nameGroup,voucherIds:[]};
  const html=await render([group],[],[data.shared,data.invoice]);
  expect(html).toContain('2 份单据 · 0 张凭证');
  expect(html).toContain(data.shared.name);expect(html).toContain(data.invoice.name);
  expect(html).not.toContain('role="listitem"');
  expect(html).not.toMatch(/<button\b[^>]*>生成正式档案册<\/button>/);
 });
 it('从合并前的凭证来源分组定位时，仍打开合并后的对应公司',async()=>{
  const data=mixedFixture();
  const otherDoc:SourceDocument={...data.shared,id:'other-document',name:'其他企业回单.pdf',nameAssociationIds:[]};
  const otherVoucher:Voucher={...data.voucher,id:'other-voucher',no:'记-25',documentIds:[otherDoc.id],entryAttachments:[{...data.voucher.entryAttachments![0]!,documentId:otherDoc.id}]};
  const otherGroup:PayerGroup={...data.group,id:'other-group',payerName:'另一家科技有限公司',documentIds:[otherDoc.id],voucherIds:[otherVoucher.id]};
  const html=await render([otherGroup,data.nameGroup,data.group],[otherVoucher,data.voucher,data.named],[otherDoc,data.shared,data.invoice],[],data.group.id);
  expect((html.match(/class="payer-group(?: selected)?"/g)||[])).toHaveLength(2);
  const heading=html.match(/<header class="payer-draft-heading"[\s\S]*?<\/header>/)?.[0]||'';
  expect(heading).toContain(data.group.payerName);
  expect(heading).not.toContain(otherGroup.payerName);
  expect(heading).toContain('2 份单据 · 2 张凭证');
 });
});
