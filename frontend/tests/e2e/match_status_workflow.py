"""Explicit match-button and matched-only archive workflow; synthetic browser data only."""
import asyncio,json,os,traceback
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parent
ARTIFACTS=ROOT/'artifacts';ARTIFACTS.mkdir(exist_ok=True)
CHECKS=[]
async def check(name,condition=True):
 if not condition:raise AssertionError(name)
 CHECKS.append(name);print('PASS',name,flush=True)

async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('BROWSER_EXECUTABLE') or None,headless=True,args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':1536,'height':1100});page.set_default_timeout(15000);errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
  async def state():return await page.evaluate("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'))")
  async def nav(label):
   await page.get_by_role('button',name=label,exact=True).first.click()
   titles={'数据采集':'数据采集','智能匹配':'智能凭证匹配','异常处理':'异常处理','电子档案':'电子会计档案','规则配置':'匹配规则配置'}
   await page.locator('h1').filter(has_text=titles[label]).wait_for();await page.wait_for_timeout(100)
  async def tab(label):await page.locator('.section-tabs').get_by_role('button',name=label,exact=False).first.click();await page.wait_for_timeout(100)
  async def search(value):await page.get_by_role('textbox',name='搜索凭证或单据',exact=True).fill(value);await page.wait_for_timeout(100)
  async def one_status():return (await page.locator('.records-panel .status').first.inner_text()).strip()
  async def archive():
   await nav('电子档案');await tab('已匹配归档');await page.locator('.matched-archive-panel').wait_for()
  async def save_review():
   dialog=page.locator('.el-dialog:visible').last;await dialog.get_by_role('button',name='保存并复核',exact=True).click();await dialog.wait_for(state='hidden')
  try:
   await page.goto(os.environ.get('BASE_URL','http://localhost:5173/'),wait_until='networkidle')
   await nav('数据采集');await tab('原始单据');await page.get_by_role('button',name='批量上传单据',exact=True).click();dialog=page.locator('.batch-import-dialog:visible')
   await dialog.locator('input[type=file]').set_input_files(str(ROOT/'manual-invoice.pdf'));await page.wait_for_function("!document.querySelector('.batch-import-dialog .upload-zone')?.disabled")
   for name,value in [('客商名称','状态流程付款甲'),('日期','2026-10-20'),('金额','100.00'),('单据编号','STATUS-D-MATCH')]:await dialog.get_by_role('textbox',name=name,exact=True).fill(value)
   await dialog.get_by_role('button',name='确认导入（1）',exact=True).click();await dialog.wait_for(state='hidden');await search('STATUS-D-MATCH')
   original=next(d for d in (await state())['documents'] if d['number']=='STATUS-D-MATCH');file_id=original['fileId']
   await check('实际UI上传后只显示待匹配一个状态',await one_status()=='待匹配' and await page.locator('.records-panel .review-hint').count()==0 and not original.get('matchReviewRequired'))
   await nav('智能匹配');await page.wait_for_timeout(500);await check('仅进入智能匹配不自动执行',not (await state()).get('lastMatchRun'))
   await page.evaluate("""data=>{const s=JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'));for(const rule of s.rules)if(rule.conditions?.associationScope==='party')rule.enabled=false;const voucher=(id,no,amount,payer,period='2026-10')=>({id,no,period,date:period+'-20',summary:'合成状态流程',supplier:payer,amount,status:'pending',documentIds:[],reviewStatus:'pending',matchReviewRequired:false,sourceKind:'pdf-text',sourceAmount:amount.toFixed(2),sourcePages:[1],entries:[{summary:'费用',account:'管理费用',debit:amount.toFixed(2),credit:'0.00'},{summary:'银行',account:'银行存款',debit:'0.00',credit:amount.toFixed(2)}],importSequence:1});const doc=(id,number,amount,payer,type='invoice',period='2026-10')=>({id,name:number+'.pdf',type,number,supplier:payer,payerName:payer,payeeName:'合成收款方',partyVersion:2,date:period+'-20',amount,seal:true,status:'pending',extractionStatus:'pending',sourceKind:'pdf-text',sourcePages:[1],matchReviewRequired:false,importSequence:2});s.vouchers=[voucher('status-v-match','状态-1',100,'状态流程付款甲'),voucher('status-v-manual','状态-2',200,'状态流程付款乙'),voucher('status-v-next','状态-11',700,'其他期间付款人','2026-11')];s.documents=[doc('status-d-match','STATUS-D-MATCH',100,'状态流程付款甲'),doc('status-d-same-extra','STATUS-SAME-EXTRA',333,'状态流程付款甲'),doc('status-d-manual','STATUS-D-MANUAL',200,'状态流程付款乙','bank'),doc('status-d-orphan','STATUS-ORPHAN',90,'无凭证付款人'),doc('status-d-next','STATUS-NEXT',700,'其他期间付款人','invoice','2026-11')];s.documents[0].fileId=data.fileId;s.documents[0].name='manual-invoice.pdf';s.archives=[];s.payerGroups=[];delete s.lastMatchRun;s.lastImportSequence=10;s.matchDataRevision=1;for(const r of s.rules){r.enabled=r.id==='R05';if(r.id==='R05'){r.priority=1;r.threshold=85;r.matchType='fuzzy';r.dateWindow=7;r.conditions={partyField:'payerName',documentTypes:['invoice'],requireDate:true,requireAmount:true};}}localStorage.setItem('langchao-cloud-demo-v1',JSON.stringify(s));}""",{'fileId':file_id})
   await page.reload(wait_until='networkidle');await nav('数据采集');await tab('记账凭证');await check('新凭证在执行前统一待匹配',set(await page.locator('.records-panel .status').all_inner_texts())=={'待匹配'} and await page.locator('.records-panel .review-hint').count()==0)
   await tab('原始单据');await check('新单据含字段待核对也统一待匹配',set(await page.locator('.records-panel .status').all_inner_texts())=={'待匹配'} and await page.locator('.records-panel .review-hint').count()==0)
   await archive();await check('未执行前电子档案不归集未关联数据',await page.locator('.payer-group').count()==0 and await page.locator('.draft-documents .el-table__row').count()==0)
   await nav('智能匹配');await page.wait_for_timeout(500);await check('多次导航仍没有私自启动匹配',not (await state()).get('lastMatchRun'))
   await page.locator('.record-filters .el-select').first.click();await page.get_by_role('option',name='2026年10月',exact=True).click()
   await page.get_by_role('button',name='开始自动匹配',exact=True).click();await page.wait_for_function("!!JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')).lastMatchRun");await page.get_by_role('button',name='开始自动匹配',exact=True).wait_for()
   s=await state();run_id=s['lastMatchRun']['id'];v=next(v for v in s['vouchers'] if v['id']=='status-v-match');d=next(d for d in s['documents'] if d['id']=='status-d-match')
   await check('点击按钮后按规则关联并保存运行',v['status']=='matched' and v['documentIds']==['status-d-match'] and d['status']=='matched' and not v.get('matchReviewRequired') and not d.get('matchReviewRequired'))
   await check('本期未命中及孤儿单据全部进入请复核',next(v for v in s['vouchers'] if v['id']=='status-v-manual')['matchReviewRequired'] and all(next(d for d in s['documents'] if d['id']==key)['matchReviewRequired'] for key in ['status-d-same-extra','status-d-manual','status-d-orphan']))
   await check('按期间执行不会改变其他期间新数据',not next(v for v in s['vouchers'] if v['id']=='status-v-next').get('matchReviewRequired') and not next(d for d in s['documents'] if d['id']=='status-d-next').get('matchReviewRequired'))
   await nav('数据采集');await tab('记账凭证');await search('状态-1');await check('成功凭证只有已匹配归档状态',await one_status()=='已匹配归档' and await page.locator('.records-panel .review-hint').count()==0)
   await search('状态-2');await check('未命中凭证显示请复核',await one_status()=='请复核')
   await tab('原始单据');await search('STATUS-D-MATCH');await check('成功单据只有已匹配归档状态',await one_status()=='已匹配归档' and await page.locator('.records-panel .review-hint').count()==0)
   await search('STATUS-ORPHAN');await check('孤儿单据显示请复核',await one_status()=='请复核')
   await nav('异常处理');await tab('请复核凭证');await check('复核池只包含运行后未关联凭证',await page.locator('.records-panel .el-table__row').count()==1 and set(await page.locator('.records-panel .status').all_inner_texts())=={'请复核'})
   await tab('请复核单据');await check('复核池包含未命中与孤儿单据且排除已匹配单据',await page.locator('.records-panel .el-table__row').count()==3 and set(await page.locator('.records-panel .status').all_inner_texts())=={'请复核'})
   await archive();await check('档案只展示实际已关联的一份单据',await page.locator('.payer-group').count()==1 and await page.locator('.draft-documents .el-table__row').count()==1 and await page.locator('.linked-voucher').count()==1)
   text=await page.locator('.matched-archive-panel').inner_text();await check('同付款人未关联记录不进档案金额或预览','STATUS-SAME-EXTRA' not in text and 'STATUS-ORPHAN' not in text and '状态-2' not in text and await page.locator('.type-totals strong').all_inner_texts()==['¥ 100.00'] and await page.locator('.unresolved-run').count()==0)
   await page.wait_for_function("Array.from(document.querySelectorAll('.original-document-canvas')).some(c=>c.width>100&&c.height>100)")
   await check('已匹配档案保留原始单据翻页画面',await page.locator('.draft-preview .original-document-page').count()==2 and await page.locator('.draft-preview .record-sheet').count()==0)
   # Review a failed bank record and voucher, without linking them yet.
   await nav('数据采集');await tab('原始单据');await search('STATUS-D-MANUAL');await page.get_by_role('button',name='补录复核',exact=True).click();await save_review();await check('人工复核保存后未关联单据仍请复核',await one_status()=='请复核' and next(d for d in (await state())['documents'] if d['id']=='status-d-manual')['extractionStatus']=='reviewed')
   await tab('记账凭证');await search('状态-2');await page.get_by_role('button',name='手工匹配',exact=True).click();await save_review();await check('人工核对凭证后仍需完成关联',await one_status()=='请复核' and next(v for v in (await state())['vouchers'] if v['id']=='status-v-manual')['reviewStatus']=='reviewed')
   await archive();await check('仅人工复核但未绑定的数据仍不归档展示',await page.locator('.payer-group').count()==1 and 'STATUS-D-MANUAL' not in await page.locator('.matched-archive-panel').inner_text())
   await nav('智能匹配');await page.wait_for_timeout(400);await check('复核后导航不会自动再次匹配',(await state())['lastMatchRun']['id']==run_id)
   await nav('数据采集');await tab('记账凭证');await search('状态-2');await page.get_by_role('button',name='手工匹配',exact=True).click();dialog=page.locator('.el-dialog:visible').last;await dialog.locator('.candidate-list .el-checkbox').filter(has_text='STATUS-D-MANUAL').click();await dialog.locator('textarea').fill('合成测试，已人工核对原件及金额');await dialog.get_by_role('button',name='确认关联',exact=True).click();await dialog.wait_for(state='hidden')
   await check('人工完成关联后状态才变已匹配归档',await one_status()=='已匹配归档' and next(d for d in (await state())['documents'] if d['id']=='status-d-manual')['status']=='matched')
   await archive();await check('人工关联后电子档案即时加入真实关系',await page.locator('.payer-group').count()==2)
   await page.locator('.payer-group').filter(has=page.get_by_text('状态流程付款乙',exact=True)).click();await check('人工关联的档案只含所选200元单据',await page.locator('.draft-documents .el-table__row').count()==1 and await page.locator('.type-totals strong').all_inner_texts()==['¥ 200.00'])
   await nav('数据采集');await tab('记账凭证');await search('状态-2');await page.get_by_role('button',name='解除匹配',exact=True).click();prompt=page.locator('.el-message-box');await prompt.locator('input').fill('合成解绑检查');await prompt.get_by_role('button',name='确认解除',exact=True).click();await page.wait_for_timeout(150);await check('解除关联后回到请复核',await one_status()=='请复核')
   await archive();await check('解除关联后档案同步移除该组',await page.locator('.payer-group').count()==1 and '状态流程付款乙' not in await page.locator('.matched-archive-panel').inner_text())
   await nav('数据采集');await tab('原始单据');await search('STATUS-D-MATCH');await page.locator('.records-panel .el-table__body-wrapper .el-checkbox').first.click();await page.get_by_role('button',name='批量删除',exact=False).click();await page.get_by_role('button',name='确认删除',exact=True).click();await page.wait_for_timeout(200)
   await archive();await check('删除关联单据后档案无残留凭证或分组',await page.locator('.payer-group').count()==0 and await page.locator('.draft-documents .el-table__row').count()==0)
   await nav('数据采集');await tab('记账凭证');await page.get_by_role('button',name='批量导入凭证',exact=True).click();dialog=page.locator('.batch-import-dialog:visible');payload={'vouchers':[{'no':'新批次-1','period':'2026-10','date':'2026-10-22','summary':'合成新批次','supplier':'新批次客商','amount':'55.00'}]};await dialog.locator('input[type=file]').set_input_files({'name':'new-status-batch.json','mimeType':'application/json','buffer':json.dumps(payload,ensure_ascii=False).encode()});await dialog.get_by_role('button',name='确认导入（1）',exact=True).click();await dialog.wait_for(state='hidden');await search('新批次-1');await check('上一轮运行后新导入批次仍从待匹配开始',await one_status()=='待匹配')
   await page.reload(wait_until='networkidle');await nav('数据采集');await tab('记账凭证');await search('新批次-1');await check('刷新保留未执行新批次的待匹配',await one_status()=='待匹配');await search('状态-2');await check('刷新保留旧未关联记录的请复核',await one_status()=='请复核')
   previous=(await state())['lastMatchRun']['id'];await nav('规则配置');await page.locator('.rule-card').filter(has=page.locator('.rule-id',has_text='R05')).locator('.el-switch').click();await nav('智能匹配');await page.wait_for_timeout(400);await check('改规则和刷新后的导航均不自动执行',(await state())['lastMatchRun']['id']==previous)
   await page.set_viewport_size({'width':390,'height':844});await check('新状态列表手机无页面横向溢出',await page.evaluate('document.body.scrollWidth<=innerWidth'))
   await check('状态及档案闭环无浏览器异常',not errors)
   print(json.dumps({'passed':len(CHECKS),'checks':CHECKS,'errors':errors},ensure_ascii=False),flush=True)
  except Exception:
   await page.screenshot(path=str(ARTIFACTS/'match-status-workflow-failure.png'),full_page=True);print('BROWSER_ERRORS',errors,flush=True);traceback.print_exc();raise
  finally:await browser.close()

if __name__=='__main__':asyncio.run(main())
