<script setup lang="ts">
import {computed,ref} from 'vue';
import {BookOpen,Clock3,FileSearch,GitBranch,ShieldCheck} from 'lucide-vue-next';

type ArchiveView='books'|'matching'|'search'|'history';
const props=defineProps<{modelValue:string;archiveCount:number;groupCount:number}>();
const emit=defineEmits<{'update:modelValue':[value:ArchiveView]}>();
const controls=ref<HTMLButtonElement[]>([]);
const tabs=computed(()=>[
 {id:'books' as const,label:'档案册管理',icon:BookOpen,count:props.archiveCount,unit:'本档案册'},
 {id:'matching' as const,label:'已关联资料',icon:GitBranch,count:props.groupCount,unit:'组资料'},
 {id:'search' as const,label:'凭证检索',icon:FileSearch,count:undefined,unit:''},
 {id:'history' as const,label:'归档记录',icon:Clock3,count:undefined,unit:''},
]);
function moveFocus(event:KeyboardEvent,index:number){
 let next:number;
 if(event.key==='ArrowRight')next=(index+1)%tabs.value.length;
 else if(event.key==='ArrowLeft')next=(index-1+tabs.value.length)%tabs.value.length;
 else if(event.key==='Home')next=0;
 else if(event.key==='End')next=tabs.value.length-1;
 else return;
 event.preventDefault();controls.value[next]?.focus();
}
</script>

<template>
 <nav class="section-tabs archive-section-tabs" aria-label="电子档案视图">
  <div class="archive-view-controls">
   <button v-for="(tab,index) in tabs" :key="tab.id" :ref="element=>{if(element)controls[index]=element as HTMLButtonElement}" type="button" :class="['archive-view-button',{selected:modelValue===tab.id,'has-count':tab.count!==undefined}]" :aria-pressed="modelValue===tab.id" :title="tab.label" @click="emit('update:modelValue',tab.id)" @keydown="moveFocus($event,index)">
    <span class="archive-view-icon" aria-hidden="true"><component :is="tab.icon" :size="18" :stroke-width="1.7"/></span>
    <span class="archive-view-label">{{tab.label}}</span>
    <span v-if="tab.count!==undefined" class="archive-view-count" :aria-label="tab.count+' '+tab.unit">{{tab.count.toLocaleString('zh-CN')}}</span>
   </button>
  </div>
  <span class="archive-view-assurance"><ShieldCheck :size="15" aria-hidden="true"/>全流程可追溯</span>
 </nav>
</template>

<style scoped>
.app-shell .archive-section-tabs.section-tabs{display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:54px;height:auto;margin-bottom:22px;padding:0;background:transparent;border:0;border-radius:0;overflow:visible}
.app-shell .archive-section-tabs>.archive-view-controls{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));width:min(100%,760px);min-width:0;gap:10px}
.app-shell .archive-section-tabs .archive-view-button{display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:9px;position:relative;width:100%;height:auto;min-height:54px;padding:10px 13px;border:1px solid var(--ws-line);border-radius:10px;background:var(--ws-surface);color:var(--ws-secondary);font-family:inherit;font-size:13px;font-weight:500;text-align:left;white-space:nowrap;cursor:pointer;touch-action:manipulation;box-shadow:none;transition:background-color 180ms ease-out,border-color 180ms ease-out,color 180ms ease-out}
.app-shell .archive-section-tabs .archive-view-button:after{display:none}
.app-shell .archive-section-tabs .archive-view-icon{display:grid;place-items:center;width:30px;height:30px;min-width:0;margin:0;padding:0;border-radius:8px;background:var(--ws-accent-soft);color:var(--ws-secondary);font-size:inherit;line-height:1}
.app-shell .archive-section-tabs .archive-view-icon svg{flex:none;width:18px;height:18px;transition:transform 180ms cubic-bezier(.16,1,.3,1)}
.app-shell .archive-section-tabs .archive-view-label{display:block;min-width:0;margin:0;padding:0;background:transparent;color:inherit;font-size:13px;line-height:1.6;text-overflow:ellipsis;overflow:hidden;border-radius:0}
.app-shell .archive-section-tabs .archive-view-count{display:inline-flex;align-items:center;justify-content:center;min-width:23px;margin:0;padding:1px 5px;border-radius:5px;background:#f0f3f8;color:var(--ws-secondary);font-size:11px;line-height:19px;font-weight:600;font-variant-numeric:tabular-nums}
.app-shell .archive-section-tabs .archive-view-button.selected{border-color:#a6c2f6;background:var(--ws-accent-soft);color:var(--ws-accent);font-weight:600;box-shadow:none}
.app-shell .archive-section-tabs .archive-view-button.selected .archive-view-icon{background:var(--ws-surface);color:var(--ws-accent)}
.app-shell .archive-section-tabs .archive-view-button.selected .archive-view-count{background:var(--ws-surface);color:var(--ws-accent)}
.app-shell .archive-section-tabs .archive-view-button:focus-visible{outline:2px solid var(--ws-accent);outline-offset:3px}
.app-shell .archive-section-tabs>.archive-view-assurance{display:inline-flex;align-items:center;flex:none;gap:6px;color:var(--ws-muted);font-size:11px;line-height:1.6;white-space:nowrap}
@media(hover:hover) and (pointer:fine){
 .app-shell .archive-section-tabs .archive-view-button:hover{border-color:#b6cbee;background:#f7faff;color:var(--ws-accent)}
 .app-shell .archive-section-tabs .archive-view-button.selected:hover{border-color:#8eb1f2;background:#e7efff}
 .app-shell .archive-section-tabs .archive-view-button:hover .archive-view-icon svg{transform:translateY(-1px)}
}
@media(max-width:1100px){.app-shell .archive-section-tabs>.archive-view-assurance{display:none}.app-shell .archive-section-tabs>.archive-view-controls{width:100%}}
@media(max-width:820px){
 .app-shell .archive-section-tabs.section-tabs{margin-bottom:18px;min-height:0}
 .app-shell .archive-section-tabs>.archive-view-controls{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
 .app-shell .archive-section-tabs .archive-view-button{grid-template-columns:24px minmax(0,1fr);grid-template-rows:1fr 1fr;column-gap:6px;row-gap:2px;min-height:68px;padding:9px 7px;white-space:normal}
 .app-shell .archive-section-tabs .archive-view-icon{grid-column:1;grid-row:1/3;width:24px;height:28px;border-radius:6px}
 .app-shell .archive-section-tabs .archive-view-icon svg{width:17px;height:17px}
 .app-shell .archive-section-tabs .archive-view-label{grid-column:2;grid-row:1/3;font-size:12px;line-height:1.5;white-space:normal;text-overflow:clip;overflow:visible}
 .app-shell .archive-section-tabs .archive-view-button.has-count .archive-view-label{grid-row:1;align-self:end}
 .app-shell .archive-section-tabs .archive-view-count{grid-column:2;grid-row:2;justify-self:start;align-self:start;min-width:19px;padding:0 4px;font-size:10px;line-height:17px;max-width:100%;overflow-wrap:anywhere}
}
@media(prefers-reduced-motion:reduce){.app-shell .archive-section-tabs .archive-view-button,.app-shell .archive-section-tabs .archive-view-icon svg{transition:none}.app-shell .archive-section-tabs .archive-view-button:hover .archive-view-icon svg{transform:none}}
</style>
