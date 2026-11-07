"""Visual and interaction acceptance for every shared dialog family.

Uses synthetic records and a local Worker only. Credentials are supplied at runtime.
"""
import asyncio
import json
import os
import time
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


def local_url():
    base = os.getenv('BASE_URL', 'http://localhost:5187').rstrip('/')
    if urlparse(base).hostname not in {'localhost', '127.0.0.1', '::1'}:
        raise RuntimeError('Dialog write tests require an isolated local Worker URL')
    return base


async def sign_in(page, password):
    await page.locator('input[autocomplete="username"]').first.fill('admin')
    await page.locator('input[autocomplete="current-password"]').fill(password)
    await page.get_by_role('button', name='立即登录', exact=True).click()
    await page.locator('.app-shell').wait_for(state='visible')


async def nav(page, label, heading=None):
    await page.get_by_role('button', name=label, exact=True).first.click()
    if heading:
        await page.locator('h1').filter(has_text=heading).wait_for(state='visible')


async def tab(page, label):
    await page.locator('.section-tabs').get_by_role('button', name=label, exact=False).first.click()


async def search(page, value):
    await page.get_by_role('textbox', name='搜索凭证或单据', exact=True).fill(value)


async def settle(locator):
    await locator.evaluate('''async e=>{
      const scope=e.closest('.el-overlay')||e;
      await Promise.all(scope.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})));
    }''')


async def capture(page, locator, name):
    await settle(locator)
    await locator.screenshot(path=str(ART / (name + '.png')))


async def inspect_dialog(page, locator, label, mobile=False):
    await settle(locator)
    metrics = await locator.evaluate('''(root)=>{
      const rect=root.getBoundingClientRect();
      const title=root.querySelector('.el-dialog__title,.el-message-box__title');
      const body=root.querySelector('.el-dialog__body,.el-message-box__message');
      const buttons=[...root.querySelectorAll('.el-dialog__footer button,.el-dialog__footer a,.el-message-box__btns button')].filter(e=>{
        const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&r.width>0;
      });
      const footer=root.querySelector('.el-dialog__footer,.el-message-box__btns');
      return {
        left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,
        viewportWidth:innerWidth,viewportHeight:innerHeight,
        rootOverflow:document.body.scrollWidth>innerWidth,
        scrollWidth:document.body.scrollWidth,
        offenders:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.position!=='fixed'&&r.width>0&&(r.right>innerWidth+1||r.left<-1)}).slice(0,8).map(e=>({tag:e.tagName,cls:e.className,parent:e.parentElement?.className,html:e.outerHTML.slice(0,180),right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})),
        titleSize:title?parseFloat(getComputedStyle(title).fontSize):0,
        bodySize:body?parseFloat(getComputedStyle(body).fontSize):0,
        bodyLine:body?parseFloat(getComputedStyle(body).lineHeight):0,
        buttons:buttons.map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {
          width:r.width,height:r.height,top:r.top,bottom:r.bottom,whiteSpace:s.whiteSpace,
          scrollHeight:e.scrollHeight,clientHeight:e.clientHeight
        }}),
        footer:footer?(()=>{const r=footer.getBoundingClientRect();return {top:r.top,bottom:r.bottom}})():null
      };
    }''')
    inside = (metrics['left'] >= -1 and metrics['right'] <= metrics['viewportWidth'] + 1
              and metrics['top'] >= -1 and metrics['bottom'] <= metrics['viewportHeight'] + 1)
    minimum = 44 if mobile else 40
    buttons_ok = all(item['height'] >= minimum and item['bottom'] <= metrics['viewportHeight'] + 1
                     and item['whiteSpace'] == 'nowrap' for item in metrics['buttons'])
    footer_ok = not metrics['footer'] or metrics['footer']['bottom'] <= metrics['bottom'] + 1
    passed = (inside and not metrics['rootOverflow'] and metrics['titleSize'] >= 17
              and metrics['bodySize'] >= 13 and metrics['bodyLine'] >= metrics['bodySize'] * 1.7
              and buttons_ok and footer_ok)
    if not passed:
        print('DIALOG_METRICS', label, metrics, flush=True)
    await check(label + '完整可见、标题清晰且操作按钮不溢出', passed)


