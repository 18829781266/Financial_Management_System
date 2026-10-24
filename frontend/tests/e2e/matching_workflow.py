"""Rule configuration and explicit matching workflow, using isolated synthetic records."""
import asyncio,json,traceback,os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent
ARTIFACTS=ROOT/'artifacts';ARTIFACTS.mkdir(exist_ok=True)
CHECKS=[]
async def check(name,condition):
 if not condition:raise AssertionError(name)
 CHECKS.append(name);print('PASS',name,flush=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('BROWSER_EXECUTABLE') or None,headless=True,args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':1536,'height':1100});page.set_default_timeout(15000);errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
  async def state():return await page.evaluate("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'))")
  async def nav(label):
   await page.get_by_role('button',name=label,exact=True).first.click()
   title={'数据采集':'数据采集','规则配置':'匹配规则配置','智能匹配':'智能凭证匹配','电子档案':'电子会计档案'}[label]
   await page.locator('h1').filter(has_text=title).wait_for(state='visible');await page.wait_for_timeout(150)
  async def search(value):await page.get_by_role('textbox',name='搜索凭证或单据',exact=True).fill(value);await page.wait_for_timeout(100)
  async def form(label):return page.locator('.el-dialog:visible .el-form-item').filter(has=page.locator('.el-form-item__label',has_text=label))
  async def select(label,option):
   await (await form(label)).locator('.el-select').click();await page.locator('.el-select-dropdown:visible').get_by_text(option,exact=True).click()
  async def edit():
   await nav('规则配置');await page.locator('.rule-card').filter(has=page.locator('.rule-id',has_text='R05')).get_by_role('button',name='配置规则',exact=True).click()
  async def save():await page.locator('.el-dialog:visible').get_by_role('button',name='保存',exact=True).click();await page.wait_for_timeout(150)
  async def run_match():
   previous=(await state()).get('lastMatchRun',{}).get('id')
   button=page.get_by_role('button',name='开始自动匹配',exact=True);await button.click()
   await page.wait_for_function("previous=>{const run=JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')).lastMatchRun;return run&&run.id!==previous;}",arg=previous)
   await button.wait_for(state='visible');await page.wait_for_timeout(150)
  try:
   await page.goto(os.environ.get('BASE_URL','http://localhost:5173/'),wait_until='networkidle')
   await nav('规则配置');await page.locator('.rule-card .el-switch').first.click();await page.locator('.rule-card .el-switch').first.click()
   # Extend only this isolated browser state; no actual business files are included.
   await page.evaluate('''()=>{let s=JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'));s.vouchers=[];s.documents=[];s.archives=[];s.payerGroups=[];delete s.lastMatchRun;s.lastImportSequence=4;for(const r of s.rules){r.enabled=r.id==='R05';r.priority+=10;}
    const voucher=(id,no,amount)=>({id,no,period:'2026-10',date:'2026-10-20',summary:'浏览器回归业务',supplier:'界面回归付款人',amount,status:'pending',matchReviewRequired:false,documentIds:[],reviewStatus:'pending',sourceKind:'pdf-text',sourceAmount:amount.toFixed(2),sourcePages:[1],entries:[{summary:'费用',account:'管理费用',debit:amount.toFixed(2),credit:'0.00'},{summary:'银行',account:'银行存款',debit:'0.00',credit:amount.toFixed(2)}],importSequence:id==='ui-v1'?1:2});
    s.vouchers=[voucher('ui-v1','UI-FLOW-1',100),voucher('ui-v2','UI-FLOW-2',200)];
    const doc=(id,name,type)=>({id,name,type,supplier:'界面回归付款人有限公司',payerName:'界面回归付款人有限公司',payeeName:'界面回归收款人有限公司',partyVersion:2,amount:100,date:'2026-10-21',number:id,seal:true,status:'pending',matchReviewRequired:false,extractionStatus:'pending',sourceKind:'pdf-text',sourcePages:[1],importSequence:id==='ui-d1'?3:4});
    s.documents=[doc('ui-d1','UI-发票.pdf','invoice'),doc('ui-d2','UI-回单.pdf','bank')];localStorage.setItem('langchao-cloud-demo-v1',JSON.stringify(s));}''')
   await page.reload(wait_until='networkidle');await nav('数据采集')
   await check('采集后仅显示待匹配且不提前显示请复核',set(await page.locator('.records-panel .status').all_inner_texts())=={'待匹配'} and await page.locator('.records-panel .review-hint').count()==0)
   await edit();await (await form('执行优先级')).locator('input').fill('1');await select('匹配策略','精确匹配');await select('名称字段','收款人名称');await (await form('日期匹配窗口')).locator('input').fill('0');await save()
   r=next(r for r in (await state())['rules'] if r['id']=='R05')
   await check('规则优先级、精确策略、收款人字段及零天窗口可保存',r['priority']==1 and r['matchType']=='exact' and r['conditions']['partyField']=='payeeName' and r['dateWindow']==0)
   await nav('智能匹配');await page.wait_for_timeout(450)
   await check('进入智能匹配仅展示规则不自动执行',not (await state()).get('lastMatchRun') and await page.locator('.rule-chain>span').first.locator('b').inner_text()=='R05')
   await run_match();s=await state()
   await check('点击按钮按保存优先级执行且名称不符转请复核',next(r for r in s['lastMatchRun']['rules'] if r['id']=='R05')['priority']==1 and next(v for v in s['vouchers'] if v['id']=='ui-v1')['status']=='pending' and next(v for v in s['vouchers'] if v['id']=='ui-v1')['matchReviewRequired'] and '收款人' in next(v for v in s['vouchers'] if v['id']=='ui-v1')['lastMatchReason'])
   previous_run_id=s['lastMatchRun']['id']
   await edit();await select('匹配策略','模糊匹配');await select('名称字段','付款人名称（默认客商）');await (await form('适用单据类型')).locator('.el-checkbox').filter(has_text='银行回单').click();await save()
   r=next(r for r in (await state())['rules'] if r['id']=='R05')
   await check('模糊算法、付款人及多单据类型配置落地',r['matchType']=='fuzzy' and r['conditions']['partyField']=='payerName' and set(r['conditions']['documentTypes'])=={'invoice','bank'})
   await nav('智能匹配');await page.wait_for_timeout(350)
   await check('规则修改及再次进入不会偷偷重跑',(await state())['lastMatchRun']['id']==previous_run_id)
   await run_match();s=await state();v=next(v for v in s['vouchers'] if v['id']=='ui-v1')
   await check('日期开关启用时零天窗口阻止跨日关联',v['status']=='pending' and v['matchReviewRequired'] and '日期' in v['lastMatchReason'])
   await edit();await (await form('适用单据类型')).locator('.el-checkbox').filter(has_text='银行回单').click();await (await form('校验日期')).locator('.el-switch').click();await save()
   r=next(r for r in (await state())['rules'] if r['id']=='R05')
   await check('日期开关和仅发票类型配置持久保存',r['conditions']['requireDate']==False and r['conditions']['documentTypes']==['invoice'])
   await nav('智能匹配');await run_match();s=await state();v=next(v for v in s['vouchers'] if v['id']=='ui-v1');doc=next(d for d in s['documents'] if d['id']=='ui-d1')
   await check('仅点击匹配后可靠字段建立唯一关系并清除复核工作流状态',v['status']=='matched' and v['ruleId']=='R05' and v['documentIds']==['ui-d1'] and not v.get('matchReviewRequired') and doc['status']=='matched' and not doc.get('matchReviewRequired'))
   run_id=s['lastMatchRun']['id'];await nav('数据采集');await search('UI-FLOW-1')
   await check('匹配凭证只显示已匹配归档',await page.locator('.records-panel .status').first.inner_text()=='已匹配归档' and await page.locator('.records-panel .review-hint').count()==0)
   await page.locator('.section-tabs').get_by_role('button',name='原始单据',exact=False).first.click();await search('UI-发票')
   await check('单据客商为付款人且成功只显示已匹配归档',await page.locator('.records-panel .status').first.inner_text()=='已匹配归档' and await page.locator('.records-panel .review-hint').count()==0 and await page.locator('.records-panel .supplier-cell').first.inner_text()=='界面回归付款人有限公司')
   await search('UI-回单');await check('未关联单据只显示请复核',await page.locator('.records-panel .status').first.inner_text()=='请复核' and next(d for d in (await state())['documents'] if d['id']=='ui-d2')['matchReviewRequired'])
   await nav('电子档案');await page.locator('.section-tabs').get_by_role('button',name='已匹配归档',exact=False).click();await page.locator('.matched-archive-panel').wait_for(state='visible')
   await check('电子档案仅同步实际关联发票及其凭证',await page.locator('.payer-group').count()==1 and '1 份单据' in await page.locator('.payer-group').inner_text() and await page.locator('.linked-voucher .voucher-number').inner_text()=='UI-FLOW-1' and await page.locator('.draft-documents .el-table__row').count()==1)
   await check('未关联同付款人回单不计入档案金额或预览',await page.locator('.type-totals strong').all_inner_texts()==['¥ 100.00'] and 'UI-回单.pdf' not in await page.locator('.matched-archive-panel').inner_text() and await page.locator('.unresolved-run').count()==0)
   await page.get_by_role('button',name='档案册管理',exact=False).click();await check('档案册管理可独立打开正式档案视图',not await page.locator('.matched-archive-panel').count() and await page.get_by_role('button',name='导出档案册',exact=True).count()==1)
   await nav('数据采集');await search('UI-发票');await page.get_by_role('button',name='补录复核',exact=True).click();await check('已匹配单据仍可打开付款人字段复核',await page.locator('.el-dialog:visible .el-form-item__label').filter(has_text='客商名称（付款人）').count()==1)
   await page.locator('.el-dialog:visible').get_by_role('button',name='保存并复核',exact=True).click();await page.wait_for_timeout(150);s=await state()
   await check('已匹配原字段复核保留关系和成功状态',next(d for d in s['documents'] if d['id']=='ui-d1')['extractionStatus']=='reviewed' and next(v for v in s['vouchers'] if v['id']=='ui-v1')['status']=='matched')
   await nav('智能匹配');await page.wait_for_timeout(350);await check('复核和导航不会自动重跑',(await state())['lastMatchRun']['id']==run_id)
   await run_match();rerun=await state();rerun_id=rerun['lastMatchRun']['id'];await nav('数据采集');await nav('智能匹配');await page.wait_for_timeout(350)
   await check('再次点击可重算但既有关联不重复消费且导航不重跑',rerun_id!=run_id and next(v for v in rerun['vouchers'] if v['id']=='ui-v1')['documentIds']==['ui-d1'] and (await state())['lastMatchRun']['id']==rerun_id)
   await check('本轮规则及已关联档案流程无浏览器异常',not errors)
   print(json.dumps({'passed':len(CHECKS),'checks':CHECKS,'errors':errors},ensure_ascii=False),flush=True)
  except Exception:
   await page.screenshot(path=str(ARTIFACTS/'matching-workflow-failure.png'),full_page=True);print('BROWSER_ERRORS',errors,flush=True);traceback.print_exc();raise
  finally:await browser.close()
asyncio.run(main())
