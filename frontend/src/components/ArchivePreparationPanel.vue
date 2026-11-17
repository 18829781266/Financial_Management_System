<script setup lang="ts">
import {computed} from 'vue';
import {FileCheck2,ShieldCheck} from 'lucide-vue-next';
import type {ArchivePreparation} from '../archivePreparation';
import type {SourceDocument,Voucher} from '../types';

const props=defineProps<{preparation:ArchivePreparation}>();
const emit=defineEmits<{
 'review-document':[document:SourceDocument];
 'review-voucher':[voucher:Voucher];
 'confirm-no-attachment':[voucher:Voucher];
 view:[document:SourceDocument];
}>();
const pendingCount=computed(()=>props.preparation.pendingDocuments.length+props.preparation.noAttachmentVouchers.length+props.preparation.missingVouchers.length);
</script>

<template>
 <section v-if="pendingCount||preparation.exemptVouchers.length" class="archive-preparation" aria-label="归档前附件复核">
  <header><FileCheck2 :size="17"/><h4>归档前附件复核</h4><span v-if="pendingCount">{{pendingCount}} 项待处理</span></header>
  <p v-if="preparation.pendingDocuments.length" class="preparation-description">凭证关联已完成，以下单据的字段仍需对照原件确认。</p>
  <ul v-if="pendingCount" class="preparation-items">
   <li v-for="item in preparation.pendingDocuments" :key="'document:'+item.document.id" :data-document-id="item.document.id">
    <div class="preparation-item-copy"><strong>{{item.document.name}}</strong><small>{{item.voucherNos.join('、')}} · 附件字段待复核</small></div>
    <div class="preparation-actions"><button type="button" class="text-link" @click="emit('view',item.document)">查看原件</button><button type="button" class="btn" @click="emit('review-document',item.document)">复核附件</button></div>
   </li>
   <li v-for="voucher in preparation.noAttachmentVouchers" :key="'no-attachment:'+voucher.id" :data-voucher-id="voucher.id">
    <div class="preparation-item-copy"><strong>{{voucher.no}} · 尚未关联附件</strong><small>确实无需外部附件的凭证，需复核并填写业务依据。</small></div>
    <button type="button" class="btn" @click="emit('confirm-no-attachment',voucher)">复核无附件凭证</button>
   </li>
   <li v-for="voucher in preparation.missingVouchers" :key="'missing:'+voucher.id" :data-voucher-id="voucher.id">
    <div class="preparation-item-copy"><strong>{{voucher.no}} · 附件缺失</strong><small>请先补齐原件或纠正关联，附件缺失不能确认为无需附件。</small></div>
    <button type="button" class="btn" @click="emit('review-voucher',voucher)">补件与复核</button>
   </li>
  </ul>
  <div v-if="preparation.exemptVouchers.length" class="preparation-exempt" role="status"><ShieldCheck :size="17"/><span>{{preparation.exemptVouchers.map(voucher=>voucher.no).join('、')}} 已确认无需外部附件，业务依据已记录。</span></div>
 </section>
</template>

<style scoped>
.archive-preparation{margin:20px 0;padding:16px;border:1px solid var(--ws-line);border-radius:12px;background:#f7faff;color:var(--ws-ink)}
.archive-preparation>header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.archive-preparation>header>svg{color:var(--ws-accent);flex:none}.archive-preparation h4{margin:0;font-size:14px;font-weight:650;line-height:1.6}
.archive-preparation>header>span{margin-left:auto;font-size:12px;color:#93601f}
.preparation-description{margin:8px 0 0;font-size:12px;line-height:1.8;color:var(--ws-secondary)}
.preparation-items{list-style:none;margin:12px 0 0;padding:0;max-height:280px;overflow:auto}
.preparation-items>li{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--ws-line)}
.preparation-items>li:first-child{padding-top:0;border-top:0}.preparation-items>li:last-child{padding-bottom:0}
.preparation-item-copy{flex:1;min-width:0}.preparation-item-copy strong{display:block;font-size:12px;font-weight:600;line-height:1.7;overflow-wrap:anywhere}
.preparation-item-copy small{display:block;margin-top:3px;font-size:12px;line-height:1.7;color:var(--ws-secondary)}
.preparation-actions{display:flex;align-items:center;gap:12px;flex-shrink:0}.preparation-items .btn{min-height:36px;max-width:100%;padding:0 10px;font-size:12px;white-space:normal;flex-shrink:0}
.preparation-actions .text-link{font-size:12px;min-height:36px;white-space:nowrap}
.preparation-exempt{display:flex;align-items:flex-start;gap:8px;margin-top:12px;color:#267561;font-size:12px;line-height:1.8;overflow-wrap:anywhere}.preparation-exempt>svg{flex:none;margin-top:2px}
@media(max-width:560px){.archive-preparation{padding:14px}.preparation-items>li{align-items:flex-start;flex-wrap:wrap}.preparation-item-copy{flex-basis:100%}.preparation-actions{width:100%;justify-content:flex-end}.preparation-items>li>.btn{margin-left:auto}.preparation-items .btn{min-height:40px}}
</style>
