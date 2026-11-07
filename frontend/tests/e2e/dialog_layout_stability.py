"""Classic-scrollbar regression: cancelling dialogs must not move the record list.

Run with ``xvfb-run -a`` so Chromium uses a measurable classic scrollbar.
Only synthetic browser data and an isolated local Worker are used.
"""
import asyncio
import json
import os
import traceback
from pathlib import Path

from playwright.async_api import async_playwright

from dialog_visuals import local_url, nav, settle, sign_in

ROOT = Path(__file__).resolve().parent
ART = ROOT / 'artifacts'
ART.mkdir(exist_ok=True)
CHECKS = []


async def check(label, condition=True):
    if not condition:
        raise AssertionError(label)
    CHECKS.append(label)
    print('PASS ' + label, flush=True)


async def geometry(page, label):
    return await page.evaluate('''label=>{
      const panel=document.querySelector('.records-panel');
      const table=panel.querySelector('.el-table');
      const main=document.querySelector('.main-shell');
      const p=panel.getBoundingClientRect(),t=table.getBoundingClientRect(),m=main.getBoundingClientRect();
      return {
        label,
        bodyWidth:parseFloat(getComputedStyle(document.body).width),
        clientWidth:document.documentElement.clientWidth,
        gutter:getComputedStyle(document.documentElement).scrollbarGutter,
        panel:{left:p.left,right:p.right,width:p.width},
        table:{left:t.left,right:t.right,width:t.width},
        main:{left:m.left,right:m.right,width:m.width}
      };
    }''', label)


def same_geometry(before, after):
    return all(
        abs(before[key] - after[key]) < 0.01
        for key in ['bodyWidth', 'clientWidth']
    ) and all(
        all(abs(before[group][key] - after[group][key]) < 0.01 for key in ['left', 'right', 'width'])
        for group in ['panel', 'table', 'main']
    )


async def main():
    errors = []
    async with async_playwright() as p:
        # Headless Chromium uses zero-width overlay scrollbars and cannot reproduce this defect.
        browser = await p.chromium.launch(
            executable_path=os.getenv('BROWSER_EXECUTABLE') or None,
            headless=False,
            args=['--no-sandbox'],
        )
        page = await browser.new_page(viewport={'width':1440, 'height':767})
        page.set_default_timeout(15000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            await page.goto(local_url(), wait_until='networkidle')
            await sign_in(page, os.environ['AUTH_ADMIN_PASSWORD'])
            scrollbar = await page.evaluate('''()=>{
              const e=document.createElement('div');
              e.style.cssText='position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll';
              document.body.append(e);const width=e.offsetWidth-e.clientWidth;e.remove();return width;
            }''')
            await check('验收浏览器使用可测量的经典滚动条', scrollbar > 0)

            # Persist a synthetic baseline, then install enough rows to require a vertical scrollbar.
            await page.get_by_role('button', name='规则配置', exact=True).first.click()
            await page.locator('.rule-card .el-switch').first.click()
            await page.evaluate('''()=>{
              const key='langchao-cloud-demo-v1',s=JSON.parse(localStorage.getItem(key));
              s.vouchers=Array.from({length:12},(_,i)=>({
                id:'shake-'+i,no:'晃动-'+(i+1),period:'2026-10',date:'2026-10-20',
                summary:'弹窗布局稳定性验收',supplier:'合成验收企业',amount:100+i,
                status:'pending',reviewStatus:'reviewed',extractionStatus:'reviewed',
                expectedAttachments:1,documentIds:[]
              }));
              s.documents=[];s.archives=[];
              localStorage.setItem(key,JSON.stringify(s));
            }''')
            await page.reload(wait_until='networkidle')
            await nav(page, '数据采集', '数据采集')
            await page.locator('.records-panel .el-table__row').first.wait_for()
            await page.locator('.records-panel .el-table__row').first.locator('.el-checkbox').click()

            for round_number in range(1, 4):
                before = await geometry(page, f'第{round_number}次打开前')
                await page.get_by_role('button', name='批量删除', exact=True).click()
                box = page.locator('.el-message-box:visible').last
                await box.wait_for()
                await settle(box)
                opened = await geometry(page, f'第{round_number}次打开后')
                await box.get_by_role('button', name='取消', exact=True).click()
                immediate = await geometry(page, f'第{round_number}次取消即时')
                await page.wait_for_timeout(100)
                middle = await geometry(page, f'第{round_number}次取消100ms')
                await page.wait_for_timeout(200)
                restored = await geometry(page, f'第{round_number}次取消300ms')
                samples = [opened, immediate, middle, restored]
                if not all(same_geometry(before, sample) for sample in samples):
                    print('LAYOUT_SHIFT', json.dumps([before] + samples, ensure_ascii=False), flush=True)
                await check(f'第{round_number}次打开和取消确认框时列表几何尺寸完全稳定',
                            all(same_geometry(before, sample) for sample in samples))
                await box.wait_for(state='hidden')
                count = await page.evaluate(
                    "JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')).vouchers.length")
                await check(f'第{round_number}次取消未删除任何凭证', count == 12)

            before = await geometry(page, '普通弹窗打开前')
            await page.get_by_role('button', name='使用帮助', exact=True).click()
            dialog = page.locator('.help-dialog:visible')
            await dialog.wait_for()
            await settle(dialog)
            opened = await geometry(page, '普通弹窗打开后')
            await page.keyboard.press('Escape')
            await dialog.wait_for(state='hidden')
            await page.wait_for_timeout(300)
            closed = await geometry(page, '普通弹窗关闭后')
            await check('普通表单弹窗开关同样不会引起列表横向位移',
                        same_geometry(before, opened) and same_geometry(before, closed))
            await check('布局稳定性验收未产生浏览器运行异常', not errors)
            print(json.dumps({'passed':len(CHECKS), 'checks':CHECKS, 'errors':errors}, ensure_ascii=False), flush=True)
        except Exception:
            await page.screenshot(path=str(ART / 'dialog-layout-stability-failure.png'), full_page=True)
            print('BROWSER_ERRORS', errors, flush=True)
            traceback.print_exc()
            raise
        finally:
            await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