async def main():
    base = local_url()
    password = os.environ['AUTH_ADMIN_PASSWORD']
    username = 'qa_dialog_' + str(time.time_ns())[-12:]
    errors = []
    logout_requests = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=os.getenv('BROWSER_EXECUTABLE') or None,
            headless=True, args=['--no-sandbox'])
        context = await browser.new_context(viewport={'width':1440, 'height':960})
        page = await context.new_page()
        page.set_default_timeout(20000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: logout_requests.append(request.url)
                if request.method == 'POST' and urlparse(request.url).path == '/api/v1/auth/logout' else None)
        try:
            await page.goto(base, wait_until='networkidle')
            await sign_in(page, password)

            await nav(page, '工作台', '财务档案工作台')
            await check('工作台移除本地工作空间和前往智能匹配',
                        await page.locator('.overview-main .demo-label').count() == 0 and
                        await page.get_by_role('button', name='前往智能匹配', exact=True).count() == 0)
            hero_height = await page.locator('.workspace-hero').evaluate('e=>e.getBoundingClientRect().height')
            await check('工作台主视觉压缩多余留白', hero_height <= 220)
            global_search = page.get_by_role('textbox', name='全局搜索', exact=True)
            await global_search.fill('弹窗全局搜索合成词')
            await page.get_by_role('button', name='搜索', exact=True).click()
            await page.locator('h1').filter(has_text='凭证与档案检索').wait_for()
            await check('顶栏搜索按钮触发全局检索',
                        await page.get_by_role('textbox', name='搜索凭证或单据', exact=True).input_value() == '弹窗全局搜索合成词')
            await global_search.fill('弹窗回车搜索合成词')
            await global_search.press('Enter')
            await check('顶栏回车搜索仍然有效',
                        await page.get_by_role('textbox', name='搜索凭证或单据', exact=True).input_value() == '弹窗回车搜索合成词')
            await nav(page, '工作台', '财务档案工作台')
            await page.screenshot(path=str(ART / 'overview-refined-desktop.png'), full_page=True)
            await page.set_viewport_size({'width':390, 'height':844})
            await check('390px工作台无页面横向溢出',
                        await page.evaluate('document.body.scrollWidth<=innerWidth'))
            await page.screenshot(path=str(ART / 'overview-refined-mobile.png'), full_page=True)
            await page.set_viewport_size({'width':1440, 'height':960})

            # Shared warning confirmation at desktop and the three narrowest supported widths.
            for width in [1440, 768, 414, 390, 375, 360, 320]:
                await page.set_viewport_size({'width':width, 'height':900})
                await page.get_by_role('button', name='退出登录', exact=True).click()
                box = page.locator('.el-message-box:visible').last
                await box.get_by_text('退出登录确认', exact=True).wait_for()
                await inspect_dialog(page, box, f'{width}px退出确认', mobile=width < 761)
                await capture(page, box, f'dialog-logout-{width}')
                await box.get_by_role('button', name='取消', exact=True).click()
                await box.wait_for(state='hidden')
            await check('各尺寸取消退出均未发送注销请求', not logout_requests)
            await page.set_viewport_size({'width':1440, 'height':960})

            # Account form: error, loading-capable primary action and destructive confirmation.
            await nav(page, '用户管理', '用户管理')
            await page.get_by_role('button', name='新增用户', exact=True).click()
            create = page.locator('.create-user-dialog:visible')
            await create.get_by_role('button', name='创建用户', exact=True).click()
            await create.locator('.create-user-error').wait_for()
            await inspect_dialog(page, create, '新增用户错误状态')
            await capture(page, create, 'dialog-create-user-error-desktop')
            await page.set_viewport_size({'width':390, 'height':844})
            await inspect_dialog(page, create, '390px新增用户', mobile=True)
            await capture(page, create, 'dialog-create-user-mobile')
            await page.set_viewport_size({'width':1440, 'height':960})
            await create.get_by_label('姓名 *', exact=True).fill('弹窗验收用户')
            await create.locator('input[autocomplete="username"]').fill(username)
            await create.locator('input[autocomplete="new-password"]').fill('SyntheticDialog_42!')
            await create.get_by_role('button', name='创建用户', exact=True).click()
            await create.wait_for(state='hidden')
            row = page.locator('.users-table tbody tr').filter(has=page.get_by_text(username, exact=True))
            await row.wait_for()
            await row.get_by_role('button', name='删除用户', exact=True).click()
            danger = page.locator('.danger-message-box:visible').last
            await inspect_dialog(page, danger, '删除用户危险确认')
            danger_color = await danger.locator('.el-button--primary').evaluate(
                "e=>getComputedStyle(e).backgroundColor")
            await check('危险确认使用独立红色操作色', danger_color == 'rgb(189, 70, 83)')
            await capture(page, danger, 'dialog-delete-user-desktop')
            await danger.get_by_role('button', name='确认删除', exact=True).click()
            await row.wait_for(state='hidden')

            # Help and rule configuration share the standard content hierarchy.
            await page.get_by_role('button', name='使用帮助', exact=True).click()
            help_dialog = page.locator('.help-dialog:visible')
            await inspect_dialog(page, help_dialog, '使用帮助')
            await capture(page, help_dialog, 'dialog-help-desktop')
            await help_dialog.locator('.el-dialog__headerbtn').click()
            await nav(page, '规则配置', '匹配规则配置')
            await page.locator('.rule-card').first.get_by_role('button').click()
            rule = page.locator('.app-dialog:visible')
            await inspect_dialog(page, rule, '规则配置')
            await capture(page, rule, 'dialog-rule-desktop')
            await page.set_viewport_size({'width':390, 'height':844})
            await inspect_dialog(page, rule, '390px规则配置', mobile=True)
            await capture(page, rule, 'dialog-rule-mobile')
            await page.set_viewport_size({'width':1440, 'height':960})
            await rule.get_by_role('button', name='取消', exact=True).click()

            # Wide import dialog with a real synthetic row, then record and entry review.
            await nav(page, '数据采集', '数据采集')
            await page.get_by_role('button', name='批量导入凭证', exact=True).click()
            batch = page.locator('.batch-import-dialog:visible')
            payload = {'vouchers':[{
                'no':'弹窗-1','period':'2026-10','date':'2026-10-20','summary':'弹窗布局合成验收',
                'supplier':'弹窗验收科技有限公司','amount':'128.00','expectedAttachments':1,
                'entries':[
                    {'summary':'技术服务费','account':'管理费用','debit':'128.00','credit':'0.00'},
                    {'summary':'收入','account':'主营业务收入','debit':'0.00','credit':'128.00'}
                ]
            }]}
            await batch.locator('input[type=file]').set_input_files({
                'name':'dialog-layout.json','mimeType':'application/json',
                'buffer':json.dumps(payload, ensure_ascii=False).encode()})
            await batch.get_by_role('button', name='确认导入（1）', exact=True).wait_for()
            await inspect_dialog(page, batch, '批量导入表格')
            await capture(page, batch, 'dialog-batch-import-desktop')
            await page.set_viewport_size({'width':390, 'height':844})
            await inspect_dialog(page, batch, '390px批量导入', mobile=True)
            await capture(page, batch, 'dialog-batch-import-mobile')
            await page.set_viewport_size({'width':1440, 'height':960})
            await batch.get_by_role('button', name='确认导入（1）', exact=True).click()
            await batch.wait_for(state='hidden')
            await search(page, '弹窗-1')
            record_row = page.locator('.records-panel .el-table__row').filter(
                has=page.get_by_role('button', name='弹窗-1', exact=True))
            await check('待复核凭证操作列不显示补录和关联穿透',
                        await record_row.get_by_role('button', name='补录', exact=True).count() == 0 and
                        await record_row.get_by_role('button', name='关联穿透', exact=True).count() == 0)
            await record_row.get_by_role('button', name='标记缺失', exact=True).click()
            missing = page.locator('.app-dialog:visible')
            await missing.locator('textarea').fill('合成验收：发票原件尚未收到')
            await missing.get_by_role('button', name='保存', exact=True).click()
            await missing.wait_for(state='hidden')
            await check('标记缺失后凭证号旁显示醒目缺字和具体原因',
                        await record_row.locator('.missing-flag').inner_text() == '缺' and
                        await record_row.locator('.status').inner_text() == '附件缺失' and
                        '发票原件尚未收到' in await record_row.locator('.voucher-match-hint').inner_text())
            await record_row.get_by_role('button', name='恢复待匹配', exact=True).click()
            await record_row.get_by_role('button', name='手工匹配', exact=True).click()
            edit = page.locator('.entry-attachments-dialog:visible')
            for width in [1440, 768, 390, 320]:
                await page.set_viewport_size({'width':width, 'height':960})
                await inspect_dialog(page, edit, f'{width}px合并字段与分录复核', mobile=width < 761)
                await capture(page, edit, f'dialog-merged-review-{width}')
            await page.set_viewport_size({'width':1440, 'height':960})
            await edit.get_by_role('button', name='保存并复核字段', exact=True).click()
            await check('凭证字段与分录附件合并在同一手工匹配页',
                        await edit.locator('.voucher-field-review').count() == 1 and
                        await edit.locator('.el-table').count() == 1)
            entries = edit
            await check('合并复核主弹窗不显示单独取消按钮',
                        await entries.get_by_role('button', name='取消', exact=True).count() == 0)
            await inspect_dialog(page, entries, '凭证分录复核')
            await capture(page, entries, 'dialog-entry-attachments-desktop')
            await entries.get_by_role('button', name='确认', exact=True).click()
            exemption = page.locator('.attachment-exemption-dialog:visible')
            await inspect_dialog(page, exemption, '无需外部附件确认')
            await capture(page, exemption, 'dialog-attachment-exemption-desktop')
            await page.set_viewport_size({'width':390, 'height':844})
            await inspect_dialog(page, exemption, '390px无需外部附件确认', mobile=True)
            await capture(page, exemption, 'dialog-attachment-exemption-mobile')
            await page.set_viewport_size({'width':1440, 'height':960})
            await exemption.get_by_role('button', name='取消', exact=True).click()
            await entries.get_by_role('button', name='人工复核第1条分录', exact=True).click()
            review = page.locator('.entry-review-dialog:visible')
            await inspect_dialog(page, review, '人工分录分摊')
            await capture(page, review, 'dialog-entry-review-desktop')
            await page.set_viewport_size({'width':390, 'height':844})
            await inspect_dialog(page, review, '390px人工分录分摊', mobile=True)
            await capture(page, review, 'dialog-entry-review-mobile')
            await page.set_viewport_size({'width':1440, 'height':960})
            await review.locator('textarea').fill('合成验收：已核对分录与原件，暂仅保存复核依据')
            await review.get_by_role('button', name='保存分摊与关联', exact=True).click()
            await review.wait_for(state='hidden')
            await entries.wait_for(state='hidden')
            await check('人工复核留痕后子弹窗和主弹窗均关闭并返回列表',
                        await record_row.is_visible() and
                        await page.locator('.entry-review-dialog:visible').count() == 0 and
                        await page.locator('.entry-attachments-dialog:visible').count() == 0)

            await record_row.get_by_role('button', name='手工匹配', exact=True).click()
            entries = page.locator('.entry-attachments-dialog:visible')
            await entries.get_by_role('button', name='确认', exact=True).click()
            exemption = page.locator('.attachment-exemption-dialog:visible')
            await exemption.locator('textarea').fill('合成验收：内部结转凭证，无外部原始单据')
            await exemption.get_by_role('button', name='确认并留痕', exact=True).click()
            await exemption.wait_for(state='hidden')
            await entries.wait_for(state='hidden')
            await check('附件豁免留痕后同样直接返回列表', await record_row.is_visible())

            # Archive creation uses the same form hierarchy without changing range validation.
            await nav(page, '电子档案', '电子会计档案')
            await page.get_by_role('button', name='生成档案册', exact=True).first.click()
            archive = page.locator('.app-dialog:visible')
            await inspect_dialog(page, archive, '生成档案册范围')
            await capture(page, archive, 'dialog-archive-range-desktop')
            await page.set_viewport_size({'width':390, 'height':844})
            await inspect_dialog(page, archive, '390px生成档案册范围', mobile=True)
            await capture(page, archive, 'dialog-archive-range-mobile')
            await page.set_viewport_size({'width':1440, 'height':960})
            await archive.get_by_role('button', name='取消', exact=True).click()

            # A real uploaded PDF exercises preview, footer actions and narrow-screen scrolling.
            await nav(page, '数据采集', '数据采集')
            await tab(page, '原始单据')
            await page.get_by_role('button', name='批量上传单据', exact=True).click()
            batch = page.locator('.batch-import-dialog:visible')
            await batch.locator('input[type=file]').set_input_files(str(ROOT / 'manual-invoice.pdf'))
            await page.wait_for_function("!document.querySelector('.batch-import-dialog .upload-zone')?.disabled")
            for name, value in [('客商名称','弹窗预览验收企业'),('日期','2026-10-21'),
                                ('金额','66.00'),('单据编号','DIALOG-PREVIEW')]:
                await batch.get_by_role('textbox', name=name, exact=True).fill(value)
            await batch.get_by_role('button', name='确认导入（1）', exact=True).click()
            await batch.wait_for(state='hidden')
            await search(page, 'DIALOG-PREVIEW')
            document_row = page.locator('.records-panel .el-table__row').filter(has_text='DIALOG-PREVIEW')
            await document_row.locator('.doc-name').click()
            preview = page.locator('.file-preview-dialog:visible')
            await preview.locator('iframe').wait_for()
            await inspect_dialog(page, preview, '原件预览')
            await capture(page, preview, 'dialog-file-preview-desktop')
            await page.set_viewport_size({'width':390, 'height':844})
            await inspect_dialog(page, preview, '390px原件预览', mobile=True)
            await capture(page, preview, 'dialog-file-preview-mobile')
            await preview.get_by_role('button', name='关闭', exact=True).click()

            # Keyboard focus remains visible and reduced-motion is respected by shared controls.
            await page.get_by_role('button', name='退出登录', exact=True).click()
            box = page.locator('.el-message-box:visible').last
            cancel = box.get_by_role('button', name='取消', exact=True)
            await cancel.focus()
            await page.keyboard.press('Tab')
            await page.keyboard.press('Shift+Tab')
            outline = await cancel.evaluate(
                "e=>({focused:document.activeElement===e,visible:e.matches(':focus-visible'),style:getComputedStyle(e).outlineStyle,width:parseFloat(getComputedStyle(e).outlineWidth)})")
            await check('键盘焦点使用不改动布局的明显焦点环',
                        outline['focused'] and outline['visible'] and outline['style'] == 'solid' and outline['width'] >= 3)
            await page.keyboard.press('Escape')
            await box.wait_for(state='hidden')
            await check('弹窗验收未产生浏览器运行异常', not errors)
            print(json.dumps({'passed':len(CHECKS), 'checks':CHECKS, 'errors':errors}, ensure_ascii=False), flush=True)
        except Exception:
            await page.screenshot(path=str(ART / 'dialog-visuals-failure.png'), full_page=True)
            print('BROWSER_ERRORS', errors, flush=True)
            traceback.print_exc()
            raise
        finally:
            await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
