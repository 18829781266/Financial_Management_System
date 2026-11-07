<script setup lang="ts">
import {computed,useId} from 'vue';

const props=withDefaults(defineProps<{name:string;size?:number;compact?:boolean}>(),{size:42,compact:false});
const palettes:Record<string,[string,string,string,string]>={
 overview:['#377cf0','#80b9ff','#eaf3ff','#245ab5'],
 data:['#139eaf','#62d7d5','#e5f9f8','#087b90'],
 match:['#6355df','#a99aff','#f0edff','#4b3eb0'],
 exceptions:['#e9a035','#ffcb6b','#fff5df','#b97925'],
 archives:['#2b85dd','#80c7f8','#e9f5ff','#2465ac'],
 rules:['#8b65d5','#c6a3f4','#f4edff','#6943b1'],
 users:['#4376d4','#a1c2ff','#ecf3ff','#2e58a4'],
 logs:['#5085aa','#9ac5df','#edf5fb','#386485'],
 cloud:['#368fe6','#89d5ff','#eaf6ff','#246eaf'],
 upload:['#4874e7','#9cbaff','#edf1ff','#3258b2'],
 verified:['#189d86','#70d9b4','#e6f8f0','#0c7a69'],
 };
const palette=computed(()=>palettes[props.name]||palettes.overview!);
const uid=`feature-${useId().replace(/[^a-z0-9]/gi,'')}`;
const styles=computed(()=>({width:`${props.size}px`,height:`${props.size}px`,'--fi-main':palette.value[0],'--fi-light':palette.value[1],'--fi-soft':palette.value[2],'--fi-deep':palette.value[3]}));
</script>

