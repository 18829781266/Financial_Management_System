<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue';
import {Expand,Maximize2,Minimize2,Move,ZoomIn,ZoomOut} from 'lucide-vue-next';
import type {RenderTask} from 'pdfjs-dist';
import type {OriginalPreviewPage} from '../originalPreview';

const props=defineProps<{modelValue:boolean;page?:OriginalPreviewPage}>();
const emit=defineEmits<{'update:modelValue':[boolean]}>();
const viewport=ref<HTMLElement>(),canvas=ref<HTMLCanvasElement>();
const zoom=ref(100),fullscreen=ref(false),loading=ref(false),error=ref(''),ready=ref(false),dragging=ref(false);
const baseWidth=ref(595),baseHeight=ref(842);
const source=computed(()=>props.page?.source);
const fileName=computed(()=>props.page?.record.fileName||props.page?.record.summary||props.page?.record.no||'原始单据');
const sheetStyle=computed(()=>({width:`${baseWidth.value*zoom.value/100}px`,height:`${baseHeight.value*zoom.value/100}px`}));
let fitMode=true,disposed=false,loadGeneration=0,renderGeneration=0,renderFrame=0;
let renderTask:RenderTask|undefined,observer:ResizeObserver|undefined;
let drag:{id:number;x:number;y:number;left:number;top:number}|undefined;
const clamp=(value:number)=>Math.max(5,Math.min(400,Math.round(value)));

/** 共享父翻页中的PDF文档，仅取消本弹窗自己的绘制，不能销毁父级PDF或图片URL。 */
function cancelRender():Promise<void>{
 renderGeneration++;
 const pending=renderTask;pending?.cancel();
 return (pending?.promise.catch(()=>undefined)||Promise.resolve()).then(()=>{if(renderTask===pending)renderTask=undefined;});
}
async function renderPdf(){
 const pending=cancelRender(),token=renderGeneration;
 await pending;
 if(disposed||token!==renderGeneration||!props.modelValue||!ready.value)return;
 const original=props.page,originalSource=original?.source;
 if(!original||originalSource?.kind!=='pdf')return;
 loading.value=true;error.value='';
 try{
  await nextTick();const element=canvas.value;if(!element)return;
  const page=await originalSource.pdf.getPage(original.pageNumber);
  if(disposed||token!==renderGeneration||!props.modelValue)return;
  const base=page.getViewport({scale:1});
  // 缩放后重新从原始PDF绘制，避免仅拉伸原有小画布。限制最大像素防止大票据耗尽内存。
  const density=Math.min(window.devicePixelRatio||1,2);
  const desiredWidth=Math.max(1200,base.width*zoom.value/100*density);
  const targetWidth=Math.min(desiredWidth,5000,Math.sqrt(20000000*base.width/base.height));
  const renderViewport=page.getViewport({scale:targetWidth/base.width});
  const context=element.getContext('2d');if(!context)throw new Error('当前浏览器不支持原件放大预览。');
  element.width=Math.ceil(renderViewport.width);element.height=Math.ceil(renderViewport.height);
  const task=page.render({canvasContext:context,viewport:renderViewport,background:'rgb(255,255,255)'});
  renderTask=task;await task.promise;
  if(token===renderGeneration)renderTask=undefined;
 }catch(reason){
  if(token===renderGeneration&&!disposed)error.value=reason instanceof Error&&reason.name==='RenderingCancelledException'?'':'此页原件无法显示，请关闭后重新打开。';
 }finally{if(token===renderGeneration)loading.value=false;}
}
function queueRender(){cancelAnimationFrame(renderFrame);renderFrame=requestAnimationFrame(()=>void renderPdf());}
async function fitPage(){
 fitMode=true;await nextTick();const area=viewport.value;if(!area||!ready.value)return;
 zoom.value=clamp(Math.min(Math.max(1,area.clientWidth-48)/baseWidth.value,Math.max(1,area.clientHeight-48)/baseHeight.value)*100);
 await nextTick();area.scrollLeft=0;area.scrollTop=0;queueRender();
}
async function setZoom(value:number){
 if(!ready.value)return;
 fitMode=false;const area=viewport.value,previous=zoom.value,next=clamp(value);
 const centerX=area?(area.scrollLeft+area.clientWidth/2)/previous:0,centerY=area?(area.scrollTop+area.clientHeight/2)/previous:0;
 zoom.value=next;await nextTick();
 if(area){area.scrollLeft=Math.max(0,centerX*next-area.clientWidth/2);area.scrollTop=Math.max(0,centerY*next-area.clientHeight/2);}
 queueRender();
}
async function prepare(){
 const request=++loadGeneration;ready.value=false;error.value='';loading.value=props.modelValue;
 await cancelRender();
 if(!props.modelValue||disposed){loading.value=false;return;}
 const original=props.page,originalSource=original?.source;
 if(!original||original.error||!originalSource){error.value=original?.error||'未找到可预览的原始单据。';loading.value=false;return;}
 try{
  if(originalSource.kind==='pdf'){
   const page=await originalSource.pdf.getPage(original.pageNumber);const size=page.getViewport({scale:1});
   if(request!==loadGeneration||disposed||!props.modelValue)return;
   baseWidth.value=size.width;baseHeight.value=size.height;
  }else{
   const image=new Image();
   await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('图片原件无法显示，请检查文件后重新打开。'));image.src=originalSource.url;});
   if(request!==loadGeneration||disposed||!props.modelValue)return;
   baseWidth.value=image.naturalWidth;baseHeight.value=image.naturalHeight;
  }
  ready.value=true;loading.value=false;await fitPage();
 }catch(reason){if(request===loadGeneration&&!disposed){loading.value=false;error.value=reason instanceof Error?reason.message:'读取原件失败，请重新打开。';}}
}
async function opened(){
 await nextTick();observer?.disconnect();observer=new ResizeObserver(()=>{if(props.modelValue&&ready.value&&fitMode)void fitPage();});
 if(viewport.value)observer.observe(viewport.value);
 if(ready.value&&fitMode)await fitPage();
}
function close(){emit('update:modelValue',false);}
function release(){
 loadGeneration++;cancelAnimationFrame(renderFrame);observer?.disconnect();drag=undefined;dragging.value=false;
 const element=canvas.value;void cancelRender().then(()=>{if(!props.modelValue&&element){element.width=1;element.height=1;}});
}
function startDrag(event:PointerEvent){
 if(event.button!==0||event.pointerType==='touch'||!viewport.value||!ready.value)return;
 const area=viewport.value;drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:area.scrollLeft,top:area.scrollTop};dragging.value=true;area.setPointerCapture(event.pointerId);event.preventDefault();
}
function moveDrag(event:PointerEvent){if(!drag||drag.id!==event.pointerId||!viewport.value)return;viewport.value.scrollLeft=drag.left+drag.x-event.clientX;viewport.value.scrollTop=drag.top+drag.y-event.clientY;}
function endDrag(event:PointerEvent){if(drag?.id!==event.pointerId)return;if(viewport.value?.hasPointerCapture(event.pointerId))viewport.value.releasePointerCapture(event.pointerId);drag=undefined;dragging.value=false;}
function wheel(event:WheelEvent){if(!event.ctrlKey)return;event.preventDefault();void setZoom(zoom.value+(event.deltaY<0?10:-10));}
watch(()=>[props.modelValue,props.page] as const,()=>{if(props.modelValue){fullscreen.value=false;fitMode=true;void prepare();}else release();},{immediate:true});
onBeforeUnmount(()=>{disposed=true;release();const element=canvas.value;void cancelRender().then(()=>{if(element){element.width=1;element.height=1;}});});
</script>

