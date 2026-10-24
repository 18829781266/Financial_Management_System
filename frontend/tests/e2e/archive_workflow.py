import asyncio,json,hashlib,traceback,os
from pathlib import Path
from playwright.async_api import async_playwright
from helpers import install_demo_fixture,select_archive_range
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parent
ARTIFACTS=ROOT/'artifacts';ARTIFACTS.mkdir(exist_ok=True)
F=ROOT
checks=[]
async def check(name,yes=True):
 if not yes:raise AssertionError(name)
 checks.append(name);print('PASS',name,flush=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('BROWSER_EXECUTABLE') or None,headless=True,args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':1440,'height':1080},accept_downloads=True);page.set_default_timeout(10000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  async def nav(label):
   await page.get_by_role('button',name=label,exact=True).first.click()
   titles={'工作台':'财务档案工作台','数据采集':'数据采集','智能匹配':'智能凭证匹配','异常处理':'异常处理','规则配置':'匹配规则配置','操作日志':'操作日志','电子档案':'电子会计档案'}
   await page.locator('h1').filter(has_text=titles[label]).wait_for(state='visible')
  await install_demo_fixture(page)
  async def state():return await page.evaluate("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')||'null')")
  async def search(q):await page.get_by_role('textbox',name='搜索凭证或单据',exact=True).fill(q);await page.wait_for_timeout(150)
  async def tab(name):await page.locator('.section-tabs').get_by_role('button',name=name,exact=False).first.click()
  async def manual():
   await nav('数据采集');await tab('记账凭证');await search('手工-0101');await page.get_by_role('button',name='手工匹配',exact=True).click();d=page.locator('.el-dialog:visible').last;await d.locator('.candidate-list .el-checkbox').filter(has_text='manual-invoice.pdf').click();return d
  try:
   await page.goto(os.environ.get('BASE_URL','http://localhost:5173/'),wait_until='networkidle');await nav('数据采集')
   await page.get_by_role('button',name='批量导入凭证',exact=True).click();d=page.locator('.batch-import-dialog');
   async with page.expect_download() as download:await d.get_by_role('button',name='JSON 模板',exact=True).click()
   downloaded=await download.value;await downloaded.save_as(str(ARTIFACTS/'template-check.json'));await check('批量JSON模板下载可解析且含两行',len(json.loads(Path(str(ARTIFACTS/'template-check.json')).read_text())['vouchers'])==2)
   await d.locator('input[type=file]').set_input_files(str(F/'manual-voucher.pdf'));await page.wait_for_function("!document.querySelector('.batch-import-dialog .upload-zone')?.disabled")
   for name,value in [('凭证号','手工-0101'),('期间','2026-10'),('日期','2026-10-20'),('摘要','原件归档验收'),('客商名称','测试有限公司'),('金额','100')]:await d.get_by_role('textbox',name=name,exact=True).fill(value)
   await d.get_by_role('button',name='确认导入',exact=False).click();await page.wait_for_timeout(200)
   await tab('原始单据');await page.get_by_role('button',name='批量上传单据',exact=True).click();d=page.locator('.batch-import-dialog');await d.locator('input[type=file]').set_input_files(str(F/'manual-invoice.pdf'));await page.wait_for_function("!document.querySelector('.batch-import-dialog .upload-zone')?.disabled")
   for name,value in [('客商名称','测试有限公司'),('日期','2026-10-20'),('金额','100'),('单据编号','MAN-INV-1')]:await d.get_by_role('textbox',name=name,exact=True).fill(value)
   await d.get_by_role('button',name='确认导入',exact=False).click();await page.wait_for_timeout(200)
   d=await manual();await d.get_by_role('button',name='确认关联',exact=True).click();s=await state();await check('手工匹配缺少原因时不写关联',next(v for v in s['vouchers'] if v['no']=='手工-0101')['status']=='pending')
   await d.locator('textarea').fill('已核对原件、日期与金额');await d.get_by_role('button',name='确认关联',exact=True).click();await page.wait_for_timeout(200);await check('实际UI手工匹配成功',next(v for v in (await state())['vouchers'] if v['no']=='手工-0101')['status']=='matched')
   await nav('数据采集');await tab('记账凭证');await search('手工-0101');await page.get_by_role('button',name='解除匹配',exact=True).click();prompt=page.locator('.el-message-box');await prompt.locator('input').fill('重新复核附件');await prompt.get_by_role('button',name='确认解除',exact=True).click();await page.wait_for_timeout(200);await check('解除匹配返还凭证和单据',next(v for v in (await state())['vouchers'] if v['no']=='手工-0101')['status']=='pending')
   d=await manual();await d.locator('textarea').fill('再次核对原件，确认一致');await d.get_by_role('button',name='确认关联',exact=True).click();await page.wait_for_timeout(150)
   await nav('电子档案');await page.get_by_role('button',name='生成档案册',exact=True).first.click();d=page.locator('.el-dialog:visible').last
   await select_archive_range(d,'2026-10','手工-0101','手工-0101');await d.get_by_role('button',name='校验并生成',exact=True).click();await page.wait_for_timeout(300)
   await check('缺章发票阻止归档且无半成品',(await state())['archives'].__len__()==4 and await d.is_visible());await d.get_by_role('button',name='取消',exact=True).click()
   await nav('数据采集');await tab('原始单据');await search('manual-invoice');await page.get_by_role('button',name='核验印章',exact=True).click();await page.get_by_role('button',name='已核验，确认有章',exact=True).click();await page.wait_for_timeout(150);await check('匹配后仍可进行人工印章核验',next(d for d in (await state())['documents'] if d['name']=='manual-invoice.pdf')['seal'])
   await nav('电子档案');await page.get_by_role('button',name='生成档案册',exact=True).first.click();d=page.locator('.el-dialog:visible').last;await select_archive_range(d,'2026-10','手工-0101','手工-0101');await d.get_by_role('button',name='校验并生成',exact=True).click();await page.wait_for_function("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')).archives[0].fileId",timeout=45000)
   async with page.expect_download() as download:await page.get_by_role('button',name='导出档案册',exact=True).click()
   result=await download.value;await result.save_as(str(ARTIFACTS/'actual-merged-archive.pdf'));pdf=PdfReader(str(ARTIFACTS/'actual-merged-archive.pdf'));await check('归档保留两份真实PDF原件的页数',len(pdf.pages)==2);await check('凭证在前、原始单据在后的内容顺序正确','VOUCHER ORIGINAL' in pdf.pages[0].extract_text() and 'INVOICE ORIGINAL' in pdf.pages[1].extract_text())
   before=(await state())['archives'][0]['hash'];await page.reload(wait_until='networkidle');await check('刷新后档案哈希和文件ID仍保留',(await state())['archives'][0]['hash']==before and bool((await state())['archives'][0]['fileId']));await tab('档案册管理')
   async with page.expect_download() as download:await page.get_by_role('button',name='导出档案册',exact=True).click()
   result=await download.value;await result.save_as(str(ARTIFACTS/'actual-merged-reload.pdf'));await check('刷新后下载字节和SHA256不变',hashlib.sha256(Path(str(ARTIFACTS/'actual-merged-reload.pdf')).read_bytes()).hexdigest()==before)
   await page.get_by_title('全屏预览').click();await check('档案全屏可进入',await page.evaluate('!!document.fullscreenElement'));await page.get_by_title('全屏预览').click();await check('档案全屏可退出',not await page.evaluate('!!document.fullscreenElement'))
   await nav('数据采集');await search('手工-0101');await check('新生成档案的凭证删除保护生效',await page.locator('.records-panel .el-table__body-wrapper .el-checkbox input').first.is_disabled())
   await tab('原始单据');await search('manual-invoice');await check('新生成档案的单据删除保护生效',await page.locator('.records-panel .el-table__body-wrapper .el-checkbox input').first.is_disabled())
   async with page.expect_download() as download:await page.get_by_title('导出检索结果 CSV').click()
   result=await download.value;await result.save_as(str(ARTIFACTS/'document-export.csv'));await check('单据CSV导出当前检索结果与正确列名','单据编号' in Path(str(ARTIFACTS/'document-export.csv')).read_text() and 'MAN-INV-1' in Path(str(ARTIFACTS/'document-export.csv')).read_text())
   await page.get_by_role('button',name='筛选',exact=True).click();await page.locator('.advanced-filters input').nth(0).fill('101');await page.locator('.advanced-filters input').nth(1).fill('200');await page.locator('.advanced-filters input').nth(1).press('Tab');await page.wait_for_timeout(200);await check('单据金额范围筛选实际生效',await page.locator('.records-panel .el-table__body-wrapper tr.el-table__row').count()==0);await page.get_by_role('button',name='清空条件',exact=True).click()
   await page.get_by_title('重置并清空数据').click();await page.get_by_role('button',name='取消',exact=True).last.click();await check('重置取消保留数据',len((await state())['vouchers'])==13)
   await page.get_by_title('重置并清空数据').click();await page.get_by_role('button',name='重置',exact=True).click()
   await page.wait_for_function("(()=>{const s=JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'));return s&&['vouchers','documents','archives','logs','payerGroups','nameAssociations'].every(key=>Array.isArray(s[key])&&s[key].length===0)&&!s.lastMatchRun;})()")
   s=await state();await check('重置清空全部记录档案日志与关联',all(len(s[key])==0 for key in ['vouchers','documents','archives','logs','payerGroups','nameAssociations']) and not s.get('lastMatchRun'))
   files=await page.evaluate('''async()=>{const open=indexedDB.open('langchao-files-v1',1);await new Promise((resolve,reject)=>{open.onsuccess=resolve;open.onerror=reject;});const db=open.result;try{if(!db.objectStoreNames.contains('files'))return 0;const count=db.transaction('files').objectStore('files').count();await new Promise((resolve,reject)=>{count.onsuccess=resolve;count.onerror=reject;});return count.result;}finally{db.close();}}''')
   await check('重置清空IndexedDB原件与档案PDF',files==0 and await page.evaluate("localStorage.getItem('langchao:last-export-hash')===null"))
   await page.reload(wait_until='networkidle');s=await state();await check('重置后刷新保持全空不恢复演示夹具',all(len(s[key])==0 for key in ['vouchers','documents','archives','logs','payerGroups','nameAssociations']))
   await nav('数据采集')
   await page.set_viewport_size({'width':390,'height':844});await tab('记账凭证');await page.get_by_role('button',name='批量导入凭证',exact=True).click();await check('手机批量导入对话框不超出页面',await page.evaluate('document.body.scrollWidth<=innerWidth'));await page.screenshot(path=str(ARTIFACTS/'batch-import-mobile.png'),full_page=True)
   await check('补充流程无浏览器异常',not errors);print(json.dumps({'passed':len(checks),'errors':errors,'checks':checks},ensure_ascii=False),flush=True)
  except Exception:
   await page.screenshot(path=str(ARTIFACTS/'remaining-failure.png'),full_page=True);print('errors',errors);traceback.print_exc();raise
  finally:await browser.close()
asyncio.run(main())
