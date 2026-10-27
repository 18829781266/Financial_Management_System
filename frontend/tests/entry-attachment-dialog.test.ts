import {describe,it,expect} from 'vitest';
import {createSSRApp,defineComponent,h} from 'vue';
import {renderToString} from 'vue/server-renderer';
import VoucherAttachmentsDialog from '../src/components/VoucherAttachmentsDialog.vue';
import type {Voucher,SourceDocument} from '../src/types';

// 使用实际SFC模板，轻量表格适配器只展开行与列的slot，核对用户最终看到的分录内容。
const Dialog=defineComponent({props:['modelValue','title'],setup:(props,{slots})=>()=>props.modelValue?h('section',{'aria-label':props.title},slots.default?.()):null});
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
  expect([...html.matchAll(/<th>(.*?)<\/th>/g)].map(match=>match[1])).toEqual(['摘要','科目','借方','贷方','附件单据']);expect(html).not.toContain('整张凭证摘要');expect(html).not.toContain('unrelated-receipt');
 });
 it('每条摘要只显示它自己绑定的附件，不能把整张凭证附件重复到每行',async()=>{
  const {voucher,documents}=data(),html=await render(voucher,documents),rows=html.split('<tr>');
  const first=rows.find(row=>row.includes('第一笔摘要'))!,second=rows.find(row=>row.includes('第二笔摘要'))!;
  expect(first).toContain('first-receipt.pdf');expect(first).not.toContain('second-receipt.pdf');expect(second).toContain('second-receipt.pdf');expect(second).not.toContain('first-receipt.pdf');
 });
 it('旧版只有凭证级关系时不冒充分录附件，显示待复核',async()=>{
  const {voucher,documents}=data();delete voucher.entryAttachments;
  const html=await render(voucher,documents);expect(html).not.toContain('first-receipt.pdf');expect(html).toContain('未关联 · 请复核');
 });
});
