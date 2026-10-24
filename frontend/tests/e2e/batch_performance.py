"""Fifty real text PDFs: batch correctness, responsive work, and bounded preview.

PERF_BASELINE=1 runs the same workload without assertions for features absent in
the previous release. All generated samples and measured output stay outside the
production source and browser profiles are isolated for every run.
"""
import asyncio
import json
import os
import time
import traceback
from pathlib import Path

from playwright.async_api import async_playwright
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent
ART = ROOT / 'artifacts'
ART.mkdir(exist_ok=True)
SAMPLES = Path('/workspace/work/batch-performance-samples')
BASELINE = os.getenv('PERF_BASELINE') == '1'
BASE_URL = os.getenv('BASE_URL', 'http://localhost:5175')
PREVIEW_ROWS = int(os.getenv('PERF_PREVIEW_ROWS', '20' if BASELINE else '10'))
CHECKS = []


def samples():
    SAMPLES.mkdir(parents=True, exist_ok=True)
    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
    result = []
    for index in list(range(50)) + [900]:
        path = SAMPLES / f'合成性能发票-{index + 1:03}.pdf'
        document = canvas.Canvas(str(path), pagesize=(600, 840), pageCompression=1, invariant=1)
        document.setFont('STSong-Light', 10)
        for text, x, y in [
            ('电子发票（增值税专用发票）', 170, 790),
            ('发票号码：', 410, 760), (f'266000000000000{index + 1:05}', 465, 760),
            ('开票日期：', 410, 740), ('2026年06月30日', 465, 740),
            ('购买方名称：性能测试采购有限公司', 30, 680),
            ('销售方名称：性能测试销售有限公司', 320, 680),
            ('合计', 30, 560), (f'¥{100 + index:.2f}', 380, 560),
            ('价税合计（大写）', 30, 530), ('（小写）', 400, 530),
            (f'¥{113 + index:.2f}', 450, 530),
        ]:
            document.drawString(x, y, text)
        document.setFont('Helvetica', 7)
        for line in range(100):
            document.drawString(30 + (line % 2) * 270, 480 - (line // 2) * 8,
                                f'Synthetic performance sample {index + 1}, detail {line + 1:03}.')
        document.save()
        result.append(str(path))
    return result[:50], result[50]


INSTRUMENTATION = """(() => {
  const data = {active:0, peak:0, created:0, workers:[], longTasks:[], maxFrameGap:0,
    measuring:false, frames:0, started:0, longTaskEvents:[]};
  window.__batchPerf=data;
  const RealWorker=window.Worker;
  window.Worker=class extends RealWorker {
    constructor(...args){
      super(...args); data.created++; data.active++;data.peak=Math.max(data.peak,data.active);
      data.workers.push(String(args[0]));
      const stop=this.terminate.bind(this);let active=true;
      this.terminate=()=>{if(active){active=false;data.active--;}return stop();};
    }
  };
  let previous=0;
  const frame=now=>{if(data.measuring&&previous){data.maxFrameGap=Math.max(data.maxFrameGap,now-previous);data.frames++;}
    previous=now;requestAnimationFrame(frame);};requestAnimationFrame(frame);
  try{new PerformanceObserver(list=>{if(data.measuring)for(const entry of list.getEntries()){data.longTasks.push(entry.duration);
    data.longTaskEvents.push({duration:entry.duration,startTime:entry.startTime,
      progress:document.querySelector('.batch-reading-progress [role="status"]')?.textContent?.trim()||'',
      previewRows:document.querySelectorAll('.import-preview-table tr.el-table__row').length});}})
    .observe({type:'longtask',buffered:false});}catch{}
  window.__startBatchMeasure=()=>{data.longTasks=[];data.longTaskEvents=[];data.maxFrameGap=0;data.frames=0;data.created=0;
    data.workers=[];data.peak=data.active;data.started=performance.now();data.measuring=true;};
  window.__stopBatchMeasure=()=>{data.measuring=false;return {elapsedMs:performance.now()-data.started,
    longTaskCount:data.longTasks.length,longTaskEvents:data.longTaskEvents,longTaskTotalMs:data.longTasks.reduce((a,b)=>a+b,0),
    longestTaskMs:Math.max(0,...data.longTasks),maxFrameGapMs:data.maxFrameGap,frames:data.frames,
    workerCreated:data.created,workerPeak:data.peak,workerActive:data.active,
    pdfWorkers:data.workers.filter(url=>url.includes('pdf.worker')).length};};
})()"""


async def check(label, condition=True):
    if not condition:
        raise AssertionError(label)
    CHECKS.append(label)
    print('PASS ' + label, flush=True)


async def main():
    paths, retained = samples()
    measurements = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.getenv('BROWSER_EXECUTABLE') or None,
                                          headless=True, args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width': 1399, 'height': 800})
        page.set_default_timeout(30000)
        await page.add_init_script(INSTRUMENTATION)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        async def state():
            return await page.evaluate("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'))||{vouchers:[],documents:[],nameAssociations:[]}")

        async def nav(label):
            await page.get_by_role('button', name=label, exact=True).first.click()

        async def reading_done(dialog):
            await page.wait_for_function("""() => {
              const button=[...document.querySelectorAll('.batch-import-dialog button')]
                .find(e=>e.textContent.includes('确认导入'));
              return button&&!button.disabled;
            }""", timeout=180000)
            await check('全部样本解析成功且没有批次错误', await dialog.locator('.import-error').count() == 0)

        try:
            await page.goto(BASE_URL, wait_until='networkidle')
            measurements.update(await page.evaluate("""(() => {
              const js=performance.getEntriesByType('resource').filter(e=>/\\.m?js(?:\\?|$)/.test(e.name));
              return {initialJsDecodedBytes:js.reduce((s,e)=>s+e.decodedBodySize,0),
                initialJsEncodedBytes:js.reduce((s,e)=>s+e.encodedBodySize,0)};
            })()"""))
            await nav('数据采集')
            await page.get_by_role('button', name='原始单据', exact=False).filter(has=page.locator('svg')).first.click()
            await page.get_by_role('button', name='批量上传单据', exact=True).click()
            dialog = page.locator('.batch-import-dialog:visible')
            if not BASELINE:
                await dialog.locator('input[type=file]').set_input_files(retained)
                await reading_done(dialog)
                await check('准备已有待导入记录用于验证取消隔离', '1 份单据' in await dialog.locator('.batch-summary').inner_text())
                before = await state()
                await dialog.locator('input[type=file]').set_input_files(paths)
                # Wait until real PDF work is running so cancellation exercises an
                # active background resource rather than only the initial timer.
                await page.wait_for_function("""() => window.__batchPerf.active>0
                  && Number(document.querySelector('.batch-reading-progress')?.getAttribute('aria-valuenow')||0)>10""", timeout=30000)
                await dialog.get_by_role('button', name='取消本次读取', exact=True).click()
                await dialog.get_by_role('button', name='取消本次读取', exact=True).wait_for(state='hidden', timeout=30000)
                await page.wait_for_timeout(300)
                await check('取消批次保留之前的待导入记录', '1 份单据' in await dialog.locator('.batch-summary').inner_text()
                            and await dialog.locator('.import-preview-table tr.el-table__row').count() == 1)
                await check('取消读取不会写入业务记录', (await state())['documents'] == before['documents'])
                await check('取消正在解析的批次会释放后台worker', await page.evaluate('window.__batchPerf.active') == 0)
                await dialog.get_by_role('button', name='清空待导入', exact=True).click()
            await page.evaluate('window.__startBatchMeasure()')
            await dialog.locator('input[type=file]').set_input_files(paths)
            if not BASELINE:
                await check('批量读取显示可访问的进度条', await dialog.get_by_role('progressbar', name='文件读取进度').is_visible())
            await reading_done(dialog)
            await page.wait_for_function(
                "expected=>document.querySelectorAll('.import-preview-table tr.el-table__row').length===expected",
                arg=PREVIEW_ROWS)
            measurements['parse50'] = await page.evaluate('window.__stopBatchMeasure()')
            print('PARSE_METRICS', json.dumps(measurements['parse50']), flush=True)
            await check(f'50份PDF均进入待导入预览且按{PREVIEW_ROWS}条分页',
                        '50 份单据' in await dialog.locator('.batch-summary').inner_text()
                        and await dialog.locator('.import-preview-table tr.el-table__row').count() == PREVIEW_ROWS)
            await check('文字层准确提取金额与日期，无需人工虚构字段',
                        await dialog.locator('.import-preview-table input[aria-label="金额"]').first.input_value() == '113.00'
                        and await dialog.locator('.import-preview-table input[aria-label="日期"]').first.input_value() == '2026-06-30')
            if not BASELINE:
                await check('读取50文件期间浏览器持续绘制响应', measurements['parse50']['frames'] > 10)
                await check('导入阶段PDF worker数量有界', measurements['parse50']['workerPeak'] <= 3
                            and measurements['parse50']['pdfWorkers'] <= 2)
            await page.evaluate('window.__startBatchMeasure()')
            await dialog.get_by_role('button', name='确认导入（50）', exact=True).click()
            await page.wait_for_function("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'))?.documents.length===50", timeout=30000)
            await dialog.wait_for(state='hidden')
            measurements['commit50'] = await page.evaluate('window.__stopBatchMeasure()')
            saved = await state()
            await check('批量提交50份原件没有遗漏重复且全部待匹配', len(saved['documents']) == 50
                        and len({d['number'] for d in saved['documents']}) == 50
                        and all(d['status'] == 'pending' for d in saved['documents']))
            await check('保存的50份金额与日期准确', sorted(d['amount'] for d in saved['documents']) == list(range(113, 163))
                        and all(d['date'] == '2026-06-30' for d in saved['documents']))
            await check('50份原件付款人与收款人均从明确字段提取',
                        all(d.get('payerName') == '性能测试采购有限公司'
                            and d.get('payeeName') == '性能测试销售有限公司' for d in saved['documents']))
            await page.reload(wait_until='networkidle')
            await check('刷新后50份数据与原件引用仍完整', len((await state())['documents']) == 50
                        and all(d.get('fileId') for d in (await state())['documents']))
            await nav('智能匹配')
            await page.get_by_role('button', name='开始自动匹配', exact=True).click()
            await page.wait_for_function("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')).lastMatchRun")
            await page.evaluate('window.__startBatchMeasure()')
            await nav('电子档案')
            await page.evaluate('window.scrollTo(0,0)')
            await page.wait_for_timeout(600)
            preview = page.locator('.draft-preview')
            await check('50份同付款方单据全部关联并保留分页',
                        len((await state())['nameAssociations'][0]['documentIds']) == 50
                        and await page.locator('.draft-documents tr.el-table__row').count() == 6)
            if not BASELINE:
                before_preview = await page.evaluate('window.__batchPerf.active')
                await check('屏幕下方预览不提前打开原件worker', before_preview == 0
                            and await preview.locator('.original-document-page').count() == 0)
            await preview.scroll_into_view_if_needed()
            await page.wait_for_function("document.querySelectorAll('.draft-preview .original-document-page').length===50", timeout=180000)
            await page.wait_for_selector('.draft-preview .original-document-page[data-rendered=true]', timeout=30000)
            measurements['preview50'] = await page.evaluate('window.__stopBatchMeasure()')
            print('PREVIEW_METRICS', json.dumps(measurements['preview50']), flush=True)
            expected_files = [d['fileId'] for d in sorted((await state())['documents'],
                                                        key=lambda d: d['importSequence'], reverse=True)]
            actual_files = await preview.locator('.original-document-page').evaluate_all(
                "nodes=>nodes.map(e=>e.dataset.fileId)")
            await check('真实50页原件按最新导入顺序完整可用', actual_files == expected_files)
            if not BASELINE:
                await check('50原件预览复用一个PDF worker', measurements['preview50']['workerPeak'] <= 1
                            and measurements['preview50']['pdfWorkers'] == 1)
                await check('仅当前跨页附近绘制画布', await preview.locator('.original-document-page[data-rendered=true]').count() <= 6)
                await page.evaluate('window.scrollTo(0,0)')
                await page.wait_for_timeout(500)
                await check('预览离开视口释放已绘制画布', await preview.locator('.original-document-page[data-rendered=true]').count() == 0)
                await preview.scroll_into_view_if_needed()
                await page.wait_for_selector('.draft-preview .original-document-page[data-rendered=true]')
                await check('重新进入视口可以继续查看原件', await preview.locator('.original-document-page[data-rendered=true]').count() > 0)
            await nav('数据采集')
            await page.wait_for_timeout(400)
            await check('关闭预览后worker全部释放', await page.evaluate('window.__batchPerf.active') == 0)
            await check('批量流程没有未处理浏览器异常', not errors)
            print(json.dumps({'baseline': BASELINE, 'passed': len(CHECKS), 'checks': CHECKS,
                              'measurements': measurements, 'errors': errors}, ensure_ascii=False), flush=True)
        except Exception:
            print('PERF_FAILURE_STATE', json.dumps(await page.evaluate("""(() => ({
              workerActive:window.__batchPerf?.active,
              progress:document.querySelector('.batch-reading-progress [role="status"]')?.textContent,
              progressValue:document.querySelector('.batch-reading-progress')?.getAttribute('aria-valuenow'),
              previewRows:document.querySelectorAll('.import-preview-table tr.el-table__row').length,
              errors:[...document.querySelectorAll('.import-error')].map(e=>e.textContent)
            }))()"""), ensure_ascii=False),flush=True)
            await page.screenshot(path=str(ART / 'batch-performance-failure.png'), full_page=True)
            print('BROWSER_ERRORS', errors, flush=True)
            traceback.print_exc()
            raise
        finally:
            await browser.close()


asyncio.run(main())
