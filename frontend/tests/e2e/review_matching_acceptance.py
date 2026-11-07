"""Acceptance for counterparty review, evidence summary and attachment suggestions.
Synthetic records only; requires an isolated local Worker and runtime credentials.
"""
import asyncio
import json
import os
import traceback
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent
ART = ROOT / 'artifacts'
ART.mkdir(exist_ok=True)
CHECKS = []


async def check(label, condition=True):
    if not condition:
        raise AssertionError(label)
    CHECKS.append(label)
    print('PASS ' + label, flush=True)


async def main():
    base = os.getenv('BASE_URL', 'http://127.0.0.1:5175').rstrip('/')
    if urlparse(base).hostname not in {'localhost', '127.0.0.1', '::1'}:
        raise RuntimeError('This write test only accepts an isolated local URL')
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=os.getenv('BROWSER_EXECUTABLE') or None,
            headless=True,
            args=['--no-sandbox'],
        )
        page = await browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.set_default_timeout(45000)
        page.on('pageerror', lambda error: errors.append(str(error)))

        async def state():
            return await page.evaluate("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'))")

        async def nav(label, heading):
            await page.get_by_role('button', name=label, exact=True).first.click()
            await page.locator('h1').filter(has_text=heading).wait_for()
            await page.wait_for_timeout(120)

        async def search(value):
            box = page.get_by_role('textbox', name='搜索凭证或单据', exact=True)
            await box.fill(value)
            await page.get_by_role('button', name='搜索', exact=True).click()
            await page.wait_for_timeout(120)

        try:
            await page.goto(base, wait_until='domcontentloaded', timeout=60000)
            await page.locator('input[autocomplete="username"]').wait_for()
            await page.locator('input[autocomplete="username"]').fill('admin')
            await page.locator('input[autocomplete="current-password"]').fill(os.environ['AUTH_ADMIN_PASSWORD'])
            await page.get_by_role('button', name='立即登录', exact=True).click()
            await page.locator('.app-shell').wait_for()
            await nav('规则配置', '匹配规则配置')
            await page.locator('.rule-card .el-switch').first.click()
            await page.wait_for_function("!!localStorage.getItem('langchao-cloud-demo-v1')")
            await page.evaluate('''()=>{
              const key='langchao-cloud-demo-v1';
              const s=JSON.parse(localStorage.getItem(key));
              s.vouchers=[
                {id:'review-v20',no:'记-20',period:'2026-10',date:'2026-10-20',summary:'异常凭证手工归集验收',supplier:'',amount:100,status:'pending',documentIds:[],reviewStatus:'pending',reviewReasons:['请核对往来客商'],matchReviewRequired:true},
                {id:'review-entry',no:'记-21',period:'2026-10',date:'2026-10-20',summary:'唯一回单候选验收',supplier:'分录验收公司',amount:100,status:'pending',documentIds:[],entryAttachments:[],reviewStatus:'reviewed',entries:[{summary:'收货款',account:'1002 银行存款_尾号3325',debit:'100.00',credit:'0.00'},{summary:'确认收入',account:'6001 主营业务收入',debit:'0.00',credit:'100.00'}]},
                {id:'review-edit',no:'记-22',period:'2026-10',date:'2026-10-20',summary:'已匹配凭证编辑验收',supplier:'原归集公司',amount:80,status:'matched',documentIds:['review-d3'],ruleId:'R05',reviewStatus:'pending',matchReviewRequired:false}
              ];
              s.documents=[
                {id:'review-d1',name:'记二十对应发票.pdf',type:'invoice',number:'REVIEW-20',supplier:'原提取客商',payerName:'原提取客商',payeeName:'核算主体',partyVersion:2,date:'2026-10-20',amount:100,seal:true,status:'pending',extractionStatus:'reviewed'},
                {id:'review-d2',name:'唯一银行回单.pdf',type:'bank',number:'REVIEW-21',supplier:'分录验收公司',payerName:'分录验收公司',payeeName:'核算主体',payeeAccount:'04536101040033325',date:'2026-10-21',amount:100,seal:false,status:'pending',extractionStatus:'reviewed'},
                {id:'review-d3',name:'已匹配发票.pdf',type:'invoice',number:'REVIEW-22',supplier:'原归集公司',payerName:'原归集公司',payeeName:'核算主体',partyVersion:2,date:'2026-10-20',amount:80,seal:true,status:'matched',extractionStatus:'reviewed'}
              ];
              s.archives=[];s.payerGroups=[];s.nameAssociations=[];s.logs=[];delete s.lastMatchRun;
              for(const r of s.rules)r.enabled=r.id==='R09';
              localStorage.setItem(key,JSON.stringify(s));
            }''')
            await page.reload(wait_until='domcontentloaded')
            await page.locator('.app-shell').wait_for()
            await nav('数据采集', '数据采集')
            await search('记-20')

            panel = page.locator('.records-panel')
            before = await panel.bounding_box()
            await page.get_by_role('button', name='记-20', exact=True).click()
            evidence = page.locator('.app-dialog:visible')
            await evidence.locator('.evidence-overview').wait_for()
            text = await evidence.inner_text()
            await check('证据链改为归档摘要、三项核对和下一步操作', await evidence.locator('.evidence-overview').count() == 1 and await evidence.locator('.evidence-checklist').count() == 1 and '金额核对' in text and '尚未形成财务附件关系' in text)
            await check('证据链不再以技术节点、MANUAL或置信度作为主体', 'ERP 记账凭证' not in text and 'MANUAL' not in text and '置信度' not in text)
            await evidence.get_by_role('button', name='关闭', exact=True).click()
            await evidence.wait_for(state='hidden')
            after = await panel.bounding_box()
            await check('证据弹窗关闭后列表位置与宽度稳定', before == after)

            await page.locator('.records-panel .el-table__row:visible').filter(has_text='记-20').get_by_role('button', name='手工匹配', exact=True).first.click()
            dialog = page.locator('.app-dialog:visible')
            supplier = dialog.locator('input[aria-required="true"]')
            await dialog.get_by_role('button', name='保存并复核字段', exact=True).click()
            await dialog.locator('.el-form-item.is-error').wait_for()
            await page.wait_for_timeout(350)
            await check('空往来客商保存被阻止并显示红色错误', await dialog.locator('.el-form-item.is-error').count() >= 1 and any('请填写往来客商名称' in text for text in await dialog.locator('.el-form-item.is-error').all_inner_texts()))
            await dialog.screenshot(path=str(ART / 'counterparty-required-error.png'))
            await supplier.fill('记二十手工归档有限公司')
            await dialog.get_by_role('button', name='保存并复核字段', exact=True).click()
            await page.wait_for_function("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')).vouchers.find(v=>v.id==='review-v20').supplier==='记二十手工归档有限公司'")
            await dialog.locator('.candidate-list .el-checkbox').filter(has_text='REVIEW-20').click()
            await dialog.get_by_role('textbox', name='关联原因（必填）', exact=True).fill('已核对记-20原件、金额及实际往来单位')
            await dialog.get_by_role('button', name='确认关联', exact=True).click()
            await page.wait_for_timeout(500)
            await dialog.wait_for(state='hidden')
            saved = await state()
            voucher = next(v for v in saved['vouchers'] if v['id'] == 'review-v20')
            group = next(g for g in saved['payerGroups'] if 'review-v20' in g['voucherIds'])
            await check('记-20手工匹配后按填写客商进入财务档案分组', voucher['status'] == 'matched' and voucher['documentIds'] == ['review-d1'] and group['payerName'] == '记二十手工归档有限公司')
            await check('人工财务关系不会残留名称归集组', saved['nameAssociations'] == [])
            await nav('电子档案', '电子会计档案')
            await page.locator('.section-tabs').get_by_role('button', name='已匹配归档', exact=False).click()
            await page.locator('.payer-group').filter(has_text='记二十手工归档有限公司').wait_for()
            await check('电子档案页面可见手工填写的公司分组', await page.locator('.payer-group').filter(has_text='记二十手工归档有限公司').count() == 1)

            await nav('数据采集', '数据采集')
            await search('记-22')
            await page.locator('.records-panel .el-table__row:visible').filter(has_text='记-22').get_by_role('button', name='核对字段', exact=True).first.click()
            edit = page.locator('.record-edit-dialog:visible')
            await edit.locator('input[aria-required="true"]').fill('修改后的归集公司')
            await edit.get_by_role('button', name='保存并复核', exact=True).click()
            await edit.wait_for(state='hidden')
            saved = await state()
            voucher = next(v for v in saved['vouchers'] if v['id'] == 'review-edit')
            group = next(g for g in saved['payerGroups'] if 'review-edit' in g['voucherIds'])
            await check('已匹配未锁定凭证允许修改且原关联保留', voucher['supplier'] == '修改后的归集公司' and voucher['documentIds'] == ['review-d3'] and voucher['ruleId'] == 'R05')
            await check('修改客商后档案分组同步更新', group['payerName'] == '修改后的归集公司')

            await search('记-21')
            await page.locator('.records-panel .el-table__row:visible').filter(has_text='记-21').get_by_role('button', name='手工匹配', exact=True).first.click()
            entry = page.locator('.entry-attachments-dialog:visible')
            await entry.get_by_text('唯一银行回单.pdf', exact=True).wait_for()
            await check('唯一金额候选直接显示在对应分录附件栏', await entry.get_by_text('唯一金额候选 · 金额、账号及日期一致', exact=True).count() == 1)
            await check('已有候选时操作改为调整关联而非重复人工复核', await entry.get_by_role('button', name='调整关联第1条分录', exact=True).count() == 1)
            footer = entry.locator('.el-dialog__footer')
            await check('合并复核页底部为取消和保存并复核字段', await footer.get_by_role('button', name='取消', exact=True).count() == 1 and await footer.get_by_role('button', name='保存并复核字段', exact=True).count() == 1)
            await entry.screenshot(path=str(ART / 'entry-unique-candidate.png'))
            await footer.get_by_role('button', name='取消', exact=True).click()
            await entry.wait_for(state='hidden')
            voucher = next(v for v in (await state())['vouchers'] if v['id'] == 'review-entry')
            await check('展示唯一候选不会绕过复核静默核销', voucher['status'] == 'pending' and voucher['documentIds'] == [])

            await page.locator('.records-panel .el-table__row:visible').filter(has_text='记-21').get_by_role('button', name='记-21', exact=True).first.click()
            evidence = page.locator('.app-dialog:visible')
            await evidence.locator('.evidence-overview').wait_for()
            await page.set_viewport_size({'width': 390, 'height': 844})
            await page.wait_for_timeout(200)
            await check('窄屏证据摘要无页面横向溢出', await page.evaluate('document.body.scrollWidth<=innerWidth'))
            await evidence.screenshot(path=str(ART / 'evidence-summary-mobile.png'))
            await evidence.get_by_role('button', name='关闭', exact=True).click()
            await check('本次浏览器验收无JavaScript运行异常', not errors)
            print(json.dumps({'passed': len(CHECKS), 'checks': CHECKS, 'errors': errors}, ensure_ascii=False), flush=True)
        except Exception:
            await page.screenshot(path=str(ART / 'review-matching-acceptance-failure.png'), full_page=True)
            print('BROWSER_ERRORS', errors, flush=True)
            traceback.print_exc()
            raise
        finally:
            await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
