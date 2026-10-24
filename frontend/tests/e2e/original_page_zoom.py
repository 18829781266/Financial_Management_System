"""Per-original-page zoom uses raw PDF pages and images, with synthetic fixtures."""
import asyncio,base64,json,os,traceback
from pathlib import Path
from playwright.async_api import async_playwright
from original_preview import bank_pdf,colored_png
ROOT=Path(__file__).resolve().parent;ART=ROOT/'artifacts';ART.mkdir(exist_ok=True);checks=[]
async def check(label,condition=True):
 if not condition:raise AssertionError(label)
 checks.append(label);print('PASS '+label,flush=True)
async def main():
 pdf=ART/'zoom-bank.pdf';png=ART/'zoom-bank.png';bank_pdf(pdf,[(600,300,0),(600,800,0),(600,800,90)]);colored_png(png)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.getenv('BROWSER_EXECUTABLE') or None,headless=True,args=['--no-sandbox']);page=await browser.new_page(viewport={'width':1536,'height':1050});page.set_default_timeout(15000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  async def dialog():
   d=page.locator('.original-page-zoom-dialog:visible');await d.wait_for();return d
  async def rendered(d):await d.locator('.zoom-canvas').wait_for();await page.wait_for_function("(()=>{const c=document.querySelector('.original-page-zoom-dialog .zoom-canvas');return c&&c.width>100&&c.height>100&&!document.querySelector('.original-page-zoom-dialog [aria-busy=true]')})()")
  async def close(d):await d.get_by_role('button',name='关闭',exact=True).click();await d.wait_for(state='hidden')
  async def group(name):
   await page.locator('.payer-group').filter(has_text=name).click();await page.locator('.draft-preview .el-select').click();await page.get_by_role('option',name='全部已关联单据',exact=True).click()
  try:
   await page.goto(os.getenv('BASE_URL','http://localhost:5174'),wait_until='networkidle');await page.get_by_role('button',name='规则配置',exact=True).first.click();await page.locator('.rule-card .el-switch').first.click()
   await page.evaluate("""async data=>{
    const s=JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'));
    const doc=(id,fileId,name,payer)=>({id,fileId,name,number:id,type:'bank',payerName:payer,supplier:payer,payeeName:'合成对方',date:'2026-06-01',amount:100,status:'matched',extractionStatus:'reviewed',partyVersion:2});
    s.documents=[doc('zoom-pdf','zoom-pdf-file','多页银行原件.pdf','放大PDF企业'),doc('zoom-image','zoom-image-file','银行图片.png','放大图片企业')];
    s.vouchers=s.documents.map((d,i)=>({id:'zv-'+i,no:'放大-'+i,period:'2026-06',date:d.date,summary:'合成原件',supplier:d.payerName,amount:100,status:'matched',documentIds:[d.id]}));s.archives=[];s.payerGroups=[];s.nameAssociations=[];s.lastMatchRun={id:'zoom-run',time:'2026-10-22',period:'2026-06',matched:2,remaining:0,groupCount:2,rules:s.rules,outcomes:[]};localStorage.setItem('langchao-cloud-demo-v1',JSON.stringify(s));
    const open=indexedDB.open('langchao-files-v1',1);open.onupgradeneeded=()=>open.result.createObjectStore('files');await new Promise((resolve,reject)=>{open.onsuccess=resolve;open.onerror=reject});const db=open.result,tx=db.transaction('files','readwrite');const bytes=b=>Uint8Array.from(atob(b),c=>c.charCodeAt(0));tx.objectStore('files').put(new Blob([bytes(data.pdf)],{type:'application/pdf'}),'zoom-pdf-file');tx.objectStore('files').put(new Blob([bytes(data.png)],{type:'image/png'}),'zoom-image-file');await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=reject});db.close();
   }""",{'pdf':base64.b64encode(pdf.read_bytes()).decode(),'png':base64.b64encode(png.read_bytes()).decode()})
   await page.reload(wait_until='networkidle');await group('放大PDF企业');await page.locator('.original-document-page[data-file-id="zoom-pdf-file"][data-source-page="2"] .original-zoom-button').click();d=await dialog();await rendered(d)
   await check('每一页均有独立放大入口，右侧页可以单独打开',await page.locator('.draft-preview .original-zoom-button').count()==3)
   await check('放大的是点击的PDF第二页', '第 2 页' in await d.inner_text() or '2 / 3' in await d.inner_text() or '2/3' in await d.inner_text())
   await check('放大不触发底层翻页',await page.locator('.draft-page-controls').inner_text()=='1 / 3')
   ratio=await d.locator('.zoom-canvas').evaluate('c=>c.width/c.height');await check('竖版原始页比例保持600比800',abs(ratio-.75)<.01)
   before=await d.locator('.zoom-canvas').evaluate('c=>c.getBoundingClientRect().width');await d.get_by_role('button',name='放大原件',exact=True).click();await page.wait_for_timeout(400);after=await d.locator('.zoom-canvas').evaluate('c=>c.getBoundingClientRect().width');await check('放大按钮增大单张原件',after>before)
   await d.get_by_role('button',name='缩小原件',exact=True).click();await d.get_by_role('button',name='原始大小',exact=True).click();await check('支持恢复100%原始大小','100%' in await d.inner_text())
   await d.get_by_role('button',name='适合窗口',exact=True).click();await page.wait_for_timeout(200);await check('适合窗口保持整页可见',await d.locator('.zoom-scroll').evaluate('e=>e.scrollWidth<=e.clientWidth+3&&e.scrollHeight<=e.clientHeight+3'))
   await d.get_by_role('button',name='全屏查看',exact=True).click();await page.wait_for_function("document.querySelector('.original-page-zoom-dialog')?.classList.contains('is-fullscreen')");await check('单张原件可以全屏放大查看',await d.locator('.zoom-canvas').count()==1)
   await d.get_by_role('button',name='退出全屏',exact=True).click();await page.wait_for_function("!document.querySelector('.original-page-zoom-dialog')?.classList.contains('is-fullscreen')");await check('退出单页全屏后仍显示同一原始页',await d.locator('.zoom-sheet').get_attribute('data-source-page')=='2')
   await rendered(d);await page.wait_for_timeout(200);await rendered(d)
   await page.screenshot(path=str(ART/'original-page-zoom-desktop.png'),full_page=True)
   await d.get_by_role('button',name='原始大小',exact=True).click()
   for _ in range(5):await d.get_by_role('button',name='放大原件',exact=True).click()
   await page.wait_for_timeout(400);scroll=d.locator('.zoom-scroll');await scroll.evaluate('e=>{e.scrollTop=180;e.scrollLeft=80}')
   box=await scroll.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2;before_scroll=await scroll.evaluate('e=>({x:e.scrollLeft,y:e.scrollTop})');await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-80,y-70,steps=5);await page.mouse.up();after_scroll=await scroll.evaluate('e=>({x:e.scrollLeft,y:e.scrollTop})');await check('放大后可以拖动查看原件细节',after_scroll['x']>before_scroll['x'] or after_scroll['y']>before_scroll['y'])
   await page.keyboard.press('ArrowRight');await check('弹窗中的方向键不会翻动背景档案',await page.locator('.draft-page-controls').inner_text()=='1 / 3')
   await close(d);await check('关闭后仍保留原来翻页位置',await page.locator('.draft-page-controls').inner_text()=='1 / 3')
   await page.locator('.original-document-page[data-file-id="zoom-pdf-file"][data-source-page="1"] .original-zoom-button').click();d=await dialog();await rendered(d);await check('另一张横版原件独立打开',abs(await d.locator('.zoom-canvas').evaluate('c=>c.width/c.height')-2)<.01);await close(d)
   await page.get_by_role('button',name='工作稿下一页',exact=True).click();await page.wait_for_timeout(1000);await page.locator('.original-document-page[data-file-id="zoom-pdf-file"][data-source-page="3"] .original-zoom-button').click();d=await dialog();await rendered(d);await check('旋转PDF页放大后保留原始方向',abs(await d.locator('.zoom-canvas').evaluate('c=>c.width/c.height')-4/3)<.01);await close(d)
   await group('放大图片企业');await page.locator('.original-zoom-button').click();d=await dialog();await d.locator('.zoom-image').wait_for();await check('图片单据也能独立放大且保留比例',await d.locator('.zoom-image').evaluate('e=>e.naturalWidth===480&&e.naturalHeight===240'));await close(d)
   for _ in range(3):await page.locator('.original-zoom-button').click();d=await dialog();await d.get_by_role('button',name='放大原件',exact=True).click();await close(d)
   await check('反复打开关闭不破坏父原件资源',await page.locator('.original-document-image').evaluate('e=>e.complete&&e.naturalWidth===480'))
   await page.set_viewport_size({'width':390,'height':844});await page.locator('.original-zoom-button').click();d=await dialog();await check('手机可单张放大且无整页横向溢出',await d.is_visible() and await page.evaluate('document.body.scrollWidth<=innerWidth'));await page.keyboard.press('Escape');await d.wait_for(state='hidden');await check('Escape可以关闭单页放大窗口',True)
   await check('完整单页放大流程无浏览器异常',not errors);print(json.dumps({'passed':len(checks),'checks':checks,'errors':errors},ensure_ascii=False),flush=True)
  except:
   await page.screenshot(path=str(ART/'original-page-zoom-failure.png'),full_page=True);print('BROWSER_ERRORS',errors,flush=True);traceback.print_exc();raise
  finally:await browser.close()
asyncio.run(main())
