import {describe,expect,it} from 'vitest';
import {createSSRApp,defineComponent,h} from 'vue';
import {renderToString} from 'vue/server-renderer';
import WindowDialog from '../src/components/WindowDialog.vue';

// 与实际 Element Plus 一致展开标题、正文、页脚；交互由真实浏览器合成数据验收。
const Dialog=defineComponent({
 name:'ElDialog',props:{modelValue:Boolean,title:String,fullscreen:Boolean},
 setup:(props,{slots})=>()=>props.modelValue?h('section',{'data-fullscreen':String(props.fullscreen)},[
  slots.header?.({close:()=>{},titleId:'window-title',titleClass:'window-title'}),
  slots.default?.(),slots.footer?.(),
 ]):null,
});
const Tooltip=defineComponent({name:'ElTooltip',props:['content','disabled','placement'],setup:(_props,{slots})=>()=>slots.default?.()});
async function render(props:Record<string,unknown>={},customHeader=false){
 const app=createSSRApp({render:()=>h(WindowDialog,{modelValue:true,title:'凭证复核',...props},{
  default:()=>h('textarea',{value:'未保存的复核草稿'}),
  footer:()=>h('button',{class:'save-button'},'保存'),
  ...(customHeader?{header:({titleId}:{titleId:string})=>h('div',[h('strong',{id:titleId},'原始单据 · 单页放大'),h('span','合成回单.pdf')])}:{}),
 })});
 app.component('ElDialog',Dialog);app.component('ElTooltip',Tooltip);
 return renderToString(app);
}

describe('统一业务弹窗窗口操作',()=>{
 it('提供有辅助名称的缩小、放大、关闭按钮，正文和页脚插槽保持可用',async()=>{
  const html=await render();
  for(const label of ['缩小窗口','放大窗口','关闭窗口'])expect(html).toContain(`aria-label="${label}"`);
  expect(html).toContain('aria-label="窗口操作"');expect(html).toContain('未保存的复核草稿');expect(html).toContain('保存');
  expect(html).toContain('aria-expanded="true"');expect(html).toContain('aria-pressed="false"');
 });
 it('自定义原件标题与三个窗口按钮共存',async()=>{
  const html=await render({},true);
  expect(html).toContain('<strong id="window-title">原始单据 · 单页放大</strong>');expect(html).toContain('合成回单.pdf');expect(html).toContain('关闭窗口');
 });
 it('支持受控全屏状态和对应的还原操作名称',async()=>{
  const html=await render({fullscreen:true});
  expect(html).toContain('data-fullscreen="true"');expect(html).toContain('aria-label="还原窗口大小"');expect(html).toContain('aria-pressed="true"');
 });
 it('忙碌状态沿用show-close约束，三个窗口操作均不可用',async()=>{
  const html=await render({showClose:false});
  const controls=html.match(/<button[^>]+aria-label="(?:缩小窗口|放大窗口|关闭窗口)"[^>]*>/g)||[];
  expect(controls).toHaveLength(3);for(const control of controls)expect(control).toContain('disabled');
 });
});
