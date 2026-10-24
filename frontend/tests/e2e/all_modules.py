import asyncio,json,hashlib,traceback,os
from pathlib import Path
from playwright.async_api import async_playwright
from helpers import install_demo_fixture,select_archive_range
ROOT=Path(__file__).resolve().parent
ARTIFACTS=ROOT/'artifacts';ARTIFACTS.mkdir(exist_ok=True)
F=ROOT
results=[]
async def check(name,condition=True):
 if not condition:raise AssertionError(name)
 results.append(name);print('PASS',name,flush=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('BROWSER_EXECUTABLE') or None,headless=True,args=['--no-sandbox'])
  context=await browser.new_context(viewport={'width':1536,'height':1100},accept_downloads=True)
  page=await context.new_page();page.set_default_timeout(10000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  async def nav(label):
   await page.get_by_role('button',name=label,exact=True).first.click()
   titles={'工作台':'财务档案工作台','数据采集':'数据采集','智能匹配':'智能凭证匹配','异常处理':'异常处理','规则配置':'匹配规则配置','操作日志':'操作日志','电子档案':'电子会计档案'}
   await page.locator('h1').filter(has_text=titles[label]).wait_for(state='visible')
  await install_demo_fixture(page)
  async def state():return await page.evaluate("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')||'null')")
  async def modal():return page.locator('.batch-import-dialog').last
  async def choose(files,kind='vouchers'):
   await nav('数据采集')
   await page.get_by_role('button',name='记账凭证' if kind=='vouchers' else '原始单据',exact=False).filter(has=page.locator('svg')).first.click()
   await page.get_by_role('button',name='批量导入凭证' if kind=='vouchers' else '批量上传单据',exact=True).click()
   m=await modal();await m.locator('input[type=file]').set_input_files([str(F/x) for x in files]);await page.wait_for_function("!document.querySelector('.batch-import-dialog .upload-zone')?.disabled");return m
  async def import_data(files):
   m=await choose(files);await m.get_by_role('button',name='确认导入',exact=False).click();await m.wait_for(state='hidden')
  async def search(q):await page.get_by_role('textbox',name='搜索凭证或单据',exact=True).fill(q);await page.wait_for_timeout(200)
  async def close_dialog(selector='.el-dialog'):
   d=page.locator(selector+':visible').last;await d.get_by_role('button',name='关闭',exact=True).last.click()
  try:
   await page.goto(os.environ.get('BASE_URL','http://localhost:5173/'),wait_until='networkidle')
   await page.locator('.section-tabs').get_by_role('button',name='档案册管理',exact=False).click()
   await check('测试夹具档案册4本、10页翻阅',await page.locator('.book-card').count()==4 and await page.locator('.flip-paper').count()==10)
   original=await page.locator('.page-controls').inner_text();await page.get_by_role('button',name='下一页',exact=True).click();await page.wait_for_timeout(1000)
   await check('下一页实际改变页码',await page.locator('.page-controls').inner_text()!=original)
   await page.get_by_role('button',name='目录',exact=True).click();await page.locator('.catalog-popup').get_by_role('button',name='银行电子回单',exact=False).click();await page.wait_for_timeout(950)
   await check('目录跳转',not await page.locator('.catalog-popup').count())
   await page.get_by_role('button',name='查看封面',exact=True).click();await page.wait_for_timeout(950)
   await check('封面跳转','01' in await page.locator('.page-controls').inner_text())
   for name in ['工作台','数据采集','智能匹配','异常处理','规则配置','操作日志','电子档案']:
    await nav(name);await check('模块可打开：'+name,await page.locator('h1').count()==1)
   m=await choose(['棺恒-凭证.pdf'])
   await check('截图PDF进入人工补录流程，无JSON异常',await m.locator('.import-preview-table .el-table__row').count()==1)
   await m.get_by_role('button',name='确认导入',exact=False).click()
   await check('未补齐字段不能导入',await m.locator('.el-alert--error').count()>0 and not any('Unexpected token' in x for x in await m.all_text_contents()))
   for label,value in [('凭证号','影像-0200'),('期间','2026-10'),('日期','2026-10-20'),('摘要','E2E影像凭证'),('客商名称','测试有限公司'),('金额','5400')]:await m.get_by_role('textbox',name=label,exact=True).fill(value)
   await m.get_by_role('button',name='确认导入',exact=False).click();await page.wait_for_timeout(350)
   s=await state();await check('PDF凭证导入成功且仅显示待匹配',any(v['no']=='影像-0200' and v.get('fileId') and v['status']=='pending' and not v.get('matchReviewRequired') for v in s['vouchers']) and await page.locator('.records-panel .review-hint').count()==0)
   await search('影像-0200');await page.get_by_role('button',name='原件',exact=True).click();await page.wait_for_timeout(300)
   await check('PDF原件可查看',await page.locator('.file-preview-body iframe').count()==1)
   async with page.expect_download() as download:
    await page.get_by_role('link',name='下载原件',exact=True).click()
   d=await download.value;await d.save_as(str(ARTIFACTS/'original-download.pdf'));await check('原件下载字节一致',Path(str(ARTIFACTS/'original-download.pdf')).read_bytes()==(F/'棺恒-凭证.pdf').read_bytes())
   await close_dialog('.file-preview-dialog');await page.reload(wait_until='networkidle');await nav('数据采集');await search('影像-0200');await page.get_by_role('button',name='原件',exact=True).click();await page.wait_for_timeout(300)
   await check('刷新后PDF原件仍可预览',await page.locator('.file-preview-body iframe').count()==1);await close_dialog('.file-preview-dialog')
   m=await choose(['bad.json']);await check('非法JSON展示中文校验错误',await m.locator('.el-alert--error').count()>0);await m.get_by_role('button',name='取消',exact=True).click()
   m=await choose(['bad.pdf']);await check('伪造PDF拒绝且无待导入行',await m.locator('.el-alert--error').count()>0 and not await m.locator('.import-preview-table').count());await m.get_by_role('button',name='取消',exact=True).click()
   await import_data(['batch.json','batch.csv']);s=await state();await check('多文件JSON+CSV共3条批量导入',sum(v['no'].startswith('测试-01') for v in s['vouchers'])==3)
   before=len(s['vouchers']);m=await choose(['batch.json']);await m.get_by_role('button',name='确认导入',exact=False).click();await check('重复凭证整批拒绝',await m.locator('.el-alert--error').count()>0 and len((await state())['vouchers'])==before);await m.get_by_role('button',name='取消',exact=True).click()
   await search('测试-01');await page.locator('.records-panel .el-table__header-wrapper .el-checkbox').first.check();await page.get_by_role('button',name='批量删除',exact=True).click();await page.get_by_role('button',name='取消',exact=True).last.click();await check('批量删除取消不改变数据',len((await state())['vouchers'])==before)
   await page.get_by_role('button',name='批量删除',exact=True).click();await page.get_by_role('button',name='确认删除',exact=True).click();await page.wait_for_timeout(300);await check('凭证列表3条批量删除成功',len((await state())['vouchers'])==before-3)
   await search('记-0001');await check('归档凭证勾选框禁用',await page.locator('.records-panel .el-table__body-wrapper .el-checkbox input').first.is_disabled())
   await import_data(['pagination.json']);await search('翻页-');await check('列表真实分页默认10条',await page.locator('.records-panel .el-table__body-wrapper tr.el-table__row').count()==10);await page.locator('.el-pagination .btn-next').click();await check('下一页可操作','2' in await page.locator('.el-pagination .is-active').inner_text())
   m=await choose(['测试单据一.pdf','测试单据二.pdf'],'documents');await m.get_by_role('button',name='确认导入',exact=False).click();await page.wait_for_timeout(300);s=await state();await check('原始单据批量上传两份待匹配且字段复核独立保留',sum(d['name'].startswith('测试单据') and d.get('extractionStatus')=='pending' and d['status']=='pending' and not d.get('matchReviewRequired') for d in s['documents'])==2 and await page.locator('.records-panel .review-hint').count()==0)
   await search('测试单据一');await page.get_by_role('button',name='补录复核',exact=True).click();ed=page.locator('.el-dialog:visible').last
   for label,value in [('客商名称','测试有限公司'),('日期','2026-10-20'),('金额（元）','129.99'),('单据编号','UI-INV-1')]:await ed.locator('.el-form-item').filter(has=page.locator('.el-form-item__label',has_text=label)).locator('input').first.fill(value)
   await ed.locator('.el-checkbox').filter(has_text='已人工核验发票印章').click();await ed.get_by_role('button',name='保存并复核',exact=True).click();await page.wait_for_timeout(200)
   await check('单据补录复核生效',next(d for d in (await state())['documents'] if d['name']=='测试单据一.pdf')['extractionStatus']=='reviewed')
   await import_data(['matching.json']);await nav('智能匹配');await page.get_by_role('button',name='开始自动匹配',exact=True).click();await page.wait_for_timeout(800);s=await state();await check('自动匹配包括新导入数据及原始4组',next(v for v in s['vouchers'] if v['no']=='关联-0101')['status']=='matched' and sum(v['status']=='matched' for v in s['vouchers'])==11)
   await nav('异常处理');await page.get_by_role('button',name='请复核单据',exact=False).click();await search('测试单据二');await check('异常池可查询孤儿请复核单据',await page.locator('.records-panel .status').first.inner_text()=='请复核' and await page.locator('.records-panel .review-hint').count()==0 and next(d for d in (await state())['documents'] if d['name']=='测试单据二.pdf')['extractionStatus']=='pending' and next(d for d in (await state())['documents'] if d['name']=='测试单据二.pdf')['matchReviewRequired']==True)
   await nav('数据采集');await page.locator('.section-tabs').get_by_role('button',name='记账凭证',exact=False).first.click();await search('影像-0200');await page.get_by_role('button',name='标记缺失',exact=True).click();ed=page.locator('.el-dialog:visible').last;await ed.locator('textarea').fill('等待补充回单');await ed.get_by_role('button',name='保存',exact=True).click();await page.wait_for_timeout(200);await check('缺失原因记入凭证',next(v for v in (await state())['vouchers'] if v['no']=='影像-0200')['status']=='missing')
   await page.get_by_role('button',name='恢复待匹配',exact=True).click();await check('附件缺失可恢复待匹配',next(v for v in (await state())['vouchers'] if v['no']=='影像-0200')['status']=='pending')
   await nav('规则配置');await page.locator('.rule-card').first.locator('.el-switch').click();await check('规则启停可保存',(await state())['rules'][0]['enabled']==False);await page.locator('.rule-card').first.locator('.el-switch').click();await page.get_by_role('button',name='配置规则',exact=True).first.click();ed=page.locator('.el-dialog:visible').last;await ed.get_by_role('button',name='保存',exact=True).click();await check('规则参数保存并记录日志',(await state())['logs'][0]['action']=='更新匹配规则')
   await nav('电子档案');await page.get_by_role('button',name='生成档案册',exact=True).first.click();ed=page.locator('.el-dialog:visible').last;await select_archive_range(ed,'2026-10','记-0007','记-0010');await ed.get_by_role('button',name='校验并生成',exact=True).click();await page.wait_for_function("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')).archives[0].fileId",timeout=45000);s=await state();await check('生成实际档案PDF并持久化SHA256',len(s['archives'])==5 and len(s['archives'][0].get('hash',''))==64 and bool(s['archives'][0].get('fileId')))
   async with page.expect_download(timeout=60000) as download:await page.get_by_role('button',name='导出档案册',exact=True).click()
   d=await download.value;await d.save_as(str(ARTIFACTS/'full-regression-archive.pdf'));actual=hashlib.sha256(Path(str(ARTIFACTS/'full-regression-archive.pdf')).read_bytes()).hexdigest();s=await state();await check('档案下载SHA256与存证值一致',actual==s['archives'][0]['hash'])
   async with page.expect_download(timeout=60000) as download:await page.get_by_role('button',name='导出档案册',exact=True).click()
   d=await download.value;await d.save_as(str(ARTIFACTS/'full-regression-archive-repeat.pdf'));await check('重复下载同一档案字节不变',Path(str(ARTIFACTS/'full-regression-archive.pdf')).read_bytes()==Path(str(ARTIFACTS/'full-regression-archive-repeat.pdf')).read_bytes())
   await page.get_by_role('button',name='归档记录',exact=True).click();await check('归档记录能查看新册',await page.locator('.panel .el-table__body-wrapper .el-table__row').count()==5)
   await page.get_by_role('textbox',name='全局搜索').fill('UI-INV-1');await page.get_by_role('textbox',name='全局搜索').press('Enter');await check('全局发票号检索返回凭证',await page.locator('.voucher-number').first.inner_text()=='关联-0101');await page.get_by_role('button',name='关联穿透',exact=True).click();await check('关联穿透包含原始单据',await page.locator('.evidence-node').count()==2);await close_dialog()
   await nav('数据采集');await page.get_by_role('button',name='原始单据',exact=False).filter(has=page.locator('svg')).first.click();await search('测试单据');await page.locator('.records-panel .el-table__header-wrapper .el-checkbox').first.check();await page.get_by_role('button',name='批量删除',exact=True).click();await page.get_by_role('button',name='确认删除',exact=True).click();await page.wait_for_timeout(300);s=await state();await check('批量删除单据解除未归档匹配',not any(d['name'].startswith('测试单据') for d in s['documents']) and next(v for v in s['vouchers'] if v['no']=='关联-0101')['status']=='pending')
   await search('');await page.get_by_role('button',name='筛选',exact=True).click();await check('高级金额筛选可展开',await page.locator('.advanced-filters').count()==1)
   await nav('操作日志');s=await state();await check('审计日志含批量导入删除复核',all(action in {l['action'] for l in s['logs']} for action in ['批量导入凭证','批量删除凭证','批量删除单据','复核单据']))
   await page.get_by_role('button',name='使用帮助',exact=True).click();await check('帮助说明可打开',await page.get_by_text('使用帮助与系统说明',exact=True).last.is_visible());await page.locator('.el-dialog:visible .el-dialog__headerbtn').last.click()
   await page.set_viewport_size({'width':390,'height':844});await nav('数据采集');await check('手机列表无页面级横向溢出',await page.evaluate('document.body.scrollWidth<=innerWidth'))
   await page.screenshot(path=str(ARTIFACTS/'all-modules-mobile.png'),full_page=True)
   await check('无未处理浏览器运行异常',not errors)
   print(json.dumps({'passed':len(results),'errors':errors,'checks':results},ensure_ascii=False),flush=True)
  except Exception:
   await page.screenshot(path=str(ARTIFACTS/'regression-failure.png'),full_page=True);print('ERRORS',errors,flush=True);traceback.print_exc();raise
  finally:await browser.close()
asyncio.run(main())
