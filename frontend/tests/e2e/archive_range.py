"""Month calendar and real voucher endpoints; synthetic original files only."""
import asyncio,base64,json,os,re,traceback
from pathlib import Path
from playwright.async_api import async_playwright
from helpers import select_archive_range,archive_endpoint_dropdown
ROOT=Path(__file__).resolve().parent;ART=ROOT/'artifacts';ART.mkdir(exist_ok=True);checks=[]
async def check(label,condition=True):
 if not condition:raise AssertionError(label)
 checks.append(label);print('PASS '+label,flush=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.getenv('BROWSER_EXECUTABLE') or None,headless=True,args=['--no-sandbox']);page=await browser.new_page(viewport={'width':1399,'height':1000});page.set_default_timeout(15000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  async def state():return await page.evaluate("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'))")
  async def nav(label):await page.get_by_role('button',name=label,exact=True).first.click()
  async def open_dialog():
   await nav('电子档案');await page.get_by_role('button',name='生成档案册',exact=True).first.click();return page.locator('.el-dialog:visible').last
  async def field(d,label):return d.locator('.el-form-item').filter(has=page.locator('.el-form-item__label',has_text=label)).first
  async def pick_month(d,period):
   year,month=map(int,period.split('-'));await d.locator('#archive-period').click();panel=page.locator('.el-date-picker:visible').last
   for _ in range(30):
    current=int(re.search(r'\d{4}',await panel.locator('.el-date-picker__header-label').first.inner_text()).group())
    if current==year:break
    await panel.get_by_role('button',name='前一年' if current>year else '后一年',exact=True).click()
   await panel.locator('.el-month-table td').nth(month-1).click();await panel.wait_for(state='hidden')
  async def options(d,label):
   return await archive_endpoint_dropdown(d,label)
  try:
   await page.goto(os.getenv('BASE_URL','http://localhost:5174'),wait_until='networkidle');d=await open_dialog()
   await check('没有凭证时月份与凭证号均不填充演示值',await d.locator('#archive-period').input_value()=='' and await d.get_by_role('button',name='校验并生成',exact=True).is_disabled())
   await check('空列表显示先导入凭证的说明','请先到数据采集页面导入凭证' in await d.inner_text());await d.get_by_role('button',name='取消',exact=True).click()
   await nav('规则配置');await page.locator('.rule-card .el-switch').first.click()
   await page.evaluate("""async files=>{
    const s=JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'));s.vouchers=[];s.documents=[];s.payerGroups=[];s.nameAssociations=[];s.logs=[];delete s.lastMatchRun;
    const add=(id,no,period,party)=>{s.vouchers.push({id,no,period,date:period+'-01',supplier:party,summary:no+'合成凭证',amount:100,status:'matched',reviewStatus:'reviewed',documentIds:['d-'+id],fileId:'v-'+id,fileName:no+'原件.pdf',expectedAttachments:1});s.documents.push({id:'d-'+id,name:no+'附件.pdf',number:'D-'+id,type:'bank',date:period+'-01',supplier:party,payerName:party,payeeName:'合成对方',amount:100,status:'matched',extractionStatus:'reviewed',fileId:'f-'+id,partyVersion:2,seal:true});};
    add('j10','记-10','2026-06','六月企业');add('j2','记-2','2026-06','六月企业');add('j7','记-7','2026-06','六月企业');add('jul','月记-1','2026-07','七月企业');add('a1','八-1','2026-08','八月企业');add('a2','八-2','2026-08','八月企业');add('a3','八-3','2026-08','八月企业');add('locked','锁-1','2025-09','旧期企业');
    s.archives=[{id:'test-locked-a',title:'已归档八月',period:'2026-08',startVoucherNo:'八-2',endVoucherNo:'八-2',voucherCount:1,pageCount:2,amount:100,createdAt:'2026-10-23',status:'locked'},{id:'test-locked-old',title:'已归档旧期',period:'2025-09',startVoucherNo:'锁-1',endVoucherNo:'锁-1',voucherCount:1,pageCount:2,amount:100,createdAt:'2026-10-23',status:'locked'}];localStorage.setItem('langchao-cloud-demo-v1',JSON.stringify(s));
    const open=indexedDB.open('langchao-files-v1',1);open.onupgradeneeded=()=>open.result.createObjectStore('files');await new Promise((resolve,reject)=>{open.onsuccess=resolve;open.onerror=reject});const db=open.result,tx=db.transaction('files','readwrite'),blob=b=>new Blob([Uint8Array.from(atob(b),c=>c.charCodeAt(0))],{type:'application/pdf'});for(const v of s.vouchers)tx.objectStore('files').put(blob(files.voucher),v.fileId);for(const doc of s.documents)tx.objectStore('files').put(blob(files.document),doc.fileId);await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=reject});db.close();
   }""",{'voucher':base64.b64encode((ROOT/'manual-voucher.pdf').read_bytes()).decode(),'document':base64.b64encode((ROOT/'manual-invoice.pdf').read_bytes()).decode()})
   await page.reload(wait_until='networkidle');d=await open_dialog()
   await check('默认月份来自实际最新未归档凭证',await d.locator('#archive-period').input_value()=='2026年08月')
   await check('月份为不可自由输入的日历选择器',await d.locator('#archive-period').get_attribute('readonly') is not None)
   await d.locator('#archive-period').click();panel=page.locator('.el-date-picker:visible').last;await check('无凭证的月份在日历中禁用','disabled' in (await panel.locator('.el-month-table td').nth(0).get_attribute('class') or ''));await d.locator('.el-dialog__title').click()
   await select_archive_range(d,'2026-08','八-1','八-3');await check('端点未归档但中间跨过锁定区间时禁止生成',await d.get_by_role('button',name='校验并生成',exact=True).is_disabled() and '所选范围包含已归档区间' in await d.inner_text())
   dropdown=await options(d,'起始凭证号');locked=dropdown.locator('.el-select-dropdown__item').filter(has=page.get_by_text('八-2',exact=True));await check('已归档凭证号在实际下拉中禁用','is-disabled' in (await locked.get_attribute('class') or ''));await d.locator('.el-dialog__title').click()
   await select_archive_range(d,'2026-06','记-2','记-10');dropdown=await options(d,'起始凭证号');labels=await dropdown.locator('.archive-voucher-option strong').all_inner_texts();await check('下拉只含本期实际凭证且自然排序',labels==['记-2','记-7','记-10']);await check('选项同时展示实际原件文件名称','记-2原件.pdf' in await dropdown.inner_text());await d.locator('.el-dialog__title').click()
   await check('不连续号码按实际记录显示3张而不是虚构号段','已选 3 张实际凭证' in await d.inner_text())
   await select_archive_range(d,'2026-06','记-10','记-10');dropdown=await options(d,'终止凭证号');items=dropdown.locator('.el-select-dropdown__item');disabled_classes=[await items.nth(i).get_attribute('class') for i in [0,1]];await check('终止凭证不能早于起始凭证',all('is-disabled' in (value or '') for value in disabled_classes));await d.locator('.el-dialog__title').click()
   await select_archive_range(d,'2026-06','记-2','记-7');await check('选择范围后预览真实凭证数与金额','已选 2 张实际凭证' in await d.inner_text() and '200.00' in await d.inner_text());await d.screenshot(path=str(ART/'archive-range-desktop.png'))
   await d.get_by_role('button',name='校验并生成',exact=True).click();await page.wait_for_function("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')).archives[0].fileId",timeout=45000);s=await state();a=s['archives'][0];await check('所选实际范围生成PDF且保存正确期间与端点',a['period']=='2026-06' and a['startVoucherNo']=='记-2' and a['endVoucherNo']=='记-7' and a['voucherCount']==2 and a['pageCount']==4 and len(a['hash'])==64)
   d=await open_dialog();await check('再次打开会更新候选而不保留已锁定端点','已选 1 张实际凭证' in await d.inner_text() and '记-10' in await d.locator('.archive-range-summary').inner_text())
   await pick_month(d,'2026-07');await check('切换月份后起止号同步换成本期实际凭证','月记-1' in await d.locator('.archive-range-summary').inner_text() and '记-10' not in await d.locator('.archive-range-summary').inner_text())
   await d.locator('.el-date-editor').hover();await d.locator('.el-date-editor .clear-icon').click();await check('清空月份会同步清空起止号并禁止生成',await d.locator('#archive-period').input_value()=='' and await d.get_by_text('先选择会计期间',exact=True).count()==2 and await d.get_by_role('button',name='校验并生成',exact=True).is_disabled())
   await pick_month(d,'2025-09');await check('跨年月份可点击选择，整期已归档时不能生成',await d.locator('#archive-period').input_value()=='2025年09月' and await d.get_by_role('button',name='校验并生成',exact=True).is_disabled() and '该期间没有可生成档案' in await d.inner_text())
   before=len((await state())['archives']);await d.get_by_role('button',name='取消',exact=True).click();await check('仅选择和取消不会生成档案或改动记录',len((await state())['archives'])==before)
   await page.locator('.section-tabs').get_by_role('button',name='已匹配归档',exact=False).click();await page.locator('.payer-group').filter(has=page.get_by_text('六月企业',exact=True)).click();row=page.locator('.linked-voucher').filter(has=page.get_by_role('button',name='记-2',exact=True));await row.get_by_role('button',name='生成正式档案册',exact=True).click();await check('已归档单张入口不会替换成其他未归档凭证',await page.locator('.el-dialog:visible').count()==0 and len((await state())['archives'])==before)
   await page.locator('.payer-group').filter(has=page.get_by_text('七月企业',exact=True)).click();await page.get_by_role('button',name='生成正式档案册',exact=True).click();d=page.locator('.el-dialog:visible').last;await check('单张凭证生成入口预选该张实际期间与号码',await d.locator('#archive-period').input_value()=='2026年07月' and '月记-1 — 月记-1' in await d.locator('.archive-range-summary').inner_text());await d.get_by_role('button',name='取消',exact=True).click()
   await page.set_viewport_size({'width':390,'height':844});d=await open_dialog();await pick_month(d,'2026-07');await check('手机月份选择器和表单无整页横向溢出',await page.evaluate('document.body.scrollWidth<=innerWidth'))
   dropdown=await options(d,'起始凭证号');await check('手机也能点击实际凭证选项',await dropdown.locator('.archive-voucher-option strong').all_inner_texts()==['月记-1'] and await page.evaluate('document.body.scrollWidth<=innerWidth'));await d.locator('.el-dialog__title').click();await d.get_by_role('button',name='取消',exact=True).click()
   await check('日期与凭证范围选择流程无浏览器异常',not errors);print(json.dumps({'passed':len(checks),'checks':checks,'errors':errors},ensure_ascii=False),flush=True)
  except:
   await page.screenshot(path=str(ART/'archive-range-failure.png'),full_page=True);print('BROWSER_ERRORS',errors,flush=True);traceback.print_exc();raise
  finally:await browser.close()
asyncio.run(main())
