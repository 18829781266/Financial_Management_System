"""Visual navigation, readable typography and responsive layouts; isolated fixtures."""
import asyncio,json,os,traceback
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent;ART=ROOT/'artifacts';ART.mkdir(exist_ok=True);checks=[]
async def check(label,condition=True):
 if not condition:raise AssertionError(label)
 checks.append(label);print('PASS '+label,flush=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.getenv('BROWSER_EXECUTABLE') or None,headless=True,args=['--no-sandbox']);page=await browser.new_page(viewport={'width':1536,'height':1100});page.set_default_timeout(15000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  async def nav(label):await page.get_by_role('button',name=label,exact=True).first.click()
  async def no_overflow():return await page.evaluate('document.body.scrollWidth<=innerWidth')
  async def screenshot(name):await page.screenshot(path=str(ART/('visual-'+name+'.png')),full_page=True)
  try:
   await page.goto(os.getenv('BASE_URL','http://localhost:5174'),wait_until='networkidle')
   await check('视觉升级仍从空白业务数据开始',await page.locator('.book-card').count()==0 and await page.locator('.metrics .metric strong').all_inner_texts()==['0册','0张','0.0%','0张'])
   await check('七个导航均使用独立双色SVG图标',await page.locator('.nav-item>.feature-icon').count()==7 and await page.locator('.nav-item>.feature-icon>svg').count()==7)
   await check('桌面深色导航与主页面布局无横向溢出',await no_overflow());await screenshot('empty-archives')
   await nav('工作台');await check('工作台显示视觉欢迎区域且没有注入演示记录',await page.locator('.workspace-hero').count()==1 and await page.locator('.metric strong').first.inner_text()=='0张');await screenshot('overview')
   await nav('规则配置');await check('八条规则均有语义图标与原有配置入口',await page.locator('.rule-card-top>.feature-icon').count()==8 and await page.get_by_role('button',name='配置规则',exact=True).count()==8);await screenshot('rules')
   await check('多个图标渐变ID互不覆盖',await page.evaluate("(()=>{const ids=[...document.querySelectorAll('.feature-icon [id]')].map(e=>e.id);return new Set(ids).size===ids.length})()"))
   for label in ['数据采集','智能匹配','异常处理','电子档案','操作日志']:
    await nav(label);await check('桌面页面可打开且无溢出：'+label,await page.locator('h1').count()==1 and await no_overflow())
   fixture=json.loads((ROOT.parent/'fixtures/demo-state.json').read_text());await page.evaluate("s=>localStorage.setItem('langchao-cloud-demo-v1',JSON.stringify(s))",fixture);await page.reload(wait_until='networkidle');await nav('数据采集')
   await check('凭证列表文字和金额清晰醒目',await page.locator('.records-panel .el-table').evaluate("e=>parseFloat(getComputedStyle(e).fontSize)>=14") and await page.locator('.amount-cell').first.evaluate("e=>parseFloat(getComputedStyle(e).fontSize)>=16"));await screenshot('data')
   await page.get_by_role('button',name='批量导入凭证',exact=True).click();await check('批量导入入口和弹窗保持可用',await page.locator('.batch-import-dialog:visible').count()==1);await page.locator('.batch-import-dialog:visible').get_by_role('button',name='取消',exact=True).click()
   await page.set_viewport_size({'width':390,'height':844})
   for label in ['工作台','数据采集','智能匹配','异常处理','电子档案','规则配置','操作日志']:
    await nav(label);await check('手机页面无整页横向溢出：'+label,await no_overflow())
   await check('手机导航七个彩色图标全部可见',await page.locator('.nav-item>.feature-icon').evaluate_all("items=>items.every(e=>getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>=30)"))
   await nav('工作台');await screenshot('mobile-overview');await nav('数据采集');await screenshot('mobile-data')
   await page.emulate_media(reduced_motion='reduce');await page.hover('.nav-item[aria-label="工作台"]');await check('减少动态效果时关闭图标悬停变换',await page.locator('.nav-item[aria-label="工作台"] .icon-body').evaluate("e=>getComputedStyle(e).transform==='none'"))
   await check('视觉升级浏览器异常为0',not errors);print(json.dumps({'passed':len(checks),'checks':checks,'errors':errors},ensure_ascii=False),flush=True)
  except:
   await page.screenshot(path=str(ART/'visual-refresh-failure.png'),full_page=True);print('BROWSER_ERRORS',errors,flush=True);traceback.print_exc();raise
  finally:await browser.close()
asyncio.run(main())
