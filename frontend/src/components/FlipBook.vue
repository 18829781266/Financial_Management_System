<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { PageFlip } from 'page-flip/dist/js/page-flip.module.js'
import DocumentPage from './DocumentPage.vue'
import OriginalDocumentPage from './OriginalDocumentPage.vue'
import type {OriginalPreviewPage} from '../originalPreview'
import type {ArchiveRecord} from '../types'

const OriginalPageZoomDialog=defineAsyncComponent(()=>import('./OriginalPageZoomDialog.vue'))

const props = withDefaults(defineProps<{
  title?: string
  period?: string
  voucherNo?: string
  supplier?: string
  amount?: number
  records?:ArchiveRecord[]
}>(), { title: '会计凭证', period: '2026-09', voucherNo: '记-0028', supplier: '杭州星河科技有限公司', amount: 12800 })
const emit = defineEmits<{
  (e: 'page-change', state: { page: number; total: number }): void
  (e: 'pages-ready', pages: {label:string;recordIndex:number;pageNumber:number}[]):void
}>()
const bookElement = ref<HTMLElement | null>(null)
const stageElement = ref<HTMLElement | null>(null)
const portrait = ref(false)
let book: PageFlip | null = null
let resizeObserver: ResizeObserver | null = null
let visibilityObserver: IntersectionObserver | null = null
let resizeFrame = 0
// PDF 原件对象保持浅响应，避免 Vue 代理干扰 PDF.js 的内部实例。
const originalPages=shallowRef<OriginalPreviewPage[]>([])
const loading=ref(false)
const loadError=ref('')
const inView=ref(false)
const foreground=ref(document.visibilityState!=='hidden')
const deferred=ref(!!props.records?.length)
const currentPage=ref(0)
const zoomedPage=shallowRef<OriginalPreviewPage>()
const zoomOpen=ref(false)
function openPageZoom(page:OriginalPreviewPage){zoomedPage.value=page;zoomOpen.value=true}
const hasOriginalRecords=computed(()=>!!props.records?.length)
const singlePage=computed(()=>hasOriginalRecords.value&&originalPages.value.length===1)
const pages = computed(()=>Array.from({length:hasOriginalRecords.value?originalPages.value.length:10},(_,index)=>index))
const ready = ref(false)
let disposed=false
const originalLoadController=new AbortController()
let disposeOriginals:(()=>Promise<void>)|undefined
let initialization:Promise<void>|undefined

function reportPage() {
  if (book){currentPage.value=book.getCurrentPageIndex();emit('page-change', { page: currentPage.value, total: book.getPageCount() })}
}
function next() { void initialize().then(()=>book?.flipNext('bottom')) }
function prev() { void initialize().then(()=>book?.flipPrev('bottom')) }
function goTo(index: number) {
  void initialize().then(()=>{if(book&&index>=0&&index<book.getPageCount())book.flip(index,'bottom')})
}
function getPageCount() { return book?.getPageCount() ?? pages.value.length }
// 翻阅时只保留当前跨页及相邻页的高分辨率画布，长册也不一次绘制全部 PDF。
function nearCurrentPage(index:number){return inView.value&&foreground.value&&index>=currentPage.value-2&&index<=currentPage.value+3}
function onVisibilityChange(){foreground.value=document.visibilityState!=='hidden'}
function onKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  const target = event.target
  // 录入、下拉选择和弹窗中的方向键留给原控件，隐藏的预览也不消费键盘事件。
  if (target instanceof HTMLElement && target.closest('input,textarea,select,[contenteditable],[role="dialog"],.el-dialog')) return
  if ([...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some(dialog => dialog.getBoundingClientRect().height > 0 && dialog.getAttribute('aria-hidden') !== 'true')) return
  if (!book || !bookElement.value?.isConnected || bookElement.value.getBoundingClientRect().width === 0) return
  event.preventDefault()
  if (event.key === 'ArrowRight') next()
  else prev()
}
defineExpose({ next, prev, goTo, getPageCount })

