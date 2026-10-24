<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
const props = withDefaults(defineProps<{
  page: number
  title?: string
  period?: string
  voucherNo?: string
  supplier?: string
  amount?: number
}>(), {
  title: '会计凭证', period: '2026-09', voucherNo: '记-0028',
  supplier: '杭州星河科技有限公司', amount: 12800,
})
const viewport = ref<HTMLElement | null>(null)
const pageScale = ref(1)
let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  if (!viewport.value) return
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry && entry.contentRect.width > 0) pageScale.value = entry.contentRect.width / 340
  })
  resizeObserver.observe(viewport.value)
})
onBeforeUnmount(() => resizeObserver?.disconnect())
const money = computed(() => props.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const date = computed(() => `${props.period}-18`)
const periodLabel = computed(() => `${props.period.split('-')[0]} 年 ${Number(props.period.split('-')[1])} 月`)
const invoiceNet = computed(() => (props.amount / 1.06).toFixed(2))
const invoiceTax = computed(() => (props.amount - props.amount / 1.06).toFixed(2))
const rows = computed(() => [
  ['支付技术服务费', '6602.01 管理费用', money.value, ''],
  ['增值税进项税额', '2221.01 应交税费', '0.00', ''],
  ['支付技术服务费', '1002.01 银行存款', '', money.value],
  ['', '', '', ''], ['', '', '', ''], ['', '', '', ''],
])
</script>

<template>
  <div ref="viewport" class="document-page-viewport">
  <article :style="{ transform: `scale(${pageScale})` }" class="document-page" :class="{ 'cover-page': page === 0 || page === 9, 'invoice-page': page === 3 || page === 4, 'catalog-page': page === 1, 'voucher-page': page === 2 }">
    <template v-if="page === 0">
      <div class="cover-top">电子会计档案 · 凭证册</div>
      <div class="cover-emblem">汇通云 · HUITONG CLOUD</div>
      <h2 class="cover-title">会计凭证</h2>
      <div class="cover-subtitle">ACCOUNTING VOUCHERS</div>
      <div class="cover-details">
        <div><span>单位名称</span><b>汇通云数字科技有限公司</b></div>
        <div><span>会计期间</span><b>{{ periodLabel }}</b></div>
        <div><span>凭证字号</span><b>{{ voucherNo }}</b></div>
        <div><span>档案编号</span><b>LC-{{ period.replace('-', '') }}-028</b></div>
        <div><span>保管期限</span><b>30 年</b></div>
      </div>
      <div class="cover-bottom"><span>完整 · 可信 · 可追溯</span><small>电子档案演示册</small></div>
    </template>

    <template v-else-if="page === 9">
      <div class="back-symbol">云</div>
      <h2 class="back-title">让每一份凭证<br>都有迹可循</h2>
      <div class="back-divider"></div>
      <p class="back-text">汇通云 · 电子会计档案</p>
      <small class="back-note">本册为交互演示数据，不作为真实财务凭证使用</small>
    </template>

    <template v-else>
      <header class="paper-header"><span>汇通云数字科技有限公司</span><span>电子会计档案</span></header>
      <div class="paper-body">
        <template v-if="page === 1">
          <div class="section-number">01 / CONTENTS</div>
          <h2 class="paper-title catalog-title">卷内文件目录</h2>
          <p class="paper-subtitle">{{ periodLabel }} · {{ voucherNo }}</p>
          <table class="catalog-table"><thead><tr><th>序号</th><th>文件名称</th><th>页码</th></tr></thead><tbody>
            <tr><td>01</td><td>记账凭证</td><td>02</td></tr>
            <tr><td>02</td><td>增值税电子普通发票</td><td>03</td></tr>
            <tr><td>03</td><td>发票查验结果</td><td>04</td></tr>
            <tr><td>04</td><td>银行电子回单</td><td>05</td></tr>
            <tr><td>05</td><td>费用支付审批单</td><td>06</td></tr>
            <tr><td>06</td><td>技术服务合同</td><td>07</td></tr>
            <tr><td>07</td><td>归档校验信息</td><td>08</td></tr>
          </tbody></table>
          <div class="catalog-info"><span class="mini-square"></span><div><b>原始单据顺序已整理</b><p>记账凭证 → 发票 → 回单 → 审批 → 合同</p></div></div>
          <div class="catalog-bottom"><div><small>档案整理</small><span>财务共享中心</span></div><div><small>保管期限</small><span>30 年</span></div></div>
        </template>

        <template v-else-if="page === 2">
          <div class="voucher-heading"><span class="voucher-mark">记</span><h2 class="paper-title">记 账 凭 证</h2><span class="voucher-mark voucher-mark-outline">01</span></div>
          <div class="voucher-meta"><span>{{ date }}</span><span>凭证字号：{{ voucherNo }}</span></div>
          <table class="voucher-table"><thead><tr><th>摘 要</th><th>会 计 科 目</th><th>借 方 金 额</th><th>贷 方 金 额</th></tr></thead><tbody><tr v-for="(row, i) in rows" :key="i"><td v-for="(cell, j) in row" :key="j">{{ cell }}</td></tr></tbody><tfoot><tr><td colspan="2">合计</td><td>{{ money }}</td><td>{{ money }}</td></tr></tfoot></table>
          <div class="voucher-total">人民币（大写）：<span>以对应原始单据金额为准</span></div>
          <div class="signatures"><span>财务主管：<b>李明</b></span><span>审核：<b>陈晓</b></span><span>制单：<b>王悦</b></span></div>
          <div class="voucher-bottom"><span>附单据 <b>5</b> 张</span><span>记账：2026-09-18</span></div>
          <div class="electronic-stamp stamp-blue">电子凭证<br><small>已归档</small></div>
        </template>

        <template v-else-if="page === 3">
          <div class="invoice-header"><div class="invoice-symbol">税</div><h2>增值税电子普通发票</h2><div class="qr-code"><i v-for="n in 49" :key="n" :class="{ dark: (n * 7 + Math.floor(n / 7) * 3) % 5 < 3 }"></i></div></div>
          <div class="invoice-meta"><span>发票号码：260920000000128028</span><span>开票日期：{{ date }}</span></div>
          <div class="invoice-parties"><div><span class="vertical-label">购<br>买<br>方</span><p>名称：汇通云数字科技有限公司<br>统一社会信用代码：91370100MA3EXAMPLE<br>地址、电话：济南市高新区浪潮路 1036 号</p></div><div><span class="vertical-label">销<br>售<br>方</span><p>名称：{{ supplier }}<br>统一社会信用代码：91330100MA2EXAMPLE<br>开户银行：中国银行杭州科技支行</p></div></div>
          <table class="invoice-table"><thead><tr><th>项目名称</th><th>数量</th><th>金额</th><th>税率</th><th>税额</th></tr></thead><tbody><tr><td>*信息技术服务*<br>软件技术服务费</td><td>1</td><td>{{ invoiceNet }}</td><td>6%</td><td>{{ invoiceTax }}</td></tr><tr><td colspan="2">合 计</td><td>{{ invoiceNet }}</td><td></td><td>{{ invoiceTax }}</td></tr></tbody></table>
          <div class="invoice-sum"><span>价税合计（小写）</span><strong>¥ {{ money }}</strong></div>
          <div class="invoice-remarks"><span>备 注</span><p>合同编号：HT-2026-0928<br>技术服务费，详见服务合同。</p></div>
          <div class="invoice-signatures"><span>收款人：周颖</span><span>复核：陈晓</span><span>开票人：李晨</span></div>
          <div class="electronic-stamp stamp-red">{{ supplier.slice(0, 8) }}<br><small>发票专用章</small></div>
        </template>

        <template v-else-if="page === 4">
          <div class="section-number">INVOICE VERIFICATION</div><h2 class="paper-title">发票查验结果</h2><p class="paper-subtitle">增值税电子普通发票</p>
          <div class="verification-badge"><span>✓</span><b>发票信息一致</b><small>演示查验结果</small></div>
          <dl class="detail-list"><div><dt>发票号码</dt><dd>260920000000128028</dd></div><div><dt>开票日期</dt><dd>{{ date }}</dd></div><div><dt>销售方名称</dt><dd>{{ supplier }}</dd></div><div><dt>含税金额</dt><dd>¥ {{ money }}</dd></div><div><dt>发票状态</dt><dd>正常</dd></div><div><dt>查验时间</dt><dd>{{ date }} 14:32:18</dd></div></dl>
          <div class="paper-notice">本页面为演示数据。正式环境需接入税务查验服务，并保存原始响应及查验时间。</div>
        </template>

        <template v-else-if="page === 5">
          <div class="bank-brand"><span class="bank-emblem">中</span><div><b>中国银行</b><small>BANK OF CHINA</small></div><span>电子回单</span></div>
          <h2 class="paper-title bank-title">客户借记回单</h2><p class="paper-subtitle">交易日期：{{ date }}　回单编号：BOC2609180028</p>
          <table class="bank-table"><tbody><tr><th>付款户名</th><td>汇通云数字科技有限公司</td></tr><tr><th>付款账号</th><td>2388 **** **** 0028</td></tr><tr><th>付款银行</th><td>中国银行济南高新支行</td></tr><tr><th>收款户名</th><td>{{ supplier }}</td></tr><tr><th>收款账号</th><td>3289 **** **** 0918</td></tr><tr><th>金额</th><td class="bank-money">人民币 ¥ {{ money }}</td></tr><tr><th>用途</th><td>技术服务费 / HT-2026-0928</td></tr><tr><th>流水号</th><td>202609180001280028</td></tr></tbody></table>
          <p class="bank-note">电子回单与纸质回单具有同等效力，请勿重复记账。</p><div class="electronic-stamp stamp-red bank-stamp">中国银行业务<br><small>电子回单专用章</small></div>
        </template>

        <template v-else-if="page === 6">
          <div class="section-number">PAYMENT APPROVAL</div><h2 class="paper-title">费用支付审批单</h2><p class="paper-subtitle">审批编号：SP-2026-0918-028</p>
          <dl class="detail-list approval-details"><div><dt>申请部门</dt><dd>信息技术部</dd></div><div><dt>申请人</dt><dd>王悦</dd></div><div><dt>付款事由</dt><dd>九月软件技术服务费</dd></div><div><dt>收款单位</dt><dd>{{ supplier }}</dd></div><div><dt>申请金额</dt><dd>¥ {{ money }}</dd></div></dl>
          <div class="approval-timeline"><div><i>✓</i><p><b>部门负责人 · 李明</b><small>同意　{{ date }} 09:18</small></p></div><div><i>✓</i><p><b>财务复核 · 陈晓</b><small>金额及附件审核无误　{{ date }} 10:32</small></p></div><div><i>✓</i><p><b>财务主管 · 张宁</b><small>同意付款　{{ date }} 11:06</small></p></div></div>
          <div class="paper-notice">审批流程已完成。电子审批记录随本册一并归档。</div>
        </template>

        <template v-else-if="page === 7">
          <div class="section-number">SERVICE AGREEMENT</div><h2 class="paper-title">技术服务合同</h2><p class="paper-subtitle">合同编号：HT-2026-0928</p>
          <div class="contract-parties"><p><b>甲方：</b>汇通云数字科技有限公司</p><p><b>乙方：</b>{{ supplier }}</p></div>
          <div class="contract-text"><h4>第一条　服务内容</h4><p>乙方为甲方提供软件系统技术支持、日常维护及相关技术咨询服务。双方依据合同约定履行各自责任。</p><h4>第二条　服务期限</h4><p>自 {{ props.period }}-01 起至 {{ props.period }}-30 止。具体服务事项以双方确认的服务清单为准。</p><h4>第三条　合同金额</h4><p>本合同含税总金额为人民币 <b>¥ {{ money }}</b> 元。乙方应按约定开具合法有效的发票。</p><h4>第四条　付款方式</h4><p>甲方在收到发票并完成内部审批后，以银行转账方式支付服务费用。</p></div>
          <div class="contract-sign"><div>甲方（盖章）<br><span>汇通云数字科技有限公司</span></div><div>乙方（盖章）<br><span>{{ supplier }}</span></div></div>
        </template>

        <template v-else-if="page === 8">
          <div class="section-number">ARCHIVE VERIFICATION</div><h2 class="paper-title">归档校验信息</h2><p class="paper-subtitle">可读 · 完整 · 可追溯</p>
          <div class="check-list"><div v-for="label in ['凭证与原始单据金额一致', '附件顺序及数量校验完成', '发票与审批记录完整', '关联关系已写入档案目录']" :key="label"><span>✓</span><p>{{ label }}</p></div></div>
          <dl class="detail-list"><div><dt>会计期间</dt><dd>{{ periodLabel }}</dd></div><div><dt>凭证范围</dt><dd>{{ voucherNo }}</dd></div><div><dt>档案状态</dt><dd>演示预览</dd></div><div><dt>整理部门</dt><dd>财务共享中心</dd></div></dl>
          <div class="hash-box"><b>SHA-256 防篡改校验</b><p>正式档案生成后，由服务端计算 PDF 文件哈希并锁定归档记录。</p><small>当前为预览演示，不代表真实存证结果。</small></div>
        </template>
      </div>
      <footer class="paper-footer"><span>演示凭证 · 仅供产品体验</span><span>{{ String(page).padStart(2, '0') }}</span></footer>
    </template>
  </article>
  </div>
</template>

<style scoped>
.document-page-viewport{width:100%;height:100%;overflow:hidden;position:relative}.document-page *{box-sizing:border-box}.document-page{transform-origin:top left;--ink:#344255;--line:#c4ccd5;box-sizing:border-box;height:455px;width:340px;background:#fffefa;color:var(--ink);font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;font-size:8px;display:flex;flex-direction:column;overflow:hidden;position:relative;padding:20px 25px 14px;background-image:linear-gradient(90deg,rgba(125,117,99,.025),transparent 7%,transparent 93%,rgba(125,117,99,.025))}.paper-header{display:flex;justify-content:space-between;color:#87909d;font-size:6.5px;border-bottom:1px solid #e6e8e9;padding-bottom:8px;letter-spacing:.4px}.paper-body{position:relative;flex:1;min-height:0;padding-top:19px}.paper-footer{display:flex;justify-content:space-between;padding-top:9px;border-top:1px solid #e4e6e8;font-size:6px;color:#9aa1aa}.paper-title{text-align:center;letter-spacing:5px;font-family:serif;font-size:21px;font-weight:600;margin:0 0 13px;color:#28384b}.paper-subtitle{text-align:center;color:#8c96a3;font-size:7px;margin:0 0 20px}.section-number{font-family:Arial,sans-serif;font-size:6px;letter-spacing:1.8px;color:#7b8c9d;margin-bottom:19px}.catalog-title{text-align:left;font-size:22px;letter-spacing:3px;margin-bottom:8px}.catalog-title+.paper-subtitle{text-align:left;margin-bottom:23px}.catalog-table{width:100%;border-collapse:collapse;font-size:8px}.catalog-table th{color:#89929e;background:#f2f5f7;font-size:7px;font-weight:400;padding:9px 7px}.catalog-table td{padding:8px 7px;border-bottom:1px solid #edf0f2}.catalog-table td:first-child{color:#8a98a8;font-family:monospace;width:25px}.catalog-table td:last-child{text-align:right;color:#8a98a8}.catalog-table th:nth-child(2){text-align:left}.catalog-info{display:flex;align-items:center;gap:9px;margin-top:23px;padding:12px 10px;background:#f4f7f6;border:1px solid #e5edeb;font-size:7px}.catalog-info b{font-weight:500;color:#45786e}.catalog-info p{font-size:6px;margin:5px 0 0;color:#92a09e}.mini-square{width:15px;height:19px;border:1px solid #8daf9f;border-radius:2px;position:relative}.mini-square:after{content:'✓';position:absolute;inset:2px;color:#689481}.catalog-bottom{display:flex;gap:50px;margin-top:22px}.catalog-bottom div{display:flex;flex-direction:column;gap:7px}.catalog-bottom small{font-size:6px;color:#9ca5af}.catalog-bottom span{font-size:7px}.voucher-heading{display:flex;align-items:center;justify-content:space-between;padding-top:3px}.voucher-heading h2{font-size:21px;margin-bottom:0;letter-spacing:4px}.voucher-mark{width:23px;height:23px;border:1px solid #8293a3;display:grid;place-items:center;font-size:12px;color:#506679}.voucher-mark-outline{border:0;color:#aab4be;font-size:9px}.voucher-meta{display:flex;justify-content:space-between;font-size:7px;color:#6b7a88;margin:22px 0 8px}.voucher-table{border:1px solid #8fa1ad;border-collapse:collapse;width:100%;table-layout:fixed;font-size:7px}.voucher-table th{font-size:6.5px;height:24px;background:#f1f5f6;font-weight:400;letter-spacing:.5px;border:1px solid #9eacb5}.voucher-table th:first-child{width:25%}.voucher-table th:nth-child(2){width:31%}.voucher-table td{border:1px solid #b8c3cb;height:29px;padding:0 6px;font-size:6.5px}.voucher-table td:nth-child(3),.voucher-table td:nth-child(4){text-align:right;font-family:Arial,sans-serif;font-size:7.5px}.voucher-table tfoot td{height:25px;background:#f7f9f9;font-weight:600}.voucher-total{border:1px solid #a9b8c2;border-top:0;padding:9px 6px;font-size:6.5px}.voucher-total span{color:#8b9299;font-size:6px}.signatures{display:flex;justify-content:space-between;margin-top:17px;font-size:6px;color:#83909b}.signatures b{font-weight:400;color:#536575;font-size:7px}.voucher-bottom{display:flex;justify-content:space-between;margin-top:22px;font-size:6px;color:#8796a2}.voucher-bottom b{color:#3e5368}.electronic-stamp{position:absolute;width:73px;height:73px;border:2px solid;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-family:serif;font-weight:600;font-size:10px;line-height:1.7;transform:rotate(-16deg);opacity:.7;pointer-events:none;letter-spacing:1px}.electronic-stamp:before{content:'';position:absolute;inset:4px;border:1px solid;border-radius:50%}.electronic-stamp small{font-size:8px;letter-spacing:0}.stamp-blue{color:#427893;right:24px;bottom:17px;width:64px;height:64px;font-size:10px;opacity:.5}.stamp-red{color:#c95d5a;right:16px;bottom:29px}.invoice-page{--ink:#8f5654;--line:#d1a7a3}.invoice-page .paper-body{padding-top:9px}.invoice-header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #b97a74;padding-bottom:7px}.invoice-header h2{font-family:serif;font-size:18px;letter-spacing:1px;font-weight:500;margin:0;color:#ac625c}.invoice-symbol{width:25px;height:25px;border:2px solid #b97a74;border-radius:50%;display:grid;place-items:center;font-family:serif;font-size:14px}.qr-code{display:grid;grid-template-columns:repeat(7,1fr);width:28px;height:28px;gap:1px;border:1px solid #eee;padding:2px}.qr-code i{background:white}.qr-code i.dark{background:#60625d}.invoice-meta{display:flex;justify-content:space-between;font-size:5.8px;margin:9px 0 6px}.invoice-parties{border:1px solid var(--line)}.invoice-parties>div{display:flex;align-items:center;border-bottom:1px solid var(--line)}.invoice-parties>div:last-child{border:0}.vertical-label{padding:6px;border-right:1px solid var(--line);text-align:center;line-height:1.4;font-size:6px;min-width:13px}.invoice-parties p{font-size:6px;line-height:1.7;margin:4px 8px;color:#6e615f}.invoice-table{width:100%;border-collapse:collapse;border:1px solid var(--line);border-top:0;font-size:5.7px}.invoice-table th{height:22px;border-bottom:1px solid var(--line);font-weight:400}.invoice-table td{height:45px;vertical-align:top;padding:8px 5px;color:#6e615f;font-size:6px}.invoice-table tr:last-child td{height:20px;padding:5px 5px;border-top:1px solid var(--line)}.invoice-sum{border:1px solid var(--line);border-top:0;padding:8px;display:flex;gap:20px;font-size:6px}.invoice-sum strong{font-family:Arial,sans-serif;font-size:9px;color:#6e615f}.invoice-remarks{display:flex;border:1px solid var(--line);border-top:0;min-height:38px;align-items:center}.invoice-remarks>span{padding:10px;border-right:1px solid var(--line);font-size:7px}.invoice-remarks p{margin:7px;font-size:6px;line-height:1.8;color:#6e615f}.invoice-signatures{display:flex;justify-content:space-between;margin-top:9px;font-size:6px}.verification-badge{display:flex;flex-direction:column;align-items:center;gap:9px;padding:12px 0 25px}.verification-badge>span{width:40px;height:40px;border-radius:50%;background:#edf5f0;color:#548f77;font-size:22px;display:grid;place-items:center}.verification-badge b{font-size:12px;font-weight:500;color:#51816c}.verification-badge small{font-size:6px;color:#96a49a}.detail-list{margin:0}.detail-list>div{display:flex;padding:10px 0;border-bottom:1px solid #edf0f2;gap:12px}.detail-list dt{width:65px;flex-shrink:0;color:#98a0aa;font-size:7px}.detail-list dd{margin:0;font-size:7px;word-break:break-all;color:#596a7b}.paper-notice{margin-top:23px;padding:11px;background:#f4f6f7;color:#96a0aa;font-size:6px;line-height:1.9}.bank-brand{display:flex;align-items:center;gap:6px;color:#a14f51;margin-bottom:24px}.bank-emblem{font-family:serif;width:24px;height:24px;display:grid;place-items:center;border:2px solid #a14f51;border-radius:50%;font-size:15px}.bank-brand b{display:block;font-family:serif;font-size:13px;letter-spacing:2px}.bank-brand small{font-family:Arial,sans-serif;font-size:4px;letter-spacing:.7px}.bank-brand>span:last-child{margin-left:auto;font-size:8px;color:#8a939c}.bank-title{font-size:20px;letter-spacing:4px;margin-bottom:10px}.bank-title+.paper-subtitle{font-size:6px;margin-bottom:15px}.bank-table{width:100%;border-collapse:collapse;font-size:7px;border:1px solid #b4bbc2}.bank-table th{width:60px;font-size:7px;font-weight:400;color:#84909c;background:#f6f7f8}.bank-table th,.bank-table td{border:1px solid #c5cbd1;padding:11px 9px}.bank-table .bank-money{font-weight:600;font-size:9px}.bank-note{font-size:6px;color:#a2a8b0;margin-top:13px}.bank-stamp{bottom:15px;right:22px}.approval-details>div{padding:10px 0}.approval-timeline{margin-top:22px;display:flex;flex-direction:column;gap:21px}.approval-timeline>div{display:flex;gap:12px;position:relative}.approval-timeline>div:not(:last-child):after{content:'';position:absolute;left:10px;top:23px;height:24px;border-left:1px solid #d9e7df}.approval-timeline i{font-style:normal;color:#7c9e8e;background:#eef5f1;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;font-size:10px}.approval-timeline p{margin:1px 0 0;display:flex;flex-direction:column;gap:6px}.approval-timeline b{font-size:8px;font-weight:400}.approval-timeline small{font-size:6px;color:#99a4ae}.contract-parties{font-size:7px;line-height:2.1;margin-top:23px}.contract-parties p{margin:4px 0}.contract-text h4{font-size:8px;font-weight:500;margin:18px 0 6px}.contract-text p{font-family:serif;font-size:8px;line-height:1.9;color:#75808d;text-align:justify;margin:0}.contract-sign{display:flex;justify-content:space-between;margin-top:24px;font-size:7px;line-height:2}.contract-sign span{font-size:5px;color:#89949f}.check-list{padding:9px 0 20px}.check-list>div{display:flex;align-items:center;gap:9px;padding:8px 0}.check-list span{display:grid;place-items:center;width:16px;height:16px;border-radius:50%;background:#edf4f0;color:#6d9b85;font-size:9px}.check-list p{font-size:8px;margin:0;color:#62798a}.hash-box{margin-top:24px;padding:14px;background:#f5f7f8;border:1px solid #e6ebee}.hash-box b{font-size:8px;font-weight:500}.hash-box p{font-size:6.5px;color:#8c99a6;line-height:1.8}.hash-box small{font-size:6px;color:#a1aab2}.cover-page{background:#d9b789;background-image:linear-gradient(100deg,rgba(92,63,29,.15),transparent 8%,transparent 95%,rgba(92,63,29,.12)),radial-gradient(ellipse at 10% 10%,rgba(255,240,209,.4),transparent 70%);padding:28px 31px;color:#6c5335}.cover-top{font-size:7px;letter-spacing:2px;border-bottom:1px solid rgba(100,74,40,.25);padding-bottom:12px}.cover-emblem{margin-top:30px;font-size:6px;letter-spacing:2px;opacity:.6;text-align:center}.cover-title{font-family:serif;text-align:center;font-size:36px;font-weight:500;letter-spacing:12px;margin:21px -12px 8px 0}.cover-subtitle{text-align:center;font-size:7px;letter-spacing:3px;opacity:.7}.cover-details{margin-top:32px;border:1px solid #96734a;padding:3px}.cover-details>div{display:flex;min-height:28px;align-items:center;border-bottom:1px solid #a98960;font-size:7px}.cover-details>div:last-child{border:0}.cover-details span{width:59px;text-align:center;align-self:stretch;border-right:1px solid #a98960;display:grid;place-items:center;letter-spacing:1px}.cover-details b{font-weight:400;padding-left:12px;font-size:7px}.cover-bottom{margin-top:auto;padding-top:28px;display:flex;flex-direction:column;align-items:center;gap:10px}.cover-bottom>span{font-size:7px;letter-spacing:3px}.cover-bottom small{font-size:5px;opacity:.6}.back-symbol{border:1px solid #9d7b51;width:40px;height:40px;display:grid;place-items:center;font-size:23px;font-family:serif;margin:auto auto 22px}.back-title{text-align:center;font-family:serif;letter-spacing:4px;font-size:25px;font-weight:400;line-height:1.7;margin:0}.back-divider{width:24px;border-top:1px solid #9d7b51;margin:24px auto 12px}.back-text{text-align:center;font-size:8px;letter-spacing:2px}.back-note{font-size:5px;text-align:center;opacity:.5;margin-top:auto;padding-top:55px}
.catalog-page .section-number{margin-bottom:12px}.catalog-page .catalog-title+.paper-subtitle{margin-bottom:14px}.catalog-page .catalog-table th{padding:6px 7px;white-space:nowrap}.catalog-page .catalog-table td{padding:5px 7px}.catalog-page .catalog-table td:first-child{width:32px}.catalog-page .catalog-info{margin-top:16px;padding:8px 10px}.catalog-page .catalog-bottom{margin-top:12px}.voucher-page .voucher-meta{margin-top:16px}.voucher-page .signatures{margin-top:12px}.voucher-page .voucher-bottom{margin-top:10px}
</style>
