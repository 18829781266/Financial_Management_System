"""Local Worker/D1 acceptance for logout confirmation, user deletion and branding.

Never run account write/delete tests against a published Site. Credentials come
from AUTH_ADMIN_PASSWORD at runtime; only fictional test-user passwords live here.
"""
import asyncio
import json
import os
import re
import time
import traceback
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright

ART = Path(__file__).resolve().parent / 'artifacts'
ART.mkdir(exist_ok=True)
CHECKS = []
USER_PASSWORD = 'SyntheticAction_42!'


async def check(label, condition=True):
    if not condition:
        raise AssertionError(label)
    CHECKS.append(label)
    print('PASS ' + label, flush=True)


def local_url():
    base = os.getenv('BASE_URL', 'http://localhost:5175').rstrip('/')
    parsed = urlparse(base)
    if parsed.hostname not in {'localhost', '127.0.0.1', '::1'} or parsed.username or parsed.password:
        raise RuntimeError('Account deletion tests require an isolated local Worker URL')
    return base


async def sign_in(page, username, password):
    await page.locator('input[autocomplete="username"]').first.fill(username)
    await page.locator('input[autocomplete="current-password"]').fill(password)
    await page.get_by_role('button', name='登录工作空间', exact=True).click()


async def message_box(page, title):
    dialog = page.locator('.el-message-box:visible').last
    await dialog.wait_for(state='visible')
    await dialog.get_by_text(title, exact=True).wait_for(state='visible')
    return dialog


async def no_overflow(page):
    return await page.evaluate('document.body.scrollWidth <= innerWidth')


async def settle_dialog(locator):
    # Visibility alone does not await the opacity/scale entrance transition.
    # Await real animations rather than using a fixed browser sleep in screenshots.
    await locator.evaluate('''async e=>{
      const scope=e.closest('.el-overlay')||e;
      await Promise.all(scope.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})));
    }''')


async def inside_viewport(locator):
    return await locator.evaluate('''e=>{const b=e.getBoundingClientRect();
      return b.left>=-1&&b.right<=innerWidth+1&&b.top>=-1&&b.bottom<=innerHeight+1;}''')


async def cookie_header(context, base):
    return '; '.join(item['name'] + '=' + item['value']
                     for item in await context.cookies(base) if item['httpOnly'])