<template>
 <el-dialog :model-value="modelValue" class="original-page-zoom-dialog" width="min(1200px, 96vw)" top="3vh" :fullscreen="fullscreen" append-to-body destroy-on-close :close-on-click-modal="false" @close="close" @opened="opened" @closed="release">
  <template #header="{titleId}"><div class="zoom-heading"><strong :id="titleId">原始单据 · 单页放大</strong><span :title="fileName">{{fileName}}</span><small v-if="page">原件第 {{page.pageNumber}} / {{page.pageCount}} 页</small></div></template>
  <div class="zoom-toolbar" role="toolbar" aria-label="原件缩放工具">
   <div class="zoom-controls"><button class="btn" aria-label="缩小原件" title="缩小" :disabled="!ready||zoom<=5" @click="setZoom(zoom-25)"><ZoomOut :size="17"/></button><span class="zoom-percent" aria-live="polite">{{zoom}}%</span><button class="btn" aria-label="放大原件" title="放大" :disabled="!ready||zoom>=400" @click="setZoom(zoom+25)"><ZoomIn :size="17"/></button></div>
   <button class="btn" :disabled="!ready" @click="fitPage"><Expand :size="16"/>适合窗口</button><button class="btn" aria-label="原始大小" title="原始大小" :disabled="!ready" @click="setZoom(100)">100%</button>
   <button class="btn zoom-fullscreen" :aria-label="fullscreen?'退出全屏':'全屏查看'" @click="fullscreen=!fullscreen"><Minimize2 v-if="fullscreen" :size="16"/><Maximize2 v-else :size="16"/>{{fullscreen?'退出全屏':'全屏'}}</button>
  </div>
  <div ref="viewport" :class="['zoom-scroll',{dragging}]" :aria-busy="loading" tabindex="0" aria-label="单页原件画面，可滚动或拖动查看" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @wheel="wheel">
   <div v-if="error" class="zoom-error" role="status">{{error}}</div>
   <div v-else class="zoom-surface"><div v-if="ready" class="zoom-sheet" :style="sheetStyle" :data-source-page="page?.pageNumber" :data-file-id="page?.record.fileId"><canvas v-if="source?.kind==='pdf'" ref="canvas" class="zoom-canvas" role="img" :aria-label="page?.label"/><img v-else-if="source?.kind==='image'" class="zoom-image" :src="source.url" :alt="page?.label" draggable="false"/></div></div>
   <div v-if="loading" class="zoom-loading" role="status">正在加载此页原件…</div>
  </div>
  <div class="zoom-hint"><Move :size="14"/>放大后可拖动画面或使用滚动条查看，手机可滑动查看。</div>
  <template #footer><button class="btn" aria-label="关闭" @click="close">关闭</button></template>
 </el-dialog>
