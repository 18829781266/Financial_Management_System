"""金额导入回归。仅使用合成夹具，不代表用户桌面文件已被验证。"""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
from helpers import install_demo_fixture
ROOT=Path(__file__).resolve().parent
ARTIFACTS=ROOT/'artifacts';ARTIFACTS.mkdir(exist_ok=True)
checks=[]
async def check(name,ok=True):
 if not ok:raise AssertionError(name)
 checks.append(name);print('PASS',name,flush=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('BROWSER_EXECUTABLE') or None,headless=True,args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(10000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await install_demo_fixture(page)
  async def state():return await page.evaluate("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')||'null')")
  async def open_import():
   await page.get_by_role('button',name='数据采集',exact=True).click();await page.get_by_role('button',name='批量导入凭证',exact=True).click();return page.locator('.batch-import-dialog')
  try:
   await page.goto(os.environ.get('BASE_URL','http://localhost:5173/'),wait_until='networkidle')
   d=await open_import();await d.locator('input[type=file]').set_input_files(str(ROOT/'manual-voucher.pdf'));await page.wait_for_function("!document.querySelector('.batch-import-dialog .upload-zone')?.disabled")
   await check('空金额没有被填成0，显示未录入',await d.get_by_role('textbox',name='金额',exact=True).input_value()=='' and await d.get_by_role('textbox',name='金额',exact=True).get_attribute('placeholder')=='未录入')
   await check('金额合计明确标示尚未填写', '1 行金额未填写' in await d.inner_text() and '金额合计 —' in await d.inner_text())
   await d.get_by_role('button',name='确认导入',exact=False).click();await check('空金额提示请填写并带文件行号','请填写金额' in await d.inner_text() and '第 1 行（manual-voucher.pdf）' in await d.inner_text() and '金额格式无效' not in await d.inner_text())
   await check('空金额输入框定位和标红',await d.get_by_role('textbox',name='金额',exact=True).evaluate("el=>el.closest('.el-input').classList.contains('invalid-field')"))
   s=await state();await check('不把空值或假金额写入凭证',s is None or len(s['vouchers'])==12)
   for label,value in [('凭证号','验收-0901'),('期间','2026-10'),('日期','2026-10-20'),('摘要','人工复核金额'),('客商名称','验收测试公司'),('金额','人民币 1,234.01 元')]:await d.get_by_role('textbox',name=label,exact=True).fill(value)
   await check('修正输入后错误实时消失且合计正确',await d.locator('.el-alert--error').count()==0 and '¥ 1,234.01' in await d.inner_text())
   for value,phrase in [('1,23','金额格式应为数字'),('1.230','金额最多支持两位小数'),('1e3','金额格式应为数字')]:
    await d.get_by_role('textbox',name='金额',exact=True).fill(value);await d.get_by_role('button',name='确认导入',exact=False).click();await check('拒绝错误格式 '+value,phrase in await d.inner_text())
   await d.get_by_role('textbox',name='金额',exact=True).fill('￥１，２３４．０１');await d.get_by_role('button',name='确认导入',exact=False).click();await page.wait_for_timeout(250)
   s=await state();await check('全角人民币金额实际导入1234.01',next(v for v in s['vouchers'] if v['no']=='验收-0901')['amount']==1234.01)
   records=[{'no':f'跨页-{i+1:04d}','period':'2026-10','date':'2026-10-20','summary':'批量跨页校验','supplier':'测试公司','amount':'2.50' if i<20 else ''} for i in range(21)]
   d=await open_import();await d.locator('input[type=file]').set_input_files({'name':'金额边界测试.json','mimeType':'application/json','buffer':json.dumps(records).encode()});await d.get_by_role('button',name='确认导入',exact=False).click()
   await check('第21行错误自动跳转到对应页',await d.get_by_role('textbox',name='凭证号',exact=True).input_value()=='跨页-0021' and '第 21 行（金' in await d.inner_text())
   await check('失败批次没有导入前20行',len((await state())['vouchers'])==13)
   await d.get_by_role('textbox',name='金额',exact=True).fill('5.25');await check('跨页修正后合计55.25', '¥ 55.25' in await d.inner_text());await d.get_by_role('button',name='确认导入',exact=False).click();await page.wait_for_timeout(250);await check('修正后21条一次提交',len((await state())['vouchers'])==34)
   await page.locator('.section-tabs').get_by_role('button',name='原始单据',exact=False).click();await page.get_by_role('button',name='批量上传单据',exact=True).click();d=page.locator('.batch-import-dialog');await d.locator('input[type=file]').set_input_files(str(ROOT/'manual-invoice.pdf'));await page.wait_for_function("!document.querySelector('.batch-import-dialog .upload-zone')?.disabled")
   for value in ['1e3','1.230','1,23']:
    await d.get_by_role('textbox',name='金额',exact=True).fill(value);await d.get_by_role('button',name='确认导入',exact=False).click();await check('单据也拒绝原始文本 '+value,await d.locator('.el-alert--error').count()>0)
   await d.get_by_role('textbox',name='金额',exact=True).fill('¥1,234.01');await d.get_by_role('button',name='确认导入',exact=False).click();await page.wait_for_timeout(250);s=await state();await check('单据金额与凭证共用相同解析结果',next(x for x in s['documents'] if x['name']=='manual-invoice.pdf')['amount']==1234.01)
   await page.reload(wait_until='networkidle');s=await state();await check('金额规范化结果刷新后保留',next(v for v in s['vouchers'] if v['no']=='验收-0901')['amount']==1234.01)
   await check('未发现浏览器运行异常',not errors);print(json.dumps({'passed':len(checks),'errors':errors,'dataSource':'synthetic fixtures only'},ensure_ascii=False))
  except Exception:
   await page.screenshot(path=str(ARTIFACTS/'money-failure.png'),full_page=True);raise
  finally:await browser.close()
asyncio.run(main())
