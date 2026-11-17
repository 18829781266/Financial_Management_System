<script setup lang="ts">
import { computed } from 'vue';
import FeatureIcon from './FeatureIcon.vue';
import { ArrowRight, Check, ChevronRight, FileCheck2, FolderArchive, GitBranch, Upload } from 'lucide-vue-next';

const props = defineProps<{
  pendingCount: number;
  unlinkedDocumentCount: number;
  enabledRuleCount: number;
  voucherCount: number;
  matchedCount: number;
  archiveCount: number;
  logs: Array<{ id: string; action: string; detail: string; time: string }>;
}>();
const emit = defineEmits<{ navigate: [id: string]; collect: [] }>();
const matchedPercentage = computed(() => props.voucherCount ? Math.min(100, Math.max(0, Math.round(props.matchedCount / props.voucherCount * 100))) : 0);
const workflow = [
  { id: 'data', name: '采集凭证', description: '导入凭证与原始单据', icon: Upload },
  { id: 'match', name: '智能匹配', description: '核对凭证与单据关系', icon: GitBranch },
  { id: 'exceptions', name: '人工复核', description: '处理疑问与缺失附件', icon: FileCheck2 },
  { id: 'archives', name: '电子归档', description: '整理原件，生成档案册', icon: FolderArchive },
];
const recentLogs = computed(() => props.logs.slice(0, 5));
</script>

<template>
  <div class="workbench">
    <section class="workbench-welcome" aria-labelledby="workbench-welcome-title">
      <div class="welcome-copy">
        <span class="section-eyebrow">日常财务 · 有序推进</span>
        <h2 id="workbench-welcome-title">从凭证采集，到有据可查。</h2>
        <p>让待办及时处理，让每一份原件都有清晰的去向。</p>
      </div>
      <div class="welcome-actions">
        <button class="workbench-primary" @click="emit('collect')"><Upload :size="17" />采集凭证<ArrowRight :size="16" /></button>
        <span>支持 PDF、图片与批量导入</span>
      </div>
    </section>

    <div class="workbench-columns">
      <section class="workbench-surface process-surface" aria-labelledby="workbench-process-title">
        <header class="workbench-section-heading">
          <div><span class="section-eyebrow">WORKFLOW</span><h3 id="workbench-process-title">财务工作流程</h3></div>
          <span class="quiet-label">四步衔接，原件随行</span>
        </header>
        <ol class="process-steps">
          <li v-for="(step, index) in workflow" :key="step.id">
            <button @click="emit('navigate', step.id)">
              <span class="step-number">0{{ index + 1 }}</span>
              <span class="step-icon"><FeatureIcon :name="step.id" :size="44" /></span>
              <strong>{{ step.name }}</strong>
              <small>{{ step.description }}</small>
              <ArrowRight class="step-arrow" :size="15" />
            </button>
          </li>
        </ol>
        <div class="matching-progress">
          <div class="matching-progress-label"><span>凭证关联进度</span><span v-if="voucherCount"><strong>{{ matchedCount }}</strong> / {{ voucherCount }} 张已关联</span><span v-else>等待采集首批凭证</span></div>
          <div class="progress-track" role="progressbar" aria-label="凭证关联进度" :aria-valuenow="matchedPercentage" aria-valuemin="0" aria-valuemax="100" :aria-valuetext="`${matchedCount} / ${voucherCount} 张凭证已关联`"><span :style="{ width: `${matchedPercentage}%` }" /></div>
          <p>完成关联后，仍需按归档要求检查原件与附件。</p>
        </div>
        <footer class="process-footer">
          <span><span class="enabled-dot" />{{ enabledRuleCount }} 条匹配规则已启用</span>
          <button class="workbench-link" @click="emit('navigate', 'rules')">管理规则<ArrowRight :size="14" /></button>
        </footer>
      </section>

      <section class="workbench-surface attention-surface" aria-labelledby="workbench-attention-title">
        <header class="workbench-section-heading">
          <div><span class="section-eyebrow">TO DO</span><h3 id="workbench-attention-title">需要关注</h3></div>
          <span class="attention-caption">待处理</span>
        </header>
        <div class="attention-list">
          <button class="attention-row" @click="emit('navigate', 'exceptions')">
            <span class="attention-icon"><FeatureIcon name="exceptions" :size="36" /></span>
            <span class="attention-copy"><strong>待匹配凭证</strong><small>{{ pendingCount ? '核对候选单据与匹配异常' : '当前暂无待匹配凭证' }}</small></span>
            <span class="attention-number">{{ pendingCount }}</span><ChevronRight :size="16" />
          </button>
          <button class="attention-row" @click="emit('navigate', 'documents')">
            <span class="attention-icon neutral"><FeatureIcon name="data" :size="36" /></span>
            <span class="attention-copy"><strong>未关联原始单据</strong><small>{{ unlinkedDocumentCount ? '核对信息并补齐关联' : '当前暂无未关联单据' }}</small></span>
            <span class="attention-number">{{ unlinkedDocumentCount }}</span><ChevronRight :size="16" />
          </button>
        </div>
        <div class="attention-note"><Check :size="15" /><span>已生成 {{ archiveCount }} 本档案册</span><button class="workbench-link" @click="emit('navigate', 'archives')">查看档案<ArrowRight :size="14" /></button></div>
      </section>
    </div>

    <section class="workbench-surface recent-surface" aria-labelledby="workbench-recent-title">
      <header class="workbench-section-heading">
        <div class="recent-title"><FeatureIcon name="logs" :size="30" /><h3 id="workbench-recent-title">最近操作</h3><span class="quiet-label">业务进展，清晰留痕</span></div>
        <button class="workbench-link" @click="emit('navigate', 'logs')">查看全部<ArrowRight :size="14" /></button>
      </header>
      <div v-if="!recentLogs.length" class="recent-empty"><span class="recent-empty-icon"><FeatureIcon name="logs" :size="48" /></span><div><strong>操作记录将从这里开始</strong><p>采集凭证、核对单据或生成档案后，可在这里查看最近操作。</p></div><button class="workbench-link" @click="emit('collect')">开始采集<ArrowRight :size="14" /></button></div>
      <ol v-else class="recent-list">
        <li v-for="log in recentLogs" :key="log.id"><span class="activity-marker" /><div class="recent-log-copy"><strong>{{ log.action }}</strong><p>{{ log.detail }}</p></div><time>{{ log.time }}</time></li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
