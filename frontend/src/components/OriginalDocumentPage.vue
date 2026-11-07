<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import type {PDFPageProxy,RenderTask} from 'pdfjs-dist';
import type {OriginalPreviewPage} from '../originalPreview';
import {ZoomIn} from 'lucide-vue-next';

const props=withDefaults(defineProps<{page:OriginalPreviewPage;active?:boolean;zoomable?:boolean}>(),{active:true,zoomable:false});
const emit=defineEmits<{zoom:[page:OriginalPreviewPage]}>();
const viewport=ref<HTMLElement>();const canvas=ref<HTMLCanvasElement>();
const loading=ref(false),renderError=ref(''),rendered=ref(false);
const error=computed(()=>props.page.error||renderError.value);
let generation=0;let renderTask:RenderTask|undefined;let observer:ResizeObserver|undefined;
let frame=0;let lastRenderWidth=0;
let renderedPage:PDFPageProxy|undefined;
function cancel():Promise<void>{
 generation++;
 const previous=renderTask;
 previous?.cancel();
 // PDF.js 取消后仍需等待 promise 结束，才能把同一 canvas 交给下一次 render。
 return (previous?.promise.catch(()=>undefined)||Promise.resolve()).then(()=>{if(renderTask===previous)renderTask=undefined;});
}
function releaseCanvas(){if(canvas.value){canvas.value.width=1;canvas.value.height=1;}lastRenderWidth=0;renderedPage?.cleanup();renderedPage=undefined;}
async function render(){
 const previous=cancel();const token=generation;
 await previous;if(token!==generation)return;
 renderError.value='';rendered.value=false;
 if(!props.active){loading.value=false;releaseCanvas();return;}
 const source=props.page.source;
 if(!source||source.kind!=='pdf'||props.page.error){loading.value=false;return;}
 loading.value=true;
 try{
  await nextTick();
  const element=canvas.value;if(!element)return;
  const page=await source.pdf.getPage(props.page.pageNumber);
  if(token!==generation||!props.active)return;
  renderedPage=page;
  const base=page.getViewport({scale:1});
  const bounds=viewport.value?.getBoundingClientRect();
  // 使用容器中原件实际占用的宽度计算清晰度，横版回单完整等比显示，不拉伸或裁切。
  const fitWidth=Math.min(bounds?.width||340,(bounds?.height||455)*base.width/base.height);
  // 每页最多约300万像素，跨页与邻页合计仍保持有界；需要细看时使用独立放大窗口。
  const targetWidth=Math.min(2000,Math.max(900,fitWidth*Math.min(window.devicePixelRatio||1,2)),Math.sqrt(3000000*base.width/base.height));
  const renderViewport=page.getViewport({scale:targetWidth/base.width});
  const context=element.getContext('2d');if(!context)throw new Error('当前浏览器不支持原件画面预览。');
  element.width=Math.ceil(renderViewport.width);element.height=Math.ceil(renderViewport.height);
  lastRenderWidth=fitWidth;
  const task=page.render({canvasContext:context,viewport:renderViewport,background:'rgb(255,255,255)'});
  renderTask=task;await task.promise;
  if(token===generation){renderTask=undefined;rendered.value=true;}
 }catch(error){
  if(token!==generation)return;
  renderError.value=error instanceof Error&&error.name==='RenderingCancelledException'?'':'原件页面无法显示，请检查文件后重新打开。';
 }finally{if(token===generation)loading.value=false;}
}
watch(()=>[props.page,props.active] as const,()=>void render(),{flush:'post'});
onMounted(()=>{
 void render();
 observer=new ResizeObserver(()=>{
  if(!props.active||loading.value||props.page.source?.kind!=='pdf')return;
  const width=viewport.value?.getBoundingClientRect().width||0;
  if(width<=0||Math.abs(width-lastRenderWidth)<100)return;
  cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>void render());
 });
 if(viewport.value)observer.observe(viewport.value);
});
onBeforeUnmount(()=>{const element=canvas.value;void cancel().then(()=>{if(element){element.width=1;element.height=1;}renderedPage?.cleanup();renderedPage=undefined;});observer?.disconnect();cancelAnimationFrame(frame);});
</script>

<template>
 <div ref="viewport" class="original-document-page" :data-file-id="page.record.fileId" :data-source-page="page.pageNumber" :data-rendered="rendered&&!loading&&!error&&active" :aria-label="page.label">
  <div v-if="error" class="original-unavailable"><strong>原件暂不可预览</strong><span>{{page.record.fileName||page.record.no}}</span><p>{{error}}</p></div>
  <template v-else-if="page.source?.kind==='pdf'"><canvas ref="canvas" class="original-document-canvas" role="img" :aria-label="page.label"/><span v-if="loading&&active" class="original-loading">正在加载原件…</span></template>
  <img v-else-if="page.source?.kind==='image'&&active" class="original-document-image" :src="page.source.url" :alt="page.label" draggable="false" @load="rendered=true" @error="renderError='图片无法显示，请检查原件后重新上传。'"/>
  <button v-if="zoomable&&active&&page.source&&!error" class="original-zoom-button" type="button" :aria-label="'放大原件：'+page.label" title="单独放大本页" @pointerdown.stop @mousedown.stop @touchstart.stop @mousemove.stop @touchmove.stop @click.stop.prevent="emit('zoom',page)"><ZoomIn :size="16"/><span>放大</span></button>
 </div>
</template>

<style scoped>
.original-document-page{position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;overflow:hidden;background:#fff;isolation:isolate}.original-document-canvas,.original-document-image{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none;user-select:none}.original-unavailable{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;max-width:85%;padding:24px;text-align:center;color:#7c8ca3;font-size:13px;line-height:1.8;overflow-wrap:anywhere}.original-unavailable strong{font-size:15px;color:#526c8f}.original-unavailable span{font-size:12px}.original-unavailable p{margin:0}.original-loading{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:9px 13px;background:#ffffffed;border-radius:6px;color:#6c82a0;font-size:13px;white-space:nowrap}
.original-zoom-button{position:absolute;top:16px;right:16px;z-index:5;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:0 12px;border:1px solid #c8daf4;border-radius:7px;background:#fffffff2;box-shadow:0 2px 9px #294f7912;color:#245fba;font-size:13px;font-weight:600;cursor:pointer;touch-action:manipulation}.original-zoom-button:hover{border-color:#74a7ed;background:#edf5ff}.original-zoom-button:focus-visible{outline:3px solid #92b8f0;outline-offset:2px}.original-zoom-button>*{pointer-events:none}@media(max-width:600px){.original-zoom-button{top:10px;right:10px;min-height:38px;padding:0 10px}}
</style>
