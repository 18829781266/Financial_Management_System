"""Empty-first launch and complete reset, including orphan files."""
import asyncio,json,os,traceback
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent;ART=ROOT/'artifacts';ART.mkdir(exist_ok=True);checks=[]
async def check(label,condition=True):
 if not condition:raise AssertionError(label)
 checks.append(label);print('PASS '+label,flush=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.getenv('BROWSER_EXECUTABLE') or None,headless=True,args=['--no-sandbox']);page=await browser.new_page(viewport={'width':1500,'height':1000});page.set_default_timeout(15000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  async def nav(label):await page.get_by_role('button',name=label,exact=True).first.click()
  async def state():return await page.evaluate("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')||'null')")
  try:
   await page.goto(os.getenv('BASE_URL','http://localhost:5174'),wait_until='networkidle')
   await check('新浏览器没有演示档案、翻页样册或隐藏演示PDF',await page.locator('.book-card,.flip-paper,.export-sheet').count()==0)
   await nav('数据采集');await check('新工作空间凭证列表为空',await page.locator('tr.el-table__row').count()==0)
   await nav('规则配置');await check('默认8条规则仍可用',await page.locator('.rule-card').count()==8)
   seed=json.loads((ROOT.parent/'fixtures/demo-state.json').read_text())
   await page.evaluate("""async seed=>{
    localStorage.setItem('langchao-cloud-demo-v1',JSON.stringify(seed));localStorage.setItem('langchao:last-export-hash','synthetic-old-hash');
    const open=indexedDB.open('langchao-files-v1',1);open.onupgradeneeded=()=>open.result.createObjectStore('files');await new Promise((resolve,reject)=>{open.onsuccess=resolve;open.onerror=reject});const db=open.result,tx=db.transaction('files','readwrite');tx.objectStore('files').put(new Blob(['%PDF-1.7 orphan']),'unreferenced-orphan');await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=reject});db.close();
   }""",seed)
   await page.reload(wait_until='networkidle');await check('旧数据仍可读，升级不会私自删除记录',len((await state())['vouchers'])==12)
   await page.get_by_title('重置并清空数据').click();await page.get_by_role('button',name='取消',exact=True).last.click();await check('取消重置保留原记录',len((await state())['vouchers'])==12)
   await page.get_by_title('重置并清空数据').click();await page.get_by_role('button',name='重置',exact=True).click();await page.wait_for_function("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')).vouchers.length===0 && document.body.innerText.includes('所有数据和文件已清空')")
   s=await state();await check('确认后所有业务记录和关联均为空',all(s.get(k)==[] for k in ['vouchers','documents','archives','logs','payerGroups','nameAssociations']) and not s.get('lastMatchRun'))
   await check('文件仓库连同孤儿文件一起清空',await page.evaluate("""async()=>{const open=indexedDB.open('langchao-files-v1',1);await new Promise(r=>open.onsuccess=r);const db=open.result;const n=await new Promise(r=>{const q=db.transaction('files').objectStore('files').count();q.onsuccess=()=>r(q.result)});db.close();return n===0}"""))
   await check('额外导出哈希已清除',await page.evaluate("localStorage.getItem('langchao:last-export-hash')===null"))
   await nav('工作台');await check('工作台各项凭证数据为零',all(text.strip().startswith('0') for text in await page.locator('.metric strong').all_inner_texts()))
   await nav('异常处理');await check('异常池为空',await page.locator('tr.el-table__row').count()==0)
   await nav('电子档案');await check('电子档案为空且没有残留样册',await page.locator('.payer-group,.book-card,.flip-paper,.export-sheet').count()==0)
   await nav('操作日志');await check('操作日志为空',await page.locator('tr.el-table__row').count()==0)
   await page.reload(wait_until='networkidle');s=await state();await check('刷新后保持全空，不再恢复示例',all(s.get(k)==[] for k in ['vouchers','documents','archives','logs']))
   await nav('数据采集');await page.get_by_role('button',name='批量导入凭证',exact=True).click();dialog=page.locator('.batch-import-dialog:visible');await dialog.locator('input[type=file]').set_input_files(str(ROOT/'batch.json'));await page.wait_for_function("!document.querySelector('.batch-import-dialog .upload-zone')?.disabled");await dialog.get_by_role('button',name='确认导入',exact=False).click();await dialog.wait_for(state='hidden')
   await check('清空后仍能正常批量导入新数据',len((await state())['vouchers'])==2)
   await page.get_by_title('重置并清空数据').click();await page.get_by_role('button',name='重置',exact=True).click();await page.wait_for_function("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')).vouchers.length===0")
   await page.set_viewport_size({'width':390,'height':844});await check('空状态手机布局无整页横向溢出',await page.evaluate('document.body.scrollWidth<=innerWidth'))
   await check('完整清空流程无浏览器异常',not errors);print(json.dumps({'passed':len(checks),'errors':errors,'checks':checks},ensure_ascii=False),flush=True)
  except:
   await page.screenshot(path=str(ART/'reset-data-failure.png'),full_page=True);print('BROWSER_ERRORS',errors,flush=True);traceback.print_exc();raise
  finally:await browser.close()
asyncio.run(main())
