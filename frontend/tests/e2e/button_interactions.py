"""User-facing button contrast and interaction regression, with isolated browser data."""
import asyncio
import json
import os
import traceback
from pathlib import Path

from playwright.async_api import async_playwright
from helpers import install_demo_fixture

ROOT = Path(__file__).resolve().parent
ART = ROOT / 'artifacts'
ART.mkdir(exist_ok=True)
checks = []


async def check(label, condition=True):
    if not condition:
        raise AssertionError(label)
    checks.append(label)
    print('PASS ' + label, flush=True)


# Sample every solid/gradient stop of the button's computed background, composed
# over its real ancestor backgrounds. This catches blue-on-blue even when DOM
# text and opacity are unchanged. Decorative SVG icons are not used as labels.
CONTRAST = """el => {
  const rgba = s => {
    const n = s.match(/[\\d.]+/g)?.map(Number) || [0,0,0,0];
    return [n[0],n[1],n[2],n.length > 3 ? n[3] : 1];
  };
  const over = (a,b) => a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3]));
  const luminance = a => a.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4})
    .reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  let chain = [], p = el;
  while (p) { chain.unshift(p); p=p.parentElement; }
  let backgrounds = [[255,255,255]], parentBackgrounds = backgrounds;
  for (const node of chain) {
    if (node===el) parentBackgrounds=backgrounds;
    const s = getComputedStyle(node), solid = rgba(s.backgroundColor);
    backgrounds = backgrounds.map(b=>over(solid,b));
    const stops = s.backgroundImage.match(/rgba?\\([^)]*\\)/g);
    if (stops) backgrounds = backgrounds.flatMap(b=>stops.map(c=>over(rgba(c),b)));
    if (backgrounds.length>32) backgrounds=backgrounds.slice(0,32);
  }
  const style=getComputedStyle(el), foreground=rgba(style.color);
  const ratios=backgrounds.flatMap(b=>parentBackgrounds.map(parent=>{
    const alpha=Number(style.opacity);
    const x=luminance(over([...over(foreground,b),alpha],parent)),y=luminance(over([...b,alpha],parent));
    return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
  }));
  return {color:style.color,contrast:Math.min(...ratios),opacity:Number(style.opacity),
    visibility:style.visibility,fontSize:parseFloat(style.fontSize),text:el.innerText.trim(),
    background:style.backgroundImage==='none'?style.backgroundColor:style.backgroundImage};
}"""


