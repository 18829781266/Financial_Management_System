"""Regression: five original documents synchronize without a same-period voucher."""
import asyncio,base64,json,os,traceback
from pathlib import Path
from playwright.async_api import async_playwright
from helpers import install_demo_fixture
ROOT=Path(__file__).resolve().parent
ART=ROOT/'artifacts';ART.mkdir(exist_ok=True)
CHECKS=[]
async def check(label,condition=True):
 if not condition:raise AssertionError(label)
 CHECKS.append(label);print('PASS '+label,flush=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.getenv('BROWSER_EXECUTABLE') or None,headless=True,args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':1600,'height':1100});page.set_default_timeout(15000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await install_demo_fixture(page)
  async def state():return await page.evaluate("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'))")
  async def nav(label):
   await page.get_by_role('button',name=label,exact=True).first.click()
  run_counter=0
  async def run():
   nonlocal run_counter
   run_counter+=1;previous=(await state()).get('lastMatchRun',{}).get('id');await nav('数据采集');await page.locator('.section-tabs').get_by_role('button',name='记账凭证',exact=False).first.click();await page.get_by_role('button',name='批量导入凭证',exact=True).click();dialog=page.locator('.batch-import-dialog:visible')
   payload={'vouchers':[{'no':f'自动触发-{run_counter}','period':'2026-06','date':'2026-06-22','summary':'合成自动匹配触发','supplier':f'无关联客商{run_counter}','amount':'1.00'}]};await dialog.locator('input[type=file]').set_input_files({'name':f'auto-run-{run_counter}.json','mimeType':'application/json','buffer':json.dumps(payload,ensure_ascii=False).encode()});await dialog.get_by_role('button',name='确认导入（1）',exact=True).click();await dialog.wait_for(state='hidden')
   await page.wait_for_function("id=>{const r=JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')).lastMatchRun;return r&&r.id!==id}",arg=previous);await nav('智能匹配');await check('智能匹配页没有手动开始按钮',await page.get_by_role('button',name='开始自动匹配',exact=True).count()==0)
  try:
   await page.goto(os.getenv('BASE_URL','http://localhost:5173'),wait_until='networkidle');await nav('规则配置');await page.locator('.rule-card .el-switch').first.click()
   await page.evaluate("""async pdf=>{
    const s=JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'));s.payerGroups=[];s.nameAssociations=[];delete s.lastMatchRun;
    const company='原件同步合成企业有限公司';
    const doc=(i,payer,payee)=>({id:'sync-'+i,name:'原始回单-'+i+'.pdf',type:'bank',payerName:payer,payeeName:payee,supplier:payer,number:'SYNC-'+i,amount:100+i,date:'2026-06-20',status:'pending',matchReviewRequired:false,partyVersion:2,extractionStatus:'reviewed',fileId:'sync-file-'+i,seal:false,importSequence:100+i});
    s.documents=[...s.documents,...[doc(1,company,'对方甲'),doc(2,company,'对方乙'),doc(3,company,'对方丙'),doc(4,'对方丁',company),doc(5,'',company),doc(6,'孤立付款甲','孤立收款甲'),doc(7,'孤立付款乙','孤立收款乙')]];s.lastImportSequence=107;
    localStorage.setItem('langchao-cloud-demo-v1',JSON.stringify(s));const open=indexedDB.open('langchao-files-v1',1);open.onupgradeneeded=()=>open.result.createObjectStore('files');await new Promise((resolve,reject)=>{open.onsuccess=resolve;open.onerror=reject});const db=open.result,tx=db.transaction('files','readwrite'),blob=new Blob([Uint8Array.from(atob(pdf),c=>c.charCodeAt(0))],{type:'application/pdf'});for(let i=1;i<=7;i++)tx.objectStore('files').put(blob,'sync-file-'+i);await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=reject});db.close();
   }""",base64.b64encode((ROOT/'manual-invoice.pdf').read_bytes()).decode())
   await page.reload(wait_until='networkidle');await nav('数据采集');await page.get_by_role('button',name='原始单据',exact=False).filter(has=page.locator('svg')).first.click()
   await page.locator('.record-filters .el-select').first.click();await page.get_by_role('option',name='2026年06月',exact=True).click()
   await check('七份新原件初始均为待匹配',await page.locator('.records-panel .status').all_inner_texts()==['待匹配']*7)
   await check('同期间没有凭证，不依赖演示凭证冒充关联',not any(v['period']=='2026-06' for v in (await state())['vouchers']))
   await run();s=await state();g=next(g for g in s['nameAssociations'] if g['period']=='2026-06')
   await check('五份原件按付款或收款主体相互关联',g['basis']=='documents' and g['voucherIds']==[] and set(g['documentIds'])=={'sync-'+str(i) for i in range(1,6)})
   await check('全量匹配结果包含五个名称关联成员',s['lastMatchRun']['period']=='' and s['lastMatchRun']['nameAssociatedDocuments']==5 and len(g['documentIds'])==5)
   await check('结果页展示全量匹配统计', '请复核' in await page.locator('.match-run-stats').inner_text())
   await nav('数据采集');statuses=await page.locator('.records-panel .status').all_inner_texts()
   await check('采集列表五份已匹配归档、两份请复核',statuses.count('已匹配归档')==5 and statuses.count('请复核')==2)
   for i in range(1,6):await check('指定原始回单'+str(i)+'状态已匹配归档','已匹配归档' in await page.locator('tr.el-table__row').filter(has_text='SYNC-'+str(i)).inner_text())
   await nav('电子档案');await check('电子档案直接展示该企业五份原件',await page.locator('.payer-draft-heading h3').inner_text()=='原件同步合成企业有限公司' and await page.locator('.draft-documents tr.el-table__row').count()==5)
   await check('未关联两份原件不会出现在档案','SYNC-6' not in await page.locator('.draft-documents').inner_text() and 'SYNC-7' not in await page.locator('.draft-documents').inner_text())
   await check('没有虚构凭证或正式归档按钮',await page.locator('.linked-voucher').count()==0 and await page.get_by_role('button',name='生成正式档案册',exact=True).count()==0)
   await page.locator('.draft-preview').scroll_into_view_if_needed()
   await page.wait_for_function("document.querySelectorAll('.original-document-page').length===5 && document.querySelector('.original-document-page[data-rendered=true]')")
   await check('五份原始PDF直接进入翻页预览',await page.locator('.draft-preview .original-document-canvas').count()==5)
   await page.screenshot(path=str(ART/'document-association-sync.png'),full_page=True)
   await page.reload(wait_until='networkidle');await check('刷新后档案仍为五份',await page.locator('.draft-documents tr.el-table__row').count()==5)
   await nav('数据采集');await page.get_by_role('button',name='原始单据',exact=False).filter(has=page.locator('svg')).first.click();await page.locator('.record-filters .el-select').first.click();await page.get_by_role('option',name='2026年06月',exact=True).click()
   await check('刷新后采集状态仍是五份已匹配归档',(await page.locator('.records-panel .status').all_inner_texts()).count('已匹配归档')==5)
   await run();await check('重复执行不重复关联且新增为零',(await state())['lastMatchRun']['newlyAssociatedDocuments']==0 and len(next(g for g in (await state())['nameAssociations'] if g['period']=='2026-06')['documentIds'])==5)
   await nav('规则配置');await page.locator('.rule-card').filter(has=page.locator('.rule-id',has_text='R08')).locator('.el-switch').click();await run();await nav('数据采集')
   await check('停用规则后重新执行，原五份释放为请复核',set(await page.locator('.records-panel .status').all_inner_texts())=={'请复核'})
   await nav('电子档案');await check('解除后的五份不继续留在电子档案',await page.locator('.payer-group').count()==0)
   await nav('规则配置');await page.locator('.rule-card').filter(has=page.locator('.rule-id',has_text='R08')).locator('.el-switch').click();await run();await nav('电子档案');await page.set_viewport_size({'width':390,'height':844})
   await check('手机显示五份原件且无整页横向溢出',await page.locator('.draft-documents tr.el-table__row').count()==5 and await page.evaluate('document.body.scrollWidth<=innerWidth'))
   await check('整个同步流程无浏览器异常',not errors)
   print(json.dumps({'passed':len(CHECKS),'checks':CHECKS,'errors':errors},ensure_ascii=False),flush=True)
  except Exception:
   await page.screenshot(path=str(ART/'document-association-sync-failure.png'),full_page=True);print('BROWSER_ERRORS',errors,flush=True);traceback.print_exc();raise
  finally:await browser.close()
asyncio.run(main())