<template>
 <span :class="['feature-icon',`feature-icon-${name}`,{compact}]" :style="styles" aria-hidden="true">
  <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
   <defs>
    <linearGradient :id="uid+'-surface'" x1="8" y1="5" x2="39" y2="44" gradientUnits="userSpaceOnUse"><stop stop-color="var(--fi-soft)"/><stop offset="1" stop-color="var(--fi-light)" stop-opacity=".24"/></linearGradient>
    <linearGradient :id="uid+'-ink'" x1="13" y1="9" x2="36" y2="39" gradientUnits="userSpaceOnUse"><stop stop-color="var(--fi-light)"/><stop offset="1" stop-color="var(--fi-main)"/></linearGradient>
    <linearGradient :id="uid+'-paper'" x1="17" y1="9" x2="32" y2="38" gradientUnits="userSpaceOnUse"><stop stop-color="white"/><stop offset="1" stop-color="var(--fi-soft)"/></linearGradient>
   </defs>
   <rect class="icon-well" x="1" y="1" width="46" height="46" rx="14" :fill="`url(#${uid}-surface)`"/>
   <path class="icon-glint" d="M9 13A6 6 0 0 1 15 7h7" stroke="white" stroke-opacity=".8" stroke-width="1.5" stroke-linecap="round"/>
   <ellipse class="icon-shadow" cx="25" cy="39" rx="12" ry="2.5" fill="var(--fi-deep)" opacity=".11"/>
   <g class="icon-body" stroke-linecap="round" stroke-linejoin="round">
    <template v-if="name==='users'">
     <circle cx="21" cy="18" r="7" :fill="`url(#${uid}-ink)`"/>
     <path d="M9 37v-3a12 12 0 0 1 24 0v3" :fill="`url(#${uid}-ink)`"/>
     <path d="M32 12a6 6 0 0 1 0 12m4 5a10 10 0 0 1 4 8" stroke="var(--fi-main)" stroke-width="2.5"/>
     <path d="M15 34h10" stroke="white" stroke-width="1.5" opacity=".7"/>
    </template>
    <template v-else-if="name==='overview'">
     <rect x="11" y="11" width="11" height="12" rx="3" :fill="`url(#${uid}-ink)`"/>
     <rect x="25" y="11" width="12" height="8" rx="3" fill="var(--fi-main)" opacity=".42"/>
     <rect x="11" y="26" width="11" height="10" rx="3" fill="var(--fi-main)" opacity=".28"/>
     <rect x="25" y="22" width="12" height="14" rx="3" :fill="`url(#${uid}-ink)`"/>
     <path d="M28 31v-3m3 3v-5m3 5v-7" stroke="white" stroke-width="1.5"/>
     <path d="M14 15h4" stroke="white" stroke-width="1.5" opacity=".8"/>
    </template>
    <template v-else-if="name==='data'">
     <path d="M11 16v15c0 3 6 5 12 5s12-2 12-5V16" :fill="`url(#${uid}-ink)`"/>
     <ellipse cx="23" cy="15" rx="12" ry="5" fill="var(--fi-light)" stroke="var(--fi-main)" stroke-width="1.3"/>
     <path d="M11 23c0 3 6 5 12 5 5 0 9-1 11-3M11 30c0 3 6 5 12 5" stroke="white" stroke-opacity=".7" stroke-width="1.4"/>
     <path d="M16 14c2-1 6-2 10-1" stroke="white" stroke-width="1.5"/>
     <circle cx="35" cy="33" r="7" fill="white"/>
     <circle cx="35" cy="33" r="5.5" fill="var(--fi-deep)"/>
     <path d="M35 30v6m-3-3h6" stroke="white" stroke-width="1.5"/>
    </template>
    <template v-else-if="name==='match'">
     <path d="M16 13v9a6 6 0 0 0 6 6h9M16 29v-4m15-10h-3a6 6 0 0 0-6 6v1" stroke="var(--fi-main)" stroke-width="2.5"/>
     <rect x="10" y="8" width="12" height="10" rx="3.5" :fill="`url(#${uid}-ink)`"/>
     <rect x="27" y="23" width="12" height="11" rx="3.5" :fill="`url(#${uid}-ink)`"/>
     <circle cx="16" cy="34" r="5.5" fill="var(--fi-main)" opacity=".28"/>
     <path d="m31 13 2 2 4-4M13 12h5m12 15h6" stroke="white" stroke-width="1.6"/>
     <circle cx="33" cy="13" r="6" fill="var(--fi-light)"/>
     <path d="m30 13 2 2 4-4" stroke="white" stroke-width="1.7"/>
    </template>
    <template v-else-if="name==='exceptions'">
     <path d="M14 9h14l6 6v20a3 3 0 0 1-3 3H14a3 3 0 0 1-3-3V12a3 3 0 0 1 3-3Z" :fill="`url(#${uid}-paper)`" stroke="var(--fi-main)" stroke-width="1.5"/>
     <path d="M28 9v6h6" fill="var(--fi-light)" stroke="var(--fi-main)" stroke-width="1.3"/>
     <path d="M16 18h7m-7 5h9m-9 5h5" stroke="var(--fi-main)" stroke-width="1.5" opacity=".6"/>
     <circle cx="33" cy="31" r="8.5" fill="white"/>
     <circle cx="33" cy="31" r="7" :fill="`url(#${uid}-ink)`"/>
     <path d="M33 27v5" stroke="white" stroke-width="2"/><circle cx="33" cy="35" r="1" fill="white"/>
    </template>
    <template v-else-if="name==='archives'">
     <path d="M10 17h11l3 3h14v14a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4Z" fill="var(--fi-deep)" opacity=".32"/>
     <path d="M14 11h16l5 5v17H14Z" :fill="`url(#${uid}-paper)`" stroke="var(--fi-main)" stroke-width="1.3"/>
     <path d="M30 11v5h5M19 18h8m-8 5h10" stroke="var(--fi-main)" stroke-width="1.5" opacity=".65"/>
     <path d="M9 25h30l-3 11a3 3 0 0 1-3 2H15a3 3 0 0 1-3-2Z" :fill="`url(#${uid}-ink)`"/>
     <rect x="20" y="29" width="9" height="3" rx="1.5" fill="white" opacity=".85"/>
     <path d="M13 26h20" stroke="white" stroke-opacity=".45" stroke-width="1.3"/>
    </template>
    <template v-else-if="name==='rules'">
     <rect x="10" y="10" width="28" height="28" rx="7" :fill="`url(#${uid}-paper)`" stroke="var(--fi-main)" stroke-opacity=".35" stroke-width="1.3"/>
     <path d="M17 15v18m7-18v18m7-18v18" stroke="var(--fi-main)" stroke-width="2" opacity=".42"/>
     <rect x="13" y="19" width="8" height="5" rx="2" :fill="`url(#${uid}-ink)`"/>
     <rect x="20" y="27" width="8" height="5" rx="2" :fill="`url(#${uid}-ink)`"/>
     <rect x="27" y="15" width="8" height="5" rx="2" :fill="`url(#${uid}-ink)`"/>
     <path d="M15 20h4m3 8h4m3-12h4" stroke="white" stroke-opacity=".75"/>
    </template>
    <template v-else-if="name==='logs'">
     <rect x="12" y="10" width="25" height="29" rx="4" fill="var(--fi-main)" opacity=".25"/>
     <rect x="10" y="8" width="25" height="29" rx="4" :fill="`url(#${uid}-paper)`" stroke="var(--fi-main)" stroke-width="1.3"/>
     <rect x="17" y="7" width="11" height="5" rx="2" :fill="`url(#${uid}-ink)`"/>
     <path d="M20 18h9m-9 7h9m-9 7h6" stroke="var(--fi-main)" stroke-width="1.5" opacity=".7"/>
     <circle cx="15" cy="18" r="1.6" fill="var(--fi-main)"/><circle cx="15" cy="25" r="1.6" fill="#36b5a0"/><circle cx="15" cy="32" r="1.6" fill="var(--fi-main)" opacity=".45"/>
    </template>
    <template v-else-if="name==='cloud'">
     <path d="M13 34a8 8 0 0 1-1-16 12 12 0 0 1 23 1 7.5 7.5 0 0 1 0 15Z" :fill="`url(#${uid}-ink)`"/>
     <path d="M14 20a9 9 0 0 1 16-5" stroke="white" stroke-width="1.8" opacity=".7"/>
     <path d="m17 28 5-5 4 4 6-6" stroke="white" stroke-width="2"/>
    </template>
    <template v-else-if="name==='upload'">
     <path d="M12 25v9a4 4 0 0 0 4 4h17a4 4 0 0 0 4-4v-9" fill="var(--fi-main)" opacity=".22"/>
     <path d="M10 25v8a4 4 0 0 0 4 4h18a4 4 0 0 0 4-4v-8" stroke="var(--fi-main)" stroke-width="2"/>
     <path d="M23 29V11m-7 7 7-7 7 7" stroke="var(--fi-main)" stroke-width="3"/>
     <path d="M25 14v13" stroke="var(--fi-light)" stroke-width="1.2"/>
     <path d="M17 32h12" stroke="white" stroke-width="2"/>
    </template>
    <template v-else>
     <path d="m24 8 14 5v10c0 9-8 14-14 17-6-3-14-8-14-17V13Z" :fill="`url(#${uid}-ink)`"/>
     <path d="m14 16 10-4 9 3" stroke="white" stroke-opacity=".65" stroke-width="1.5"/>
     <path d="m17 24 5 5 10-11" stroke="white" stroke-width="2.8"/>
     <circle cx="36" cy="35" r="4" fill="white"/><path d="m34.5 35 1 1 2-2" stroke="var(--fi-main)" stroke-width="1.5"/>
    </template>
   </g>
   <circle class="icon-spark" cx="39" cy="9" r="2" fill="var(--fi-light)"/>
  </svg>
 </span>
