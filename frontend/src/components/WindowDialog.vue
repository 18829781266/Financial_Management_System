<script setup lang="ts">
import {computed,nextTick,ref,watch} from 'vue';
import {ChevronUp,Maximize2,Minimize2,Minus,X} from 'lucide-vue-next';

defineOptions({inheritAttrs:false});
const props=withDefaults(defineProps<{
 modelValue:boolean;
 title?:string;
 fullscreen?:boolean;
 showClose?:boolean;
 closeOnClickModal?:boolean;
 closeOnPressEscape?:boolean;
 lockScroll?:boolean;
}>(),{showClose:true,closeOnClickModal:true,closeOnPressEscape:true,lockScroll:true,fullscreen:undefined});
const emit=defineEmits<{
 'update:modelValue':[boolean];
 'update:fullscreen':[boolean];
 open:[];
 opened:[];
 close:[];
 closed:[];
}>();
const minimized=ref(false),internalFullscreen=ref(false);
const restoreButton=ref<HTMLButtonElement>(),fullscreenButton=ref<HTMLButtonElement>();
const expanded=computed({get:()=>props.fullscreen??internalFullscreen.value,set:value=>{internalFullscreen.value=value;emit('update:fullscreen',value);}});
watch(()=>props.modelValue,open=>{if(open){minimized.value=false;expanded.value=false;}});
async function toggleMinimized(){
 if(!props.showClose)return;
 minimized.value=!minimized.value;
 await nextTick();restoreButton.value?.focus();
}
async function toggleFullscreen(){
 if(!props.showClose)return;
 minimized.value=false;expanded.value=!expanded.value;
 await nextTick();fullscreenButton.value?.focus();
}
function closed(){minimized.value=false;expanded.value=false;emit('closed');}
</script>

<template>
 <el-dialog
  v-bind="$attrs"
  :model-value="modelValue"
  :title="title"
  :fullscreen="!minimized&&expanded"
  :show-close="false"
  :close-on-click-modal="!minimized&&closeOnClickModal"
  :close-on-press-escape="!minimized&&closeOnPressEscape"
  :lock-scroll="!minimized&&lockScroll"
  :class="['window-dialog',{'window-dialog--minimized':minimized}]"
  @update:model-value="emit('update:modelValue',$event)"
  @open="emit('open')"
  @opened="emit('opened')"
  @close="emit('close')"
  @closed="closed"
 >
  <template #header="{close,titleId,titleClass}">
   <div class="window-dialog__header-content">
    <div class="window-dialog__heading" :class="titleClass">
     <slot name="header" :close="close" :title-id="titleId" :title-class="titleClass"><span :id="titleId" class="el-dialog__title">{{title}}</span></slot>
    </div>
    <div class="window-dialog__controls" role="group" aria-label="窗口操作">
     <el-tooltip :content="minimized?'还原窗口':'缩小窗口'" :disabled="!showClose" placement="bottom">
      <button ref="restoreButton" type="button" class="window-dialog__control" :disabled="!showClose" :aria-label="minimized?'还原窗口':'缩小窗口'" :title="minimized?'还原窗口':'缩小窗口'" :aria-expanded="!minimized" @click.stop="toggleMinimized"><ChevronUp v-if="minimized" :size="18"/><Minus v-else :size="18"/></button>
     </el-tooltip>
     <el-tooltip :content="expanded&&!minimized?'还原窗口大小':'放大窗口'" :disabled="!showClose" placement="bottom">
      <button ref="fullscreenButton" type="button" class="window-dialog__control" :disabled="!showClose" :aria-label="expanded&&!minimized?'还原窗口大小':'放大窗口'" :title="expanded&&!minimized?'还原窗口大小':'放大窗口'" :aria-pressed="expanded&&!minimized" @click.stop="toggleFullscreen"><Minimize2 v-if="expanded&&!minimized" :size="17"/><Maximize2 v-else :size="17"/></button>
     </el-tooltip>
     <el-tooltip content="关闭窗口" :disabled="!showClose" placement="bottom">
      <button type="button" class="el-dialog__headerbtn window-dialog__close" :disabled="!showClose" aria-label="关闭窗口" title="关闭窗口" @click.stop="close"><X :size="19"/></button>
     </el-tooltip>
    </div>
   </div>
  </template>
  <slot/>
  <template v-if="$slots.footer" #footer><slot name="footer"/></template>
 </el-dialog>
</template>

<style>
.window-dialog__header-content{display:flex;align-items:flex-start;gap:14px;min-width:0;width:100%}
.window-dialog__heading{flex:1;min-width:0}
.window-dialog__controls{display:flex;align-items:center;gap:3px;flex:none;margin:-9px -10px 0 0}
.window-dialog__control,.window-dialog__controls .el-dialog__headerbtn{position:static;display:grid;place-items:center;flex:none;width:36px;height:36px;padding:0;border-radius:8px;color:var(--dialog-icon,#73869a);outline:2px solid transparent;outline-offset:2px;transition:background-color .18s,color .18s}
.window-dialog__control:focus-visible,.window-dialog__controls .el-dialog__headerbtn:focus-visible{outline-color:var(--dialog-focus,#4f83c4)}
.window-dialog__control:active,.window-dialog__controls .el-dialog__headerbtn:active{background:var(--dialog-active,#e3ecf6);color:var(--dialog-action-active,#214f86)}
.window-dialog__control:disabled,.window-dialog__controls .el-dialog__headerbtn:disabled{cursor:not-allowed;opacity:.45}
@media(hover:hover){.window-dialog__control:hover:not(:disabled),.window-dialog__controls .el-dialog__headerbtn:hover:not(:disabled){background:var(--dialog-hover,#edf3fa);color:var(--dialog-action,#285f9e)}}
.el-dialog:has(.window-dialog__controls) .el-dialog__header{padding-right:0}
.el-overlay .window-dialog.is-fullscreen{width:100vw!important;max-width:100vw!important;height:100dvh;max-height:100dvh;margin:0!important;border-radius:0;overflow:hidden}
.el-overlay:has(.window-dialog--minimized){background:transparent;backdrop-filter:none;pointer-events:none}
.el-overlay .window-dialog--minimized{position:fixed;top:auto!important;right:16px;bottom:16px;left:auto!important;width:min(420px,calc(100% - 24px))!important;max-width:calc(100% - 24px)!important;max-height:76px;margin:0!important;border-radius:12px;pointer-events:auto;transform:none!important}
.window-dialog--minimized .el-dialog__body,.window-dialog--minimized .el-dialog__footer{display:none}
.window-dialog--minimized .window-dialog__header-content{align-items:center}
.window-dialog--minimized .window-dialog__heading{overflow:hidden}
.window-dialog--minimized .window-dialog__heading :is(.el-dialog__title,strong,span){display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.window-dialog--minimized .window-dialog__heading :is(.zoom-heading) :is(span,small){display:none}
.window-dialog--minimized .el-dialog__header{padding-bottom:0!important;border-bottom:0}
@media(max-width:760px){.window-dialog__controls{gap:1px;margin:-7px -8px 0 0}.window-dialog__control,.window-dialog__controls .el-dialog__headerbtn{width:36px;height:40px}.window-dialog__header-content{gap:7px}.el-overlay .window-dialog--minimized{right:12px;bottom:12px;margin:0!important}.window-dialog--minimized .el-dialog__header{padding-bottom:0!important}}
@media(prefers-reduced-motion:reduce){.window-dialog__control,.window-dialog__controls .el-dialog__headerbtn{transition:none}}
</style>