async def readable(button, label, minimum=4.5, hover=True, white=False):
    await button.scroll_into_view_if_needed()
    if hover:
        await button.hover()
    await button.page.wait_for_timeout(260)
    result = await button.evaluate(CONTRAST)
    valid = result['contrast'] >= minimum and result['opacity'] > .5 and result['visibility'] == 'visible'
    if white:
        valid = valid and result['color'] == 'rgb(255, 255, 255)'
    if not valid:
        print('CONTRAST_FAILURE', label, json.dumps(result, ensure_ascii=False), flush=True)
    await check(label, valid)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.getenv('BROWSER_EXECUTABLE') or None,
                                           headless=True, args=['--no-sandbox'])
        context = await browser.new_context(viewport={'width':1399,'height':1000})
        await install_demo_fixture(context)
        page = await context.new_page()
        page.set_default_timeout(12000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        async def nav(label):
            await page.get_by_role('button', name=label, exact=True).first.click()
            await page.wait_for_timeout(120)
        async def state():
            return await page.evaluate("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'))")
        async def feedback_count(button):
            return await button.evaluate("e=>e.getAnimations().filter(a=>!('transitionProperty' in a)&&a.effect?.getKeyframes().some(f=>'boxShadow' in f)).length")
        try:
            await page.goto(os.getenv('BASE_URL','http://localhost:5174'),wait_until='networkidle')
            await nav('数据采集')
            importer = page.get_by_role('button', name='批量导入凭证', exact=True)
            await page.mouse.move(1000,500)
            await readable(importer,'主操作正常状态白字清晰',hover=False,white=True)
            original_bounds=await importer.bounding_box()
            await readable(importer,'批量导入悬停后仍是高对比白字',white=True)
            hover_bounds=await importer.bounding_box()
            await check('图标悬停不会缩放或淡化整个按钮',abs(original_bounds['width']-hover_bounds['width'])<.5 and abs(original_bounds['height']-hover_bounds['height'])<.5 and (await importer.evaluate(CONTRAST))['opacity']==1)
            await importer.hover()
            await page.mouse.down()
            await readable(importer,'主按钮按下时文字保持清晰',hover=False,white=True)
            await page.mouse.up()
            dialog = page.locator('.batch-import-dialog:visible')
            await dialog.wait_for(state='visible')
            confirm = dialog.get_by_role('button',name='确认导入',exact=False)
            await check('无文件时确认导入保持禁用',await confirm.is_disabled())
            await confirm.evaluate('e=>e.click()')
            await check('禁用按钮点击没有反馈或额外提交',await feedback_count(confirm)==0 and len((await state())['vouchers'])==12)
            payload=[{'VoucherNo':'按钮-0001','Period':'2026-10','Date':'2026-10-23','Abstract':'按钮交互回归','Amount':'19.99','SupplierName':'按钮测试有限公司'}]
            await dialog.locator('input[type=file]').set_input_files({'name':'按钮交互.json','mimeType':'application/json','buffer':json.dumps(payload,ensure_ascii=False).encode()})
            await confirm.wait_for(state='visible')
            await page.wait_for_function("!document.querySelector('.batch-import-dialog button.btn.primary').disabled")
            await readable(confirm,'导入弹窗确认按钮悬停白字清晰',white=True)
            await readable(dialog.get_by_role('button',name='取消',exact=True),'弹窗取消按钮悬停清晰')
            await confirm.click()
            await dialog.wait_for(state='hidden')
            await check('点击特效不会重复执行导入',sum(v['no']=='按钮-0001' for v in (await state())['vouchers'])==1 and sum(l['action']=='批量导入凭证' for l in (await state())['logs'])==1)
            neutral = page.get_by_role('button',name='筛选',exact=True)
            await readable(neutral,'中性筛选按钮悬停可读')
            await neutral.focus()
            await neutral.press('Enter')
            await check('键盘Enter只执行一次并显示轻量点击反馈',await page.locator('.advanced-filters').count()==1 and await feedback_count(neutral)==1)
            await check('键盘操作有明确焦点轮廓',await neutral.evaluate("e=>getComputedStyle(e).outlineStyle!=='none'&&parseFloat(getComputedStyle(e).outlineWidth)>=2"))
            await page.wait_for_timeout(700)
            await neutral.press('Space')
            await check('键盘空格正常切换操作',await page.locator('.advanced-filters').count()==0)
            await page.wait_for_timeout(700)
            await neutral.evaluate('e=>{e.click();e.click();e.click()}')
            await check('连续点击不会堆叠点击光晕',await feedback_count(neutral)<=1 and await page.locator('.advanced-filters').count()==1)
            await page.wait_for_timeout(700)
            await check('点击光晕结束后清理完毕且按钮文字不变',await feedback_count(neutral)==0 and await neutral.inner_text()=='筛选')
            await page.get_by_role('textbox',name='搜索凭证或单据',exact=True).fill('按钮-0001')
            await page.locator('.records-panel .el-table__header-wrapper .el-checkbox').first.check()
            danger = page.get_by_role('button',name='批量删除',exact=True)
            await readable(danger,'危险操作悬停保持红色高对比文字')
            await danger.click()
            box=page.locator('.el-message-box:visible')
            await readable(box.get_by_role('button',name='确认删除',exact=True),'ElementPlus确认按钮悬停可读',white=True)
            await readable(box.get_by_role('button',name='取消',exact=True),'ElementPlus取消按钮悬停可读')
            await box.get_by_role('button',name='取消',exact=True).click()
            await box.wait_for(state='hidden')
            await check('取消删除保持记录',any(v['no']=='按钮-0001' for v in (await state())['vouchers']))
            await danger.click()
            await page.get_by_role('button',name='确认删除',exact=True).click()
            await page.wait_for_timeout(300)
            await check('确认删除只执行一次',not any(v['no']=='按钮-0001' for v in (await state())['vouchers']) and sum(l['action']=='批量删除凭证' for l in (await state())['logs'])==1)
            await nav('工作台')
            await readable(page.get_by_role('button',name='开始采集凭证',exact=True),'工作台主按钮悬停可读',white=True)
            await readable(page.get_by_role('button',name='查看匹配规则',exact=False),'工作台文字按钮悬停可读')
            await nav('智能匹配')
            await readable(page.get_by_role('button',name='开始自动匹配',exact=True),'智能匹配主按钮悬停可读',white=True)
            await nav('异常处理')
            await readable(page.get_by_role('button',name='手工匹配',exact=True).first,'异常复核文字按钮悬停可读')
            await nav('电子档案')
            await readable(page.get_by_role('button',name='生成档案册',exact=True).first,'电子档案主按钮悬停可读',white=True)
            await page.get_by_role('button',name='生成档案册',exact=True).first.click()
            modal=page.locator('.el-dialog:visible').last
            await readable(modal.get_by_role('button',name='校验并生成',exact=True),'归档弹窗主按钮悬停可读',white=True)
            await modal.get_by_role('button',name='取消',exact=True).click()
            await nav('规则配置')
            await readable(page.get_by_role('button',name='配置规则',exact=True).first,'规则配置按钮悬停可读')
            await page.get_by_role('button',name='配置规则',exact=True).first.click()
            modal=page.locator('.el-dialog:visible').last
            await readable(modal.get_by_role('button',name='保存',exact=True),'规则弹窗保存悬停白字清晰',white=True)
            await modal.get_by_role('button',name='取消',exact=True).click()
            await nav('操作日志')
            await readable(page.get_by_role('button',name='操作日志',exact=True).first,'当前导航悬停高对比可读')
            await page.screenshot(path=str(ART/'button-interactions-desktop.png'),full_page=True)
            await nav('数据采集')
            neutral=page.get_by_role('button',name='筛选',exact=True)
            await neutral.click()
            await check('普通偏好下有点击光晕',await feedback_count(neutral)==1)
            await page.emulate_media(reduced_motion='reduce')
            await check('切换减少动态效果会立即清理正在播放的光晕',await feedback_count(neutral)==0)
            await neutral.click()
            await check('减少动态效果下不播放点击光晕',await feedback_count(neutral)==0)
            await readable(page.get_by_role('button',name='批量导入凭证',exact=True),'减少动态效果下悬停文字仍可读',white=True)
            await page.set_viewport_size({'width':390,'height':844})
            await readable(page.get_by_role('button',name='批量导入凭证',exact=True),'手机主按钮悬停文字可读',white=True)
            await check('手机没有整页横向溢出',await page.evaluate('document.body.scrollWidth<=innerWidth'))
            await page.screenshot(path=str(ART/'button-interactions-mobile.png'),full_page=True)
            await check('按钮交互浏览器异常为0',not errors)
            print(json.dumps({'passed':len(checks),'checks':checks,'errors':errors},ensure_ascii=False),flush=True)
        except Exception:
            await page.screenshot(path=str(ART/'button-interactions-failure.png'),full_page=True)
            print('BROWSER_ERRORS',errors,flush=True)
            traceback.print_exc()
            raise
        finally:
            await browser.close()

asyncio.run(main())