/* 明亮办公室中长时间核对凭证，浅色纸面与克制的蓝色让任务更易扫描。 */
.workbench{--wb-ink:var(--ws-ink);--wb-secondary:var(--ws-secondary);--wb-muted:var(--ws-muted);--wb-line:var(--ws-line);--wb-accent:var(--ws-accent);--wb-paper:var(--ws-surface);color:var(--wb-ink);display:grid;gap:20px;min-width:0}
.workbench button{font:inherit;cursor:pointer;touch-action:manipulation}
.workbench button:focus-visible{outline:3px solid #75a2f2;outline-offset:4px}
.workbench-welcome{display:flex;align-items:center;justify-content:space-between;gap:32px;padding:27px 30px;background:#eef4ff;border:1px solid #dce8fb;border-radius:12px}
.section-eyebrow{display:none;font-size:10px;line-height:1.5;letter-spacing:1.7px;font-weight:650;color:var(--wb-muted)}
.welcome-copy h2{font-size:23px;line-height:1.5;letter-spacing:.3px;font-weight:650;margin:0;color:var(--wb-ink)}
.welcome-copy p{font-size:13px;line-height:1.8;color:var(--wb-secondary);margin:7px 0 0;max-width:65ch}
.welcome-actions{display:grid;justify-items:center;gap:10px;flex-shrink:0}
.workbench-primary{display:flex;align-items:center;justify-content:center;gap:10px;min-height:42px;padding:0 18px;border:1px solid var(--wb-accent);border-radius:8px;color:#ffffff;background:var(--wb-accent);font-size:13px!important;font-weight:600!important;transition:background-color .18s,border-color .18s}
.workbench-primary:hover{background:#2057ca;border-color:#2057ca}
.welcome-actions>span{font-size:10px;color:var(--wb-muted)}
.workbench-columns{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(285px,1fr);gap:20px;align-items:start}
.workbench-surface{background:var(--wb-paper);border:1px solid var(--wb-line);border-radius:12px;min-width:0;overflow:hidden}
.workbench-section-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:23px 24px 0}
.workbench-section-heading h3{margin:3px 0 0;font-size:16px;line-height:1.6;font-weight:650;color:var(--wb-ink)}
.quiet-label{font-size:11px;color:var(--wb-muted);font-weight:400;line-height:1.7}
.process-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));list-style:none;margin:21px 18px 20px;padding:0;gap:0}
.process-steps li{min-width:0;position:relative}
.process-steps li+li:before{content:'';position:absolute;left:0;top:38px;height:52px;width:1px;background:var(--wb-line)}
.process-steps button{display:flex;flex-direction:column;position:relative;align-items:flex-start;width:100%;gap:0;border:0;border-radius:10px;background:transparent;padding:10px 15px 14px;text-align:left;transition:background-color .18s}
.process-steps button:hover{background:#f3f7ff}
.step-number{font-size:10px;letter-spacing:.7px;color:#677d9b;font-variant-numeric:tabular-nums}
.step-icon{display:flex;align-items:center;height:58px;color:#3569bb}
.process-steps strong{font-size:13px;font-weight:600;line-height:1.8;white-space:nowrap}
.process-steps small{font-size:10px;color:var(--wb-muted);line-height:1.8;margin-top:3px;max-width:10em}
.step-arrow{position:absolute;top:49px;right:10px;color:#859bbc}
.process-steps li:last-child .step-arrow{display:none}
.matching-progress{margin:0 25px 20px;padding-top:18px;border-top:1px solid var(--wb-line)}
.matching-progress-label{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:11px;color:var(--wb-secondary);line-height:1.8}
.matching-progress-label strong{color:var(--wb-ink);font-weight:600}
.progress-track{height:5px;background:#e7edf8;border-radius:3px;margin-top:10px;overflow:hidden}
.progress-track>span{display:block;height:100%;border-radius:3px;background:var(--wb-accent)}
.matching-progress p{font-size:10px;line-height:1.7;color:var(--wb-muted);margin-top:8px}
.process-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 24px;background:#f8faff;border-top:1px solid var(--wb-line)}
.process-footer>span{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--wb-secondary)}
.enabled-dot{height:5px;width:5px;border-radius:50%;background:#199c83}
.workbench-link{display:inline-flex;align-items:center;gap:6px;border:0;padding:4px 0;background:none;color:var(--wb-accent);font-size:11px!important;line-height:1.8;white-space:nowrap;border-radius:3px;transition:color .18s}
.workbench-link:hover{color:#1d54c3}
.attention-caption{font-size:10px;line-height:1.6;color:oklch(49% .1 65);background:oklch(96% .025 70);padding:3px 8px;border-radius:5px}
.attention-list{padding:16px 15px 9px}
.attention-row{display:flex;align-items:center;width:100%;gap:11px;text-align:left;padding:17px 9px;border:0;border-radius:8px;background:none;color:var(--wb-secondary);transition:background-color .18s}
.attention-row+.attention-row{border-top:1px solid var(--wb-line);border-radius:0 0 8px 8px}
.attention-row:hover{background:#f6f9ff}
.attention-icon{display:grid;place-items:center;flex-shrink:0;width:38px;height:42px;color:oklch(57% .11 65);background:transparent;border-radius:8px}
.attention-icon.neutral{color:#4e77b5;background:transparent}
.attention-copy{flex:1;min-width:0;display:grid;gap:5px}
.attention-copy strong{font-size:12px;font-weight:600;line-height:1.5;color:var(--wb-ink)}
.attention-copy small{font-size:10px;line-height:1.7;color:var(--wb-muted)}
.attention-number{font-size:23px;line-height:1.5;font-weight:550;letter-spacing:-.5px;min-width:18px;text-align:right;color:var(--wb-ink);font-variant-numeric:tabular-nums}
.attention-row>svg:last-child{color:#8195b1;flex-shrink:0}
.attention-note{display:flex;align-items:center;gap:6px;padding:17px 24px 18px;font-size:11px;color:var(--wb-secondary);border-top:1px solid var(--wb-line);background:#f8faff}
.attention-note>svg{color:#188873;flex-shrink:0}
.attention-note .workbench-link{margin-left:auto}
.recent-surface .workbench-section-heading{padding:20px 24px;border-bottom:1px solid var(--wb-line)}
.recent-title{display:flex;align-items:center;gap:9px;min-width:0}
.recent-title>svg{color:var(--wb-secondary);flex-shrink:0}
.recent-title h3{margin:0}
.recent-title .quiet-label{margin-left:8px}
.recent-empty{display:flex;align-items:center;gap:15px;padding:30px 27px}
.recent-empty-icon{display:grid;place-items:center;width:47px;height:47px;border-radius:50%;background:transparent;color:#597cab;flex-shrink:0}
.recent-empty strong{font-size:13px;line-height:1.8;font-weight:550}
.recent-empty p{margin:5px 0 0;font-size:11px;line-height:1.8;color:var(--wb-muted);max-width:65ch}
.recent-empty>.workbench-link{margin-left:auto;flex-shrink:0}
.recent-list{list-style:none;margin:0;padding:0 24px}
.recent-list li{display:flex;align-items:center;gap:15px;padding:17px 0;min-width:0}
.recent-list li+li{border-top:1px solid var(--wb-line)}
.activity-marker{height:6px;width:6px;border-radius:50%;background:#78a2e7;flex-shrink:0}
.recent-log-copy{min-width:0;flex:1}
.recent-log-copy strong{font-size:12px;font-weight:550;line-height:1.8;color:var(--wb-ink)}
.recent-log-copy p{margin:3px 0 0;font-size:11px;line-height:1.8;color:var(--wb-muted);overflow-wrap:anywhere}
.recent-list time{font-size:10px;line-height:1.8;color:var(--wb-muted);white-space:nowrap;font-variant-numeric:tabular-nums}
@media(min-width:1450px){.process-steps button{padding-left:20px}.process-steps small{max-width:12em}}
@media(max-width:1100px){.workbench-columns{grid-template-columns:minmax(0,1fr)}.attention-surface .workbench-section-heading{padding-top:19px}.attention-list{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:10px 15px}.attention-row+.attention-row{border-top:0;border-radius:8px}.attention-note{padding-top:12px;padding-bottom:12px}.attention-list .attention-copy small{white-space:normal}}
@media(max-width:760px){.workbench{gap:16px}.workbench-welcome{padding:23px;gap:21px;align-items:flex-start}.welcome-copy h2{font-size:20px}.welcome-copy p{font-size:12px}.welcome-actions{padding-top:8px}.welcome-actions>span{display:none}.workbench-columns{gap:16px}.workbench-section-heading{padding:20px 20px 0}.process-steps{margin-left:12px;margin-right:12px}.process-steps button{padding-left:12px;padding-right:10px}.process-steps small{font-size:10px;max-width:7em}.step-arrow{right:5px;width:12px}.matching-progress{margin-left:22px;margin-right:22px}.attention-list{grid-template-columns:1fr;padding:10px 15px}.attention-row+.attention-row{border-top:1px solid var(--wb-line);border-radius:0 0 8px 8px}.recent-surface .workbench-section-heading{padding:18px 20px}.recent-title .quiet-label{display:none}.recent-empty{padding:26px 20px;gap:12px;align-items:flex-start;flex-wrap:wrap}.recent-empty>div{flex:1;min-width:150px}.recent-empty>.workbench-link{margin-left:59px}.recent-list{padding:0 20px}.recent-list li{gap:12px;align-items:flex-start}.activity-marker{margin-top:8px}.recent-list time{white-space:normal;max-width:85px;text-align:right}}
@media(max-width:540px){
 .workbench-welcome{flex-direction:column;padding:22px;gap:18px}
 .welcome-copy h2{font-size:19px}
 .welcome-actions{padding-top:0;display:flex;align-items:center;gap:15px;flex-wrap:wrap}
 .welcome-actions>span{display:block;font-size:10px}
 .workbench-primary{min-height:42px;font-size:12px!important;padding:0 14px}
 .workbench-section-heading{gap:8px}
 .process-surface .quiet-label{font-size:10px;max-width:6em;text-align:right}
 .process-steps{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:14px;margin-bottom:13px;gap:4px}
 .process-steps button{display:grid;grid-template-columns:40px minmax(0,1fr);grid-template-rows:14px auto auto;column-gap:9px;padding:12px 8px 16px}
 .step-number{position:static;grid-column:1;grid-row:1;justify-self:center;font-size:9px;line-height:12px}
 .step-icon{grid-column:1;grid-row:2/4;height:auto;align-self:center;justify-content:center}.step-icon :deep(.feature-icon){width:36px!important;height:36px!important}
 .process-steps strong{grid-column:2;grid-row:2;font-size:12px;white-space:normal}
 .process-steps small{grid-column:2;grid-row:3;max-width:none;font-size:9px}
 .process-steps li+li:before{display:none}
 .step-arrow{display:none}
 .matching-progress{padding-top:14px}
 .matching-progress-label{font-size:10px}
 .process-footer{padding:13px 20px;gap:8px}
 .process-footer>span{font-size:10px}
 .attention-note{padding-left:20px;padding-right:20px}
 .recent-empty-icon{width:39px;height:39px}.recent-empty-icon :deep(.feature-icon){width:39px!important;height:39px!important}
 .recent-empty>.workbench-link{margin-left:51px}
}
@media(prefers-reduced-motion:reduce){.workbench button{transition:none}}
</style>