async function loadAndInitialize(){
  deferred.value=false
  loadError.value=''
  loading.value=!!props.records?.length
  if(props.records?.length){
    try{
      // 原件读取及 PDF.js 代码均等预览接近视口后再加载，列表浏览不预开几十份 PDF。
      const {prepareOriginalPages}=await import('../originalPreview')
      if(disposed)return
      const prepared=await prepareOriginalPages(props.records,originalLoadController.signal)
      if(disposed){await prepared.dispose();return}
      disposeOriginals=prepared.dispose
      originalPages.value=prepared.pages
      emit('pages-ready',prepared.pages.map(page=>({label:page.label,recordIndex:page.recordIndex,pageNumber:page.pageNumber})))
    }catch(error){if(!disposed)loadError.value=error instanceof Error?error.message:'原件加载失败，请重新打开预览'}
    finally{if(!disposed)loading.value=false}
  }
  await nextTick()
  if (disposed || !bookElement.value || !pages.value.length) return
  if(singlePage.value){ready.value=true;emit('page-change',{page:0,total:1});return}
  // 直接使用真实 DOM 页作为纹理，由 PageFlip 计算折页曲线、背面及动态阴影。
  // 封面为硬纸页、内页为软纸页，均保留真实 DOM，可同步响应凭证字段变化。
  book = new PageFlip(bookElement.value, {
    width: 340, height: 455,
    size: 'stretch', minWidth: 220, maxWidth: 2000, minHeight: 1, maxHeight: 2677,
    maxShadowOpacity: 0.24, showCover: !hasOriginalRecords.value, drawShadow: true,
    flippingTime: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 850, usePortrait: true, startPage: hasOriginalRecords.value ? 0 : 2,
    autoSize: true, mobileScrollSupport: false,
    useMouseEvents: true, clickEventForward: true, showPageCorners: true,
    disableFlipByClick: false,
  })
  book.on('flip', reportPage)
  book.on('init', () => { ready.value = true; reportPage() })
  book.on('changeOrientation', reportPage)
  book.loadFromHTML(bookElement.value.querySelectorAll<HTMLElement>('.flip-paper'))
  // 以预览容器的实际宽度铺满双页；窄容器切为单页，并在尺寸变化后重新计算折页坐标。
  // 不只放大外层 transform，避免纸张裁切、文字大小和鼠标拖拽位置不一致。
  window.addEventListener('keydown', onKeyDown)
}
function initialize():Promise<void>{
  if(disposed||ready.value)return Promise.resolve()
  if(initialization)return initialization
  initialization=loadAndInitialize().catch(error=>{if(!disposed)loadError.value=error instanceof Error?error.message:'原件预览加载失败，请重试'}).finally(()=>{if(!ready.value)initialization=undefined})
  return initialization
}
onMounted(() => {
  document.addEventListener('visibilitychange',onVisibilityChange)
  // 延迟读取原件时先确定占位的横竖比例，防止手机首次加载后高度突变、快捷跳转偏移。
  // 这里只观察容器尺寸，不提前读取 PDF；实际翻页实例存在时才更新其坐标。
  if(stageElement.value)portrait.value=stageElement.value.clientWidth<440
  resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry || entry.contentRect.width <= 0) return
    portrait.value = entry.contentRect.width < 440
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => book?.update())
  })
  if (stageElement.value) resizeObserver.observe(stageElement.value)
  if('IntersectionObserver' in window&&stageElement.value){
    // 提前一个小视口边距准备，滚到原件处即可浏览；远离视口后停止绘制并清空画布。
    visibilityObserver=new IntersectionObserver(([entry])=>{
      inView.value=!!entry?.isIntersecting
      if(inView.value)void initialize()
    },{rootMargin:'240px 0px',threshold:0})
    visibilityObserver.observe(stageElement.value)
  }else{inView.value=true;void initialize()}
  if(!hasOriginalRecords.value)void initialize()
})
onBeforeUnmount(() => {
  disposed=true
  originalLoadController.abort()
  // PageFlip 会注册窗口事件，必须在组件销毁时释放，避免多次打开预览后重复响应。
  window.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('visibilitychange',onVisibilityChange)
  visibilityObserver?.disconnect()
  resizeObserver?.disconnect()
  cancelAnimationFrame(resizeFrame)
  book?.destroy()
  book = null
  void disposeOriginals?.()
})
</script>

