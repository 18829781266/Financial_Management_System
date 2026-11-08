import {describe,expect,it,vi} from 'vitest';
import {createSSRApp,defineComponent,h} from 'vue';
import {renderToString} from 'vue/server-renderer';

vi.mock('../src/components/FlipBook.vue',()=>({default:{render:()=>null}}));

import MatchedArchivePanel from '../src/components/MatchedArchivePanel.vue';
import type {PayerGroup,SourceDocument,Voucher} from '../src/types';

const Column=defineComponent({name:'ElTableColumn',setup:()=>()=>null});
const Table=defineComponent({props:['data'],setup:(props,{slots})=>()=>{
 const columns=slots.default?.().filter(node=>node.type===Column)||[];
 return h('table',{},[h('tbody',{},(props.data||[]).map((row:unknown)=>h('tr',{},columns.map(column=>{
  const children=column.children as {default?:(value:unknown)=>unknown[]}|undefined;
  return h('td',{},children?.default?children.default({row}):String((row as Record<string,unknown>)[column.props?.prop]??''));
 }))))]);
}});
const Empty=defineComponent({setup:()=>()=>null});

async function render(groups:PayerGroup[],vouchers:Voucher[],documents:SourceDocument[]){
 const app=createSSRApp({render:()=>h(MatchedArchivePanel,{groups,vouchers,documents})});
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

describe('电子档案真实关系可见性',()=>{
 it('记-23使用部分分摊回单完成人工归档后，凭证及关联原件仍在公司分组直接可见',async()=>{
  const {voucher,receipt,group}=fixture();
  const html=await render([group],[voucher],[receipt]);
  expect(html).toContain('山西炜恒新材料科技有限公司');
  expect(html).toContain('记-23');
  expect(html).toContain('记-23-部分分摊回单.pdf');
  expect(html).not.toContain('暂无已匹配归档数据');
 });
});
