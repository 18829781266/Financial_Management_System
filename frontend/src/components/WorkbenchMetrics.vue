<script setup lang="ts">
import {useId} from 'vue';
import {ArrowUpRight} from 'lucide-vue-next';
import FeatureIcon from './FeatureIcon.vue';

defineProps<{totalCount:number;matchedCount:number;pendingCount:number;rate:string}>();
const emit=defineEmits<{open:[view:'all'|'matched'|'review']}>();
const id=useId();
const count=(value:number)=>value.toLocaleString('zh-CN');
</script>

<template>
 <section class="metrics archive-metrics workbench-metrics" aria-label="业务概览">
  <button type="button" class="metric metric-total metric-shortcut" aria-label="查看全部凭证" :aria-describedby="id+'-total-value'" @click="emit('open','all')">
   <div class="metric-label"><FeatureIcon name="data" :size="38"/><span>记账凭证总数</span></div>
   <div :id="id+'-total-value'" :class="['metric-value',{'metric-value-long':totalCount>=1000}]"><strong>{{count(totalCount)}}</strong><span>张</span></div>
   <ArrowUpRight class="metric-open-icon" :size="16" aria-hidden="true"/>
  </button>
  <button type="button" class="metric metric-linked metric-shortcut" aria-label="查看已关联凭证" :aria-describedby="id+'-matched-value'" @click="emit('open','matched')">
   <div class="metric-label"><FeatureIcon name="verified" :size="38"/><span>已关联凭证</span></div>
   <div :id="id+'-matched-value'" :class="['metric-value',{'metric-value-long':matchedCount>=1000}]"><strong>{{count(matchedCount)}}</strong><span>张</span></div>
   <ArrowUpRight class="metric-open-icon" :size="16" aria-hidden="true"/>
  </button>
  <article class="metric metric-coverage">
   <div class="metric-label"><FeatureIcon name="match" :size="38"/><span>关联覆盖率</span></div>
   <div :class="['metric-value',{'metric-value-long':Number(rate)>=100}]"><strong>{{rate}}</strong><span>%</span></div>
  </article>
  <button type="button" class="metric metric-attention metric-shortcut" aria-label="查看待复核项" :aria-describedby="id+'-pending-value'" @click="emit('open','review')">
   <div class="metric-label"><FeatureIcon name="exceptions" :size="38"/><span>待处理凭证</span></div>
   <div :id="id+'-pending-value'" :class="['metric-value',{'metric-value-long':pendingCount>=1000}]"><strong>{{count(pendingCount)}}</strong><span>张</span></div>
   <ArrowUpRight class="metric-open-icon" :size="16" aria-hidden="true"/>
  </button>
 </section>
</template>

<style scoped>
.workbench-metrics .metric{--metric-tint:#eaf3ff;--metric-accent:#377cf0;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:0;min-height:174px;padding:20px;gap:0;font:inherit;text-align:center;color:var(--ws-ink);background:color-mix(in srgb,var(--metric-tint) 65%,var(--ws-surface));border-color:color-mix(in srgb,var(--metric-accent) 15%,var(--ws-line));overflow:visible;transition:transform 200ms cubic-bezier(.16,1,.3,1),border-color 200ms ease-out,box-shadow 200ms ease-out,background-color 200ms ease-out}
.workbench-metrics .metric-linked{--metric-tint:#e6f8f0;--metric-accent:#189d86}
.workbench-metrics .metric-coverage{--metric-tint:#f0edff;--metric-accent:#6355df}
.workbench-metrics .metric-attention{--metric-tint:#fff5df;--metric-accent:#b97925}
.workbench-metrics .metric-label{display:contents;font-size:13px;font-weight:500;line-height:1.6;color:var(--ws-secondary)}
.workbench-metrics .metric-label>.feature-icon{order:0;flex:none;width:42px!important;height:42px!important;margin:0 0 10px}
.workbench-metrics .metric-label>span:not(.feature-icon){order:2;min-width:0;margin-top:7px;color:color-mix(in srgb,var(--metric-accent) 20%,var(--ws-ink))}
.workbench-metrics .metric-value{order:1;display:grid;flex:0 0 auto;grid-template-columns:minmax(0,1fr) max-content minmax(0,1fr);align-items:baseline;width:100%;min-width:0;margin:0}
.workbench-metrics .metric-value strong{grid-column:2;margin:0;font-size:42px;font-weight:650;line-height:1.1;letter-spacing:-.6px;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--ws-ink)}
.workbench-metrics .metric-value>span{grid-column:3;justify-self:start;margin-left:7px;font-size:12px;line-height:1.6;color:var(--ws-muted)}
.workbench-metrics .metric-shortcut{cursor:pointer;touch-action:manipulation}
.workbench-metrics .metric-open-icon{position:absolute;right:15px;top:15px;color:var(--ws-accent);opacity:0;transition:opacity 160ms ease-out;pointer-events:none}
.workbench-metrics .metric-shortcut:focus-visible{outline:2px solid var(--metric-accent);outline-offset:3px}
.workbench-metrics .metric-shortcut:focus-visible .metric-open-icon{opacity:1}
@media(hover:hover) and (pointer:fine){.workbench-metrics .metric:hover{background:color-mix(in srgb,var(--metric-tint) 90%,var(--ws-surface));border-color:color-mix(in srgb,var(--metric-accent) 35%,var(--ws-line));box-shadow:0 9px 22px color-mix(in srgb,var(--metric-accent) 12%,transparent)}.workbench-metrics .metric-shortcut:hover .metric-open-icon{opacity:1}}
@media(max-width:1100px){.workbench-metrics .metric{min-height:168px;padding:18px 16px}.workbench-metrics .metric-value strong{font-size:38px}}
@media(max-width:560px){.workbench-metrics .metric{min-height:160px;padding:18px 10px}.workbench-metrics .metric-label{font-size:12px}.workbench-metrics .metric-label>.feature-icon{width:34px!important;height:34px!important;margin-bottom:9px}.workbench-metrics .metric-value strong{font-size:34px}.workbench-metrics .metric-value>span{font-size:11px;margin-left:5px}.workbench-metrics .metric-open-icon{top:10px;right:10px;width:14px;height:14px}.workbench-metrics .metric-value-long strong{font-size:26px}}
@media(max-width:360px){.workbench-metrics .metric{min-height:154px;padding:16px 9px}.workbench-metrics .metric-label{font-size:11px}.workbench-metrics .metric-value strong{font-size:30px}.workbench-metrics .metric-value-long strong{font-size:22px}.workbench-metrics .metric-value>span{margin-left:4px;font-size:10px}}
@media(prefers-reduced-motion:reduce){.workbench-metrics .metric,.workbench-metrics .metric-open-icon{transition:none}}
</style>