<template>
  <div ref="stageElement" class="flipbook-stage" :class="{ 'is-ready': ready, 'is-portrait': portrait, 'is-single':singlePage, 'original-book':hasOriginalRecords }" :aria-busy="loading">
    <div v-if="deferred||loading||loadError" class="original-book-status" role="status"><template v-if="deferred"><span>原件预览将在滚动到此处时加载</span><button class="btn" @click="initialize">加载原件预览</button></template><template v-else-if="loadError"><span>{{loadError}}</span><button class="btn" @click="initialize">重新加载预览</button></template><span v-else>正在读取原始单据…</span></div>
    <div ref="bookElement" class="archive-flipbook" :class="{'single-original':singlePage}" aria-label="电子凭证档案册，可点击页角或拖动翻页">
      <div v-for="page in pages" :key="originalPages[page]?.key||page" class="flip-paper" :class="{ 'hard-cover': !hasOriginalRecords && (page === 0 || page === 9) }" :data-density="!hasOriginalRecords && (page === 0 || page === 9) ? 'hard' : 'soft'">
        <OriginalDocumentPage v-if="originalPages[page]" :page="originalPages[page]!" :active="nearCurrentPage(page)" zoomable @zoom="openPageZoom"/><DocumentPage v-else :page="page" :title="props.title" :period="props.period" :voucher-no="props.voucherNo" :supplier="props.supplier" :amount="props.amount" />
      </div>
    </div>
    <div class="book-ground-shadow" aria-hidden="true"></div>
  </div>
  <OriginalPageZoomDialog v-if="zoomOpen" v-model="zoomOpen" :page="zoomedPage"/>
</template>

<style scoped>
.flipbook-stage.is-single{aspect-ratio:340/455;max-width:700px;margin:auto}.single-original>.flip-paper{position:absolute;inset:0;width:100%;height:100%}.original-book .flip-paper{background:white}.original-book .flip-paper:after{box-shadow:none;background:none}.original-book-status{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:15px;text-align:center;padding:24px;font-size:14px;color:#73859e;background:#fff;z-index:3}
.flipbook-stage{position:relative;width:100%;height:auto;aspect-ratio:680/455;box-sizing:border-box;isolation:isolate}.flipbook-stage.is-portrait{aspect-ratio:340/455}.archive-flipbook{position:absolute;inset:0;margin:0 auto;width:100%;height:100%;opacity:0;transition:opacity .3s ease;z-index:2}.is-ready .archive-flipbook{opacity:1}.flip-paper{background:#fffefa;overflow:hidden;border:1px solid #e6e3dc;box-sizing:border-box;box-shadow:inset 0 0 14px rgba(113,102,84,.025)}.flip-paper:after{content:'';position:absolute;inset:0;pointer-events:none;box-shadow:inset 3px 0 9px -6px rgba(50,40,20,.5),inset -2px 0 7px -6px rgba(50,40,20,.3);z-index:2}.flip-paper.--left{border-radius:2px 0 0 2px}.flip-paper.--right{border-radius:0 2px 2px 0}.flip-paper.--left:after{background:linear-gradient(90deg,transparent 94%,rgba(93,82,59,.05) 98%,rgba(63,51,31,.11))}.flip-paper.--right:after{background:linear-gradient(90deg,rgba(63,51,31,.09),rgba(93,82,59,.025) 3%,transparent 8%)}.hard-cover{background:#d9b789;border-color:#c6a273}.book-ground-shadow{position:absolute;bottom:0;left:15%;width:70%;height:20px;z-index:0;filter:blur(10px);background:rgba(70,79,87,.12);border-radius:50%;pointer-events:none}.archive-flipbook :deep(.stf__block){box-shadow:0 4px 18px rgba(64,72,79,.06)}
.original-book .flip-paper.--left:after,.original-book .flip-paper.--right:after{background:none;box-shadow:none}
@media(prefers-reduced-motion:reduce){.archive-flipbook{transition:none}}
</style>