async def main():
    base = local_url()
    admin_password = os.getenv('AUTH_ADMIN_PASSWORD')
    if not admin_password:
        raise RuntimeError('Set AUTH_ADMIN_PASSWORD for the isolated local administrator')
    suffix = str(time.time_ns())[-13:]
    username = 'qa_delete_' + suffix
    control_username = 'qa_keep_' + suffix
    display_name = '删除验收会计'
    errors = []
    created_ids = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=os.getenv('BROWSER_EXECUTABLE') or None,
            headless=True, args=['--no-sandbox'])
        admin_context = await browser.new_context(viewport={'width':1399, 'height':895})
        page = await admin_context.new_page()
        page.set_default_timeout(20000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        extra_contexts = []
        logout_requests = []
        delete_requests = []
        page.on('request', lambda request: logout_requests.append(request.url)
                if request.method == 'POST' and urlparse(request.url).path == '/api/v1/auth/logout' else None)
        page.on('request', lambda request: delete_requests.append(urlparse(request.url).path)
                if request.method == 'DELETE' and '/api/v1/users/' in request.url else None)
        try:
            await page.goto(base, wait_until='networkidle')
            await page.locator('input[autocomplete="current-password"]').wait_for(state='visible')
            await check('未登录页面显示汇通云新品牌和英文标识',
                        '汇通云' in await page.locator('.login-brand').inner_text()
                        and 'HUITONG CLOUD' in await page.locator('.login-brand').inner_text()
                        and '浪潮云' not in await page.locator('body').inner_text()
                        and '汇通云' in await page.title())
            favicon = await page.locator('link[rel="icon"]').get_attribute('href')
            logo = await page.locator('.login-brand img').get_attribute('src')
            asset = await page.request.get(base + '/huitong-cloud.svg')
            await check('新云标识与浏览器标签图标使用同一可加载矢量资产',
                        favicon == '/huitong-cloud.svg' and logo == favicon
                        and asset.status == 200 and '<svg' in await asset.text())
            for width in [1399,390,360]:
                await page.set_viewport_size({'width':width,'height':895})
                await check(str(width)+'px新品牌登录页无横向溢出且登录控件可见',
                            await no_overflow(page)
                            and await page.locator('input[autocomplete="username"]').is_visible()
                            and await page.get_by_role('button',name='登录工作空间',exact=True).is_visible())
                await page.screenshot(path=str(ART / ('account-login-'+str(width)+'.png')))
            await page.set_viewport_size({'width':1399,'height':895})
            await sign_in(page, 'admin', admin_password)
            await page.locator('.app-shell').wait_for(state='visible')
            identity = await page.request.get(base + '/api/v1/auth/me')
            admin_user = (await identity.json())['user']
            await check('管理员登录后侧栏及页面标题已改名汇通云',
                        admin_user['role']=='SUPER_ADMIN'
                        and '汇通云' in await page.locator('.brand').inner_text()
                        and 'HUITONG CLOUD' in await page.locator('.brand').inner_text()
                        and '汇通云' in await page.title()
                        and await page.locator('.brand img').get_attribute('src')=='/huitong-cloud.svg')
            await page.get_by_role('button',name='使用帮助',exact=True).click()
            help_dialog = page.locator('.el-dialog:visible').last
            await check('使用帮助中的产品名称同步更新',
                        '汇通云' in await help_dialog.locator('.help-brand').inner_text()
                        and '浪潮云' not in await help_dialog.inner_text())
            await help_dialog.locator('button.el-dialog__headerbtn').click()
            await help_dialog.wait_for(state='hidden')

            before_logout = len(logout_requests)
            await page.get_by_role('button',name='退出登录',exact=True).click()
            confirm = await message_box(page,'退出登录确认')
            me = await page.request.get(base+'/api/v1/auth/me')
            await check('点击退出只打开确认框，确认前仍保持会话且不发送退出请求',
                        me.status==200 and len(logout_requests)==before_logout
                        and await confirm.get_by_role('button',name='确认退出',exact=True).is_visible())
            await confirm.get_by_role('button',name='取消',exact=True).click()
            await confirm.wait_for(state='hidden')
            me = await page.request.get(base+'/api/v1/auth/me')
            await check('取消退出保留工作区及有效登录状态',
                        me.status==200 and await page.locator('.app-shell').is_visible()
                        and len(logout_requests)==before_logout)
            await page.get_by_role('button',name='退出登录',exact=True).click()
            confirm = await message_box(page,'退出登录确认')
            await page.keyboard.press('Escape')
            await confirm.wait_for(state='hidden')
            await check('Escape关闭退出确认框也不会注销会话',
                        len(logout_requests)==before_logout
                        and (await page.request.get(base+'/api/v1/auth/me')).status==200)
            old_admin_cookie = await cookie_header(admin_context,base)
            await page.get_by_role('button',name='退出登录',exact=True).click()
            confirm = await message_box(page,'退出登录确认')
            await confirm.get_by_role('button',name='确认退出',exact=True).click()
            await page.locator('input[autocomplete="current-password"]').wait_for(state='visible')
            replay = await p.request.new_context(extra_http_headers={'Cookie':old_admin_cookie})
            replay_result = await replay.get(base+'/api/v1/auth/me')
            await replay.dispose()
            await check('确认退出只提交一次并立即撤销原服务端会话',
                        len(logout_requests)==before_logout+1 and replay_result.status==401
                        and await page.locator('.app-shell').count()==0)

            await sign_in(page,'admin',admin_password)
            await page.locator('.app-shell').wait_for(state='visible')
            await page.get_by_role('button',name='用户管理',exact=True).first.click()
            await page.get_by_role('button',name='新增用户',exact=True).click()
            create = page.locator('.el-dialog:visible').last
            await create.get_by_label(re.compile('姓名')).fill(display_name)
            await create.locator('input[autocomplete="username"]').fill(username)
            await create.locator('input[autocomplete="new-password"]').fill(USER_PASSWORD)
            await create.get_by_role('button',name='创建用户',exact=True).click()
            await create.wait_for(state='hidden')
            target_row = page.locator('.users-table tbody tr').filter(has=page.get_by_text(username,exact=True))
            await target_row.wait_for(state='visible')
            users_response = await page.request.get(base+'/api/v1/users')
            users = (await users_response.json())['users']
            target = next(user for user in users if user['username']==username)
            created_ids.append(target['id'])
            control_response = await page.request.post(base+'/api/v1/users',headers={'Origin':base},data={
                'username':control_username,'displayName':'保留验收会计','password':USER_PASSWORD})
            assert control_response.status==201
            control = (await control_response.json())['user'];created_ids.append(control['id'])
            await page.get_by_role('button',name='刷新用户列表',exact=True).click()
            await target_row.wait_for(state='visible')
            await check('普通用户行提供删除按钮，超级管理员行无删除入口',
                        await target_row.get_by_role('button',name='删除用户',exact=True).is_visible()
                        and await page.locator('.users-table tbody tr').filter(has=page.get_by_text('admin',exact=True))
                            .get_by_role('button',name='删除用户',exact=True).count()==0)
            for i in range(2):
                context=await browser.new_context(viewport={'width':1399,'height':895});extra_contexts.append(context)
                user_page=await context.new_page();user_page.set_default_timeout(20000)
                user_page.on('pageerror',lambda error:errors.append(str(error)))
                await user_page.goto(base,wait_until='networkidle')
                await sign_in(user_page,username,USER_PASSWORD)
                await user_page.locator('.app-shell').wait_for(state='visible')
            ordinary_context = extra_contexts[0]
            ordinary_page = ordinary_context.pages[0]
            await check('待删除普通账号已在两个独立浏览器会话中成功登录',
                        all([(await context.request.get(base+'/api/v1/auth/me')).status==200
                             for context in extra_contexts]))
            forbidden = await ordinary_context.request.delete(base+'/api/v1/users/'+target['id'],
                        headers={'Origin':base},data={})
            anonymous = await p.request.new_context()
            anonymous_delete = await anonymous.delete(base+'/api/v1/users/'+target['id'],headers={'Origin':base},data={})
            await anonymous.dispose()
            await check('普通用户及未登录者直接删除接口分别被403和401拒绝',
                        forbidden.status==403 and anonymous_delete.status==401)
            protect_admin = await page.request.delete(base+'/api/v1/users/'+admin_user['id'],headers={'Origin':base},data={})
            csrf = await page.request.delete(base+'/api/v1/users/'+target['id'],headers={'Origin':'https://foreign.invalid'},data={})
            await check('服务端禁止删除超级管理员并拒绝跨站删除请求',
                        protect_admin.status==403 and csrf.status==403)
            before_delete=len(delete_requests)
            await target_row.get_by_role('button',name='删除用户',exact=True).click()
            delete = await message_box(page,'删除用户确认')
            await check('删除确认框显示目标账号且确认前没有发送删除请求',
                        username in await delete.inner_text() and display_name in await delete.inner_text()
                        and len(delete_requests)==before_delete)
            await delete.get_by_role('button',name='取消',exact=True).click()
            await delete.wait_for(state='hidden')
            users=(await (await page.request.get(base+'/api/v1/users')).json())['users']
            await check('取消删除保留目标账号和已登录会话',
                        any(user['id']==target['id'] for user in users)
                        and (await ordinary_context.request.get(base+'/api/v1/auth/me')).status==200
                        and len(delete_requests)==before_delete)
            for width in [390,360]:
                await page.set_viewport_size({'width':width,'height':895})
                await target_row.get_by_role('button',name='删除用户',exact=True).click()
                delete=await message_box(page,'删除用户确认')
                await check(str(width)+'px删除确认完整可见且列表不造成整页横向溢出',
                            await no_overflow(page) and await inside_viewport(delete)
                            and await delete.get_by_role('button',name='确认删除',exact=True).is_visible())
                await settle_dialog(delete)
                await page.screenshot(path=str(ART/('account-delete-confirm-'+str(width)+'.png')))
                await delete.get_by_role('button',name='取消',exact=True).click();await delete.wait_for(state='hidden')
                await page.get_by_role('button',name='退出登录',exact=True).click()
                confirm=await message_box(page,'退出登录确认')
                await check(str(width)+'px退出确认完整可见且取消后不注销',
                            await inside_viewport(confirm) and await no_overflow(page))
                await confirm.get_by_role('button',name='取消',exact=True).click();await confirm.wait_for(state='hidden')
            await page.set_viewport_size({'width':1399,'height':895})
            await target_row.get_by_role('button',name='删除用户',exact=True).click()
            delete=await message_box(page,'删除用户确认')
            await delete.get_by_role('button',name='确认删除',exact=True).click()
            await delete.wait_for(state='hidden')
            await target_row.wait_for(state='detached')
            users=(await (await page.request.get(base+'/api/v1/users')).json())['users']
            await check('确认删除只提交一次并从列表及服务端移除目标用户',
                        len(delete_requests)==before_delete+1 and not any(user['id']==target['id'] for user in users))
            await check('删除仅作用于选定普通账号，管理员和其他账号仍保留',
                        any(user['id']==admin_user['id'] for user in users)
                        and any(user['id']==control['id'] for user in users)
                        and (await page.request.get(base+'/api/v1/auth/me')).status==200)
            statuses=[]
            for context in extra_contexts:
                statuses.append((await context.request.get(base+'/api/v1/auth/me')).status)
            await check('目标账号全部既有登录会话立即失效',statuses==[401,401])
            for context in extra_contexts:
                user_page=context.pages[0]
                await user_page.reload(wait_until='networkidle')
                await user_page.locator('input[autocomplete="current-password"]').wait_for(state='visible')
            await check('已删除账号刷新后回到登录页且不能再进入业务区',
                        all([await context.pages[0].locator('.app-shell').count()==0 for context in extra_contexts]))
            await sign_in(ordinary_page,username,USER_PASSWORD)
            await ordinary_page.locator('[role="alert"]').first.wait_for(state='visible')
            await check('被删除的普通账号无法重新登录',await ordinary_page.locator('.app-shell').count()==0)
            duplicate = await page.request.delete(base+'/api/v1/users/'+target['id'],headers={'Origin':base},data={})
            await check('再次删除不存在的目标返回404且不影响管理员登录',
                        duplicate.status==404 and (await page.request.get(base+'/api/v1/auth/me')).status==200)
            await page.get_by_role('button',name='电子档案',exact=True).first.click()
            await page.get_by_role('heading',name='电子会计档案',exact=True).wait_for(state='visible')
            await check('管理操作完成后仍可返回原电子档案模块',await page.locator('.app-shell').is_visible())
            await check('本轮账号操作与新品牌流程无浏览器异常',not errors)
            print(json.dumps({'passed':len(CHECKS),'checks':CHECKS,'errors':errors},ensure_ascii=False),flush=True)
        except Exception:
            await page.screenshot(path=str(ART/'account-actions-failure.png'),full_page=True)
            print('BROWSER_ERRORS',errors,flush=True)
            traceback.print_exc()
            raise
        finally:
            # Cleanup is local-only and limited to IDs created by this execution.
            for user_id in created_ids:
                try:
                    await page.request.delete(base+'/api/v1/users/'+user_id,headers={'Origin':base},data={})
                except Exception:
                    pass
            for context in extra_contexts:
                await context.close()
            await admin_context.close();await browser.close()


asyncio.run(main())