</template>

<style>
.original-page-zoom-dialog{--el-dialog-padding-primary:20px;display:flex;flex-direction:column;max-height:94vh;border-radius:14px;overflow:hidden}.original-page-zoom-dialog.is-fullscreen{max-height:100dvh;border-radius:0}.original-page-zoom-dialog .el-dialog__header{margin:0;padding-right:30px;padding-bottom:16px}.original-page-zoom-dialog .el-dialog__body{display:flex;flex-direction:column;min-height:0;padding:0;overflow:hidden}.zoom-heading{display:flex;align-items:center;gap:12px;flex-wrap:wrap;line-height:1.7}.zoom-heading strong{color:#284a77;font-size:17px}.zoom-heading>span{font-size:13px;color:#69809f;max-width:min(55vw,650px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.zoom-heading small{font-size:12px;color:#7c90aa;white-space:nowrap}.zoom-toolbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:11px 0 14px;flex:none;border-top:1px solid #edf1f7}.zoom-toolbar .btn{min-height:35px;padding:7px 11px;gap:6px;font-size:13px}.zoom-controls{display:flex;align-items:center;gap:5px}.zoom-controls .btn{padding:7px 9px}.zoom-percent{min-width:57px;text-align:center;font-variant-numeric:tabular-nums;color:#2f5687;font-size:14px;font-weight:650}.zoom-fullscreen{margin-left:auto}.zoom-scroll{position:relative;height:calc(90vh - 180px);min-height:230px;overflow:auto;border:1px solid #dee7f2;border-radius:9px;background:#edf2f8;cursor:grab;overscroll-behavior:contain;touch-action:pan-x pan-y;scrollbar-gutter:stable}.is-fullscreen .zoom-scroll{height:calc(100dvh - 180px)}.zoom-scroll.dragging{cursor:grabbing}.zoom-surface{display:flex;align-items:center;justify-content:center;width:max-content;min-width:100%;min-height:100%;padding:24px;box-sizing:border-box}.zoom-sheet{flex:none;background:#fff;box-shadow:0 4px 20px #30456420}.zoom-canvas,.zoom-image{display:block;width:100%;height:100%;object-fit:contain;user-select:none;pointer-events:none}.zoom-error{min-height:100%;display:flex;align-items:center;justify-content:center;padding:35px;color:#71849f;font-size:14px;line-height:1.8;text-align:center}.zoom-loading{position:sticky;left:50%;bottom:24px;width:max-content;max-width:90%;transform:translateX(-50%);padding:9px 15px;border:1px solid #e2e9f4;border-radius:7px;background:#fffffff2;color:#55759c;font-size:13px;pointer-events:none}.zoom-hint{display:flex;align-items:center;gap:7px;font-size:12px;line-height:1.8;color:#7f91aa;padding-top:11px}.original-page-zoom-dialog.is-fullscreen .el-dialog__body{flex:1}
@media(max-width:600px){.original-page-zoom-dialog{--el-dialog-padding-primary:13px;max-height:96dvh;margin-top:2vh!important;width:calc(100vw - 16px)!important}.original-page-zoom-dialog.is-fullscreen{width:100vw!important;margin-top:0!important;max-height:100dvh}.zoom-heading{gap:4px 10px}.zoom-heading strong{font-size:16px;width:100%}.zoom-heading>span{max-width:calc(100vw - 82px)}.zoom-toolbar{gap:7px;padding-top:9px;padding-bottom:10px}.zoom-toolbar .btn{font-size:12px;padding:7px 9px;min-height:34px}.zoom-controls{gap:1px}.zoom-percent{min-width:48px;font-size:13px}.zoom-scroll{height:calc(90dvh - 205px);min-height:200px}.is-fullscreen .zoom-scroll{height:calc(100dvh - 205px)}.zoom-surface{padding:16px}.zoom-hint{font-size:11px;align-items:flex-start}.zoom-fullscreen{margin-left:0}}
</style>
