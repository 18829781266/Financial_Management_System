"""Company-name association UI regression. Uses isolated synthetic data only."""
import asyncio,base64,json,os,traceback
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parent
ART=ROOT/'artifacts';ART.mkdir(exist_ok=True)
CHECKS=[]
async def check(label,condition=True):
 if not condition:raise AssertionError(label)
 CHECKS.append(label);print('PASS '+label,flush=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.getenv('BROWSER_EXECUTABLE') or None,headless=True,args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':1500,'height':1100});page.set_default_timeout(15000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  async def state():return await page.evaluate("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'))")
  async def nav(label):
   await page.get_by_role('button',name=label,exact=True).first.click()
   titles={'数据采集':'数据采集','智能匹配':'智能凭证匹配','电子档案':'电子会计档案','规则配置':'匹配规则配置'}
   await page.locator('h1').filter(has_text=titles[label]).wait_for()
  async def run():
   await nav('智能匹配');previous=(await state()).get('lastMatchRun',{}).get('id');await page.get_by_role('button',name='开始自动匹配',exact=True).click()
   await page.wait_for_function("id=>{const r=JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')).lastMatchRun;return r&&r.id!==id}",arg=previous)
   await page.get_by_role('button',name='开始自动匹配',exact=True).wait_for()
  async def role(option):
   await nav('规则配置');await page.locator('.rule-card').filter(has=page.locator('.rule-id',has_text='R08')).get_by_role('button',name='配置规则',exact=True).click()
   form=page.locator('.el-dialog:visible .el-form-item').filter(has=page.locator('.el-form-item__label',has_text='名称字段'))
   await form.locator('.el-select').click();await page.locator('.el-select-dropdown:visible').get_by_text(option,exact=True).click();await page.locator('.el-dialog:visible').get_by_role('button',name='保存',exact=True).click()
  try:
   await page.goto(os.getenv('BASE_URL','http://localhost:5173'),wait_until='networkidle');await nav('规则配置');await page.locator('.rule-card .el-switch').first.click()
   data={'pdf':base64.b64encode((ROOT/'manual-invoice.pdf').read_bytes()).decode()}
   await page.evaluate("""async data=>{
    const s=JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'));for(const r of s.rules)r.enabled=r.id==='R08';s.archives=[];s.payerGroups=[];s.nameAssociations=[];delete s.lastMatchRun;
    const company='浏览器合成核算单位有限公司';
    s.vouchers=[{id:'name-v1',no:'名称-1',period:'2026-06',date:'2026-06-01',company,supplier:'凭证往来对方',summary:'合成名称关联',amount:100,status:'pending',matchReviewRequired:false,documentIds:[],fileId:'name-v-file',fileName:'合成凭证.pdf',importSequence:1}];
    const doc=(id,payer,payee,amount,date='2026-06-30')=>({id,name:id+'.pdf',type:'bank',payerName:payer,payeeName:payee,supplier:payer,partyVersion:2,number:id,amount,date,status:'pending',matchReviewRequired:false,extractionStatus:'reviewed',fileId:id+'-file',seal:true,importSequence:2});
    s.documents=[doc('payer-original',company,'另一方A',990),doc('payee-original','另一方B',company,500),doc('orphan-original','无关付款单位','无关收款单位',7),doc('next-period','另一方C',company,9,'2026-07-01')];s.lastImportSequence=5;
    localStorage.setItem('langchao-cloud-demo-v1',JSON.stringify(s));const open=indexedDB.open('langchao-files-v1',1);open.onupgradeneeded=()=>open.result.createObjectStore('files');await new Promise((resolve,reject)=>{open.onsuccess=resolve;open.onerror=reject});const db=open.result,tx=db.transaction('files','readwrite'),blob=new Blob([Uint8Array.from(atob(data.pdf),c=>c.charCodeAt(0))],{type:'application/pdf'});for(const id of ['name-v-file',...s.documents.map(d=>d.fileId)])tx.objectStore('files').put(blob,id);await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=reject});db.close();
   }""",data)
   await page.reload(wait_until='networkidle');await nav('数据采集');await check('名称关联前仍统一待匹配',set(await page.locator('.records-panel .status').all_inner_texts())=={'待匹配'})
   await page.locator('.record-filters .el-select').first.click();await page.get_by_role('option',name='2026年06月',exact=True).click();await nav('智能匹配');await page.wait_for_timeout(250);await check('进入匹配页不会自行执行',not (await state()).get('lastMatchRun'))
   await run();s=await state();g=s['nameAssociations'][0];await check('付款人和收款人两侧单据都关联到同一企业',set(g['documentIds'])=={'payer-original','payee-original'} and g['voucherIds']==['name-v1'] and g['basis']=='company')
   await check('不同金额和日期保留原值，未伪造财务附件绑定',s['vouchers'][0]['documentIds']==[] and s['vouchers'][0]['status']=='pending' and s['documents'][0]['amount']==990 and s['lastMatchRun']['financialMatched']==0)
   await check('无关单据请复核而未执行期间保持待匹配',next(d for d in s['documents'] if d['id']=='orphan-original')['matchReviewRequired'] and not next(d for d in s['documents'] if d['id']=='next-period')['matchReviewRequired'])
   await nav('电子档案');await check('名称组明确展示关联方式与企业',await page.locator('.payer-group').count()==1 and '企业名称关联' in await page.locator('.payer-draft-heading').inner_text())
   await check('档案只含2已关联单据和1凭证，未关联单据不混入',await page.locator('.draft-documents tr.el-table__row').count()==2 and await page.locator('.linked-voucher').count()==1 and 'orphan-original' not in await page.locator('.draft-documents').inner_text())
   await check('银行单据按原值汇总且不冒充凭证100元',await page.locator('.type-totals strong').inner_text()=='¥ 1,490.00')
   await page.wait_for_function("document.querySelectorAll('.original-document-page').length===3 && document.querySelector('.original-document-page[data-rendered=true]')")
   await check('企业原始凭证和两份回单直接翻阅3页',await page.locator('.draft-preview .original-document-canvas').count()==3)
   await check('仅名称关联提供核对附件入口',await page.get_by_role('button',name='核对凭证附件',exact=True).count()==1 and await page.get_by_role('button',name='生成正式档案册',exact=True).count()==0)
   await nav('数据采集');await page.get_by_role('button',name='名称-1',exact=True).click();dialog=page.locator('.el-dialog:visible');await check('关联穿透展示R08名称依据而非尚未建立关联','R08' in await dialog.inner_text() and '企业名称关联：浏览器合成核算单位有限公司' in await dialog.inner_text());await dialog.get_by_role('button',name='关闭',exact=True).click()
   previous=s['lastMatchRun']['id'];await role('付款人名称（默认客商）');await nav('智能匹配');await check('保存名称字段不自行运行',(await state())['lastMatchRun']['id']==previous);await run();await check('付款人配置只关联付款侧',(await state())['nameAssociations'][0]['documentIds']==['payer-original'])
   await role('收款人名称');await run();await check('收款人配置只关联收款侧',(await state())['nameAssociations'][0]['documentIds']==['payee-original'])
   await role('付款人或收款人（企业名称）');await run();await check('配置两侧后恢复2份单据',len((await state())['nameAssociations'][0]['documentIds'])==2)
   await run();await check('重复执行不重复创建成员或声称新增凭证',(await state())['lastMatchRun']['matched']==0 and len((await state())['nameAssociations'][0]['documentIds'])==2)
   await page.reload(wait_until='networkidle');s=await state();await check('刷新保留名称依据和双方原始名称',s['nameAssociations'][0]['partyField']=='either' and s['documents'][1]['payerName']=='另一方B' and s['documents'][1]['payeeName']=='浏览器合成核算单位有限公司')
   await nav('数据采集');await check('采集列表显示已匹配归档',await page.locator('.records-panel .status').first.inner_text()=='已匹配归档')
   await page.get_by_role('button',name='解除匹配',exact=True).click();prompt=page.locator('.el-message-box');await prompt.locator('input').fill('重新核对单位');await prompt.get_by_role('button',name='确认解除',exact=True).click();await page.wait_for_timeout(150)
   await check('可以解除仅名称关联且回到请复核',not (await state())['nameAssociations'] and await page.locator('.records-panel .status').first.inner_text()=='请复核')
   await nav('电子档案');await check('解除后未关联原件不继续展示',await page.locator('.payer-group').count()==0 and await page.locator('.draft-documents').count()==0)
   await run();await nav('电子档案');await page.set_viewport_size({'width':390,'height':844});await check('名称关联档案在手机无页面横向溢出',await page.evaluate('document.body.scrollWidth<=innerWidth'))
   await check('企业名称关联流程无浏览器异常',not errors)
   print(json.dumps({'passed':len(CHECKS),'checks':CHECKS,'errors':errors},ensure_ascii=False),flush=True)
  except Exception:
   await page.screenshot(path=str(ART/'name-association-failure.png'),full_page=True);print('BROWSER_ERRORS',errors,flush=True);traceback.print_exc();raise
  finally:await browser.close()
asyncio.run(main())
