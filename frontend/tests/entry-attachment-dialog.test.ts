import {describe,it,expect} from 'vitest';
import {createSSRApp,defineComponent,h} from 'vue';
import {renderToString} from 'vue/server-renderer';
import VoucherAttachmentsDialog from '../src/components/VoucherAttachmentsDialog.vue';
import type {Voucher,SourceDocument} from '../src/types';

// 使用实际SFC模板，轻量表格适配器只展开行与列的slot，核对用户最终看到的分录内容。
const Dialog=defineComponent({props:['modelValue','title'],setup:(props,{slots})=>()=>props.modelValue?h('section',{'aria-label':props.title},[slots.default?.(),slots.footer?h('footer',slots.footer()):null]):null});
const Column=defineComponent({name:'ElTableColumn',setup:()=>()=>null});
const Table=defineComponent({props:['data'],setup:(props,{slots})=>()=>{
 const columns=slots.default?.().filter(node=>node.type===Column)||[];
 return h('table',{},[h('thead',{},h('tr',{},columns.map(col=>h('th',{},col.props?.label)))),h('tbody',{},(props.data||[]).map((row:unknown)=>h('tr',{},columns.map(col=>{
  const children=col.children as {default?:(value:unknown)=>unknown[]}|undefined;
  return h('td',{},children?.default?children.default({row}):String((row as Record<string,unknown>)[col.props?.prop]??''));
 }))))]);
}});
function data(){
 const voucher:Voucher={id:'v-dialog',no:'记-1',period:'2026-09',date:'2026-09-30',summary:'整张凭证摘要',supplier:'付款单位',amount:300,status:'matched',documentIds:['d-first','d-second'],entries:[{summary:'第一笔摘要',account:'1002 银行_3325',debit:'100.00',credit:'0.00'},{summary:'第二笔摘要',account:'1002 银行_7788',debit:'200.00',credit:'0.00'}],entryAttachments:[{entryIndex:0,documentId:'d-first',side:'debit',ruleId:'R09'},{entryIndex:1,documentId:'d-second',side:'debit',ruleId:'R09'}]};
 const documents:SourceDocument[]=['first','second','unrelated'].map((name,index)=>({id:`d-${name}`,name:`${name}-receipt.pdf`,supplier:'付款单位',type:'bank',amount:index===0?100:200,date:'2026-10-01',number:name,seal:false,status:'matched'}));
 return {voucher,documents};
}
async function render(voucher:Voucher,documents:SourceDocument[]){
 const app=createSSRApp({render:()=>h(VoucherAttachmentsDialog,{modelValue:true,voucher,documents})});
 app.component('ElDialog',Dialog);app.component('ElTable',Table);app.component('ElTableColumn',Column);
 for(const name of ['ElAlert','ElForm','ElFormItem','ElSelect','ElOption','ElInput'])app.component(name,Column);
 return renderToString(app);
}
describe('凭证附件弹窗的可见内容',()=>{
 it('只展示摘要、科目、借方、贷方及附件单据五列',async()=>{
  const {voucher,documents}=data(),html=await render(voucher,documents);
  expect([...html.matchAll(/<th>(.*?)<\/th>/g)].map(match=>match[1])).toEqual(['摘要','科目','借方','贷方','附件单据']);expect(html.slice(html.indexOf('<table'))).not.toContain('整张凭证摘要');expect(html).not.toContain('unrelated-receipt');
 });
 it('每条摘要只显示它自己绑定的附件，不能把整张凭证附件重复到每行',async()=>{
  const {voucher,documents}=data(),html=await render(voucher,documents),rows=html.split('<tr>');
  const first=rows.find(row=>row.includes('第一笔摘要'))!,second=rows.find(row=>row.includes('第二笔摘要'))!;
  expect(first).toContain('first-receipt.pdf');expect(first).not.toContain('second-receipt.pdf');expect(second).toContain('second-receipt.pdf');expect(second).not.toContain('first-receipt.pdf');
 });
 it('旧版凭证级已关联原件直接展示，但不冒充分录附件或分摊金额',async()=>{
  const {voucher,documents}=data();delete voucher.entryAttachments;
  const html=await render(voucher,documents),rows=html.split('<tr>'),first=rows.find(row=>row.includes('第一笔摘要'))!,second=rows.find(row=>row.includes('第二笔摘要'))!;
  expect(first).toContain('first-receipt.pdf');expect(first).toContain('second-receipt.pdf');expect(first).toContain('整凭证关联 · 未分配分录');expect(second).not.toContain('first-receipt.pdf');expect(html).toContain('分录金额待复核');
 });
 it('企业名称归集原件直接展示在附件栏，但不伪造成已确认金额关系',async()=>{
  const {voucher,documents}=data();voucher.status='pending';voucher.documentIds=[];voucher.entryAttachments=[];voucher.nameAssociationIds=['name:synthetic'];documents[0]!.nameAssociationIds=['name:synthetic'];
  const html=await render(voucher,documents);expect(html).toContain('first-receipt.pdf');expect(html).toContain('企业名称归集 · 未确认金额关系');expect(html).toContain('分录金额待复核');expect(voucher.documentIds).toEqual([]);expect(voucher.entryAttachments).toEqual([]);
 });
 it('唯一金额、账号和日期候选直接显示在对应分录附件栏',async()=>{
  const {voucher,documents}=data();voucher.status='pending';voucher.documentIds=[];voucher.entryAttachments=[];voucher.amount=100;voucher.entries[0]!.account='1002 银行_尾号3325';voucher.entries=[voucher.entries![0]!,{summary:'对方科目',account:'2202 应付账款',debit:'0.00',credit:'100.00'}];
  documents.splice(0,documents.length,{id:'d-first',name:'first-receipt.pdf',supplier:'付款单位',type:'bank',amount:100,date:'2026-10-01',number:'BANK-ONLY',seal:false,status:'pending',payeeAccount:'3325'});
  const html=await render(voucher,documents);expect(html).toContain('first-receipt.pdf');expect(html).toContain('唯一金额候选 · 金额、账号及日期一致');expect(html).toContain('调整关联 / 分摊');expect(voucher.documentIds).toEqual([]);expect(voucher.status).toBe('pending');
 });
 it('同额歧义候选不冒充已确定附件，仍保留人工复核',async()=>{
  const {voucher,documents}=data();voucher.status='pending';voucher.documentIds=[];voucher.entryAttachments=[];voucher.amount=100;voucher.entries[0]!.account='1002 银行_尾号3325';voucher.entries=[voucher.entries![0]!,{summary:'对方科目',account:'2202 应付账款',debit:'0.00',credit:'100.00'}];
  documents.splice(0,documents.length,...['a','b'].map(id=>({id:`d-${id}`,name:`${id}-receipt.pdf`,supplier:'付款单位',type:'bank' as const,amount:100,date:'2026-10-01',number:id,seal:false,status:'pending' as const,payeeAccount:'3325'})));
  const html=await render(voucher,documents);expect(html).not.toContain('唯一金额候选');expect(html).not.toContain('a-receipt.pdf');expect(html).toContain('未关联 · 请复核');expect(html).toContain('人工复核 / 分摊');
 });
 it('主弹窗去掉独立无附件按钮，合并复核时从底部保存进入二次确认',async()=>{
  const {voucher,documents}=data();voucher.documentIds=[];voucher.entryAttachments=[];voucher.status='pending';
  const html=await render(voucher,documents);expect(html).toContain('>取消</button>');expect(html).not.toContain('>无外部附件</button>');expect(html).not.toContain('>确认</button>');
  const app=createSSRApp({render:()=>h(VoucherAttachmentsDialog,{modelValue:true,voucher,documents,reviewFields:true})});
  app.component('ElDialog',Dialog);app.component('ElTable',Table);app.component('ElTableColumn',Column);
  for(const name of ['ElAlert','ElForm','ElFormItem','ElSelect','ElOption','ElInput'])app.component(name,Column);
  app.component('VoucherReviewFields',defineComponent({setup:()=>()=>h('div','凭证字段表单')}));
  const combined=await renderToString(app);expect(combined).toContain('<footer>');expect(combined.slice(combined.indexOf('<footer>'))).toContain('保存并复核字段');
 });
});