</template>

<style scoped>
/* 整个祖先选择器放进 :global，避免 Vue 编译时丢弃后缀，将透明度/缩放误加给所有按钮。 */
.feature-icon{display:inline-flex;flex:none;align-items:center;justify-content:center;position:relative;vertical-align:middle;pointer-events:none;line-height:1}.feature-icon>svg{display:block;width:100%;height:100%;overflow:visible;stroke-width:1.5}.icon-body{transform-origin:24px 28px;transition:transform .24s ease}.icon-shadow{transition:opacity .24s ease,transform .24s ease;transform-origin:center}.icon-spark{transform-origin:39px 9px;transition:transform .3s ease,opacity .3s ease}.compact .icon-well{opacity:.95}.compact .icon-glint{opacity:.8}:global(button:hover .feature-icon .icon-body),:global(a:hover .feature-icon .icon-body){transform:translateY(-1.5px) rotate(-2deg)}:global(button:hover .feature-icon .icon-shadow),:global(a:hover .feature-icon .icon-shadow){opacity:.08;transform:scale(.86)}:global(button:hover .feature-icon .icon-spark),:global(a:hover .feature-icon .icon-spark){transform:scale(1.25);opacity:.85}@media(prefers-reduced-motion:reduce){.icon-body,.icon-shadow,.icon-spark{transition:none}:global(button:hover .feature-icon .icon-body),:global(a:hover .feature-icon .icon-body){transform:none}}
</style>
