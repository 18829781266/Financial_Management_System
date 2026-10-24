"""Real Worker/D1 authentication and role checks, using isolated local storage.

Run only against a local test Worker, never the published Site:
  BASE_URL=http://localhost:8787 BROWSER_EXECUTABLE=/usr/bin/chromium \
    AUTH_ADMIN_PASSWORD=<local test admin password> python tests/e2e/auth_flow.py
The administrator password is supplied at runtime; this file contains only a
fictional ordinary-user password. Test accounts are created only in local D1.
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

ROOT = Path(__file__).resolve().parent
ART = ROOT / 'artifacts'
ART.mkdir(exist_ok=True)
CHECKS = []
ORDINARY_PASSWORD = 'SyntheticUser_42!'


async def check(label, condition=True):
    if not condition:
        raise AssertionError(label)
    CHECKS.append(label)
    print('PASS ' + label, flush=True)


def local_base_url():
    base = os.getenv('BASE_URL', 'http://localhost:8787').rstrip('/')
    if urlparse(base).hostname not in {'localhost', '127.0.0.1', '::1'}:
        raise RuntimeError('Authentication write tests require an isolated local Worker URL')
    return base


async def sign_in(page, username, password):
    await page.locator('input[autocomplete="username"]').first.fill(username)
    await page.locator('input[autocomplete="current-password"]').fill(password)
    await page.get_by_role('button', name='登录工作空间', exact=True).click()


async def sign_out(page):
    await page.get_by_role('button', name='退出登录', exact=True).click()
    confirmation = page.locator('.el-message-box:visible').last
    await confirmation.get_by_text('退出登录确认', exact=True).wait_for(state='visible')
    await confirmation.get_by_role('button', name='确认退出', exact=True).click()
    await page.locator('input[autocomplete="current-password"]').wait_for(state='visible')


async def assert_no_stored_credentials(page, *passwords):
    storage = await page.evaluate('''() => ({
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage))
    })''')
    serialized = json.dumps(storage, ensure_ascii=False)
    for password in passwords:
        if password in serialized:
            return False
    # Account authority and opaque session tokens belong on the server. Existing
    # accounting records can legitimately contain unrelated role descriptions.
    for key, value in {**storage['local'], **storage['session']}.items():
        if re.search(r'auth|session|password|token|current.?user', key, re.I):
            if re.search(r'SUPER_ADMIN|USER|password|token|session', str(value), re.I):
                return False
    return True


async def main():
    base = local_base_url()
    admin_password = os.getenv('AUTH_ADMIN_PASSWORD')
    if not admin_password:
        raise RuntimeError('Set AUTH_ADMIN_PASSWORD for the isolated local administrator')
    username = 'qa_user_' + str(time.time_ns())[-13:]
    display_name = '验收普通用户'
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=os.getenv('BROWSER_EXECUTABLE') or None,
            headless=True, args=['--no-sandbox'])
        admin_context = await browser.new_context(viewport={'width':1399, 'height':895})
        page = await admin_context.new_page()
        page.set_default_timeout(20000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        ordinary_context = None
        try:
            await page.goto(base, wait_until='networkidle')
            await page.locator('input[autocomplete="current-password"]').wait_for(state='visible')
            await check('未登录只显示登录页，不展示业务工作区',
                        await page.locator('.app-shell').count() == 0)
            anonymous = await page.request.get(base + '/api/v1/auth/me')
            anonymous_list = await page.request.get(base + '/api/v1/users')
            anonymous_create = await page.request.post(base + '/api/v1/users', headers={'Origin':base}, data={
                'username':username, 'displayName':display_name, 'password':ORDINARY_PASSWORD})
            await check('未登录的会话查询及用户管理API均拒绝访问',
                        anonymous.status == 401 and anonymous_list.status == 401
                        and anonymous_create.status == 401)
            for width in [1399, 390, 360]:
                await page.set_viewport_size({'width':width, 'height':895})
                await check(str(width) + 'px登录页控件可见且没有页面横向溢出',
                            await page.locator('input[autocomplete="username"]').is_visible()
                            and await page.locator('input[autocomplete="current-password"]').is_visible()
                            and await page.evaluate('document.body.scrollWidth <= innerWidth'))
                await page.screenshot(path=str(ART / ('auth-login-' + str(width) + '.png')))
            await page.set_viewport_size({'width':1399, 'height':895})
            password_field = page.locator('input[autocomplete="current-password"]')
            await password_field.fill('SyntheticVisibility_42!')
            await page.get_by_role('button', name='显示密码', exact=True).click()
            visible_password = await password_field.get_attribute('type') == 'text'
            await page.get_by_role('button', name='隐藏密码', exact=True).click()
            await check('密码可切换显示并恢复隐藏且不丢失输入',
                        visible_password and await password_field.get_attribute('type') == 'password'
                        and await password_field.input_value() == 'SyntheticVisibility_42!')
            await sign_in(page, 'admin', 'DefinitelyWrong_42!')
            await page.locator('[role="alert"]').first.wait_for(state='visible')
            await check('错误密码保留登录页并给出明确错误提示',
                        await page.locator('input[autocomplete="current-password"]').is_visible()
                        and await page.locator('.app-shell').count() == 0)
            await sign_in(page, 'admin', admin_password)
            await page.locator('.app-shell').wait_for(state='visible')
            identity = await page.request.get(base + '/api/v1/auth/me')
            admin_user = (await identity.json())['user']
            await check('超级管理员登录成功且显示赵会计及真实角色',
                        identity.status == 200 and admin_user['username'] == 'admin'
                        and admin_user['displayName'] == '赵会计'
                        and admin_user['role'] == 'SUPER_ADMIN'
                        and '赵会计' in await page.locator('.profile').inner_text()
                        and '超级管理员' in await page.locator('.profile').inner_text())
            auth_cookies = [cookie for cookie in await admin_context.cookies(base) if cookie['httpOnly']]
            await check('登录会话使用HttpOnly且SameSite受限的安全Cookie',
                        len(auth_cookies) >= 1 and all(cookie['secure']
                        and cookie['sameSite'] in {'Strict', 'Lax'} for cookie in auth_cookies))
            old_admin_cookie = '; '.join(cookie['name'] + '=' + cookie['value'] for cookie in auth_cookies)
            readable_cookies = await page.evaluate('document.cookie')
            await check('浏览器脚本无法读取HttpOnly登录令牌',
                        all(cookie['value'] not in readable_cookies for cookie in auth_cookies))
            await check('密码及权限会话没有保存在前端持久存储',
                        await assert_no_stored_credentials(page, admin_password, ORDINARY_PASSWORD))
            await page.reload(wait_until='networkidle')
            await page.locator('.app-shell').wait_for(state='visible')
            await check('刷新后由服务端会话恢复管理员登录状态',
                        '赵会计' in await page.locator('.profile').inner_text())
            for label, heading in [('工作台','财务档案工作台'),('数据采集','数据采集'),
                                   ('智能匹配','智能凭证匹配'),('异常处理','异常处理'),
                                   ('电子档案','电子会计档案'),('规则配置','匹配规则配置'),
                                   ('操作日志','操作日志')]:
                await page.get_by_role('button', name=label, exact=True).first.click()
                await page.get_by_role('heading', name=heading, exact=True).wait_for(state='visible')
                await check('登录后' + label + '业务模块可正常进入',
                            await page.locator('.app-shell').is_visible())
            await page.get_by_role('button', name='数据采集', exact=True).first.click()
            await page.get_by_role('button', name='批量导入凭证', exact=True).click()
            batch_dialog = page.locator('.el-dialog:visible').last
            await batch_dialog.wait_for(state='visible')
            await check('登录门禁不影响批量导入弹窗入口',
                        await batch_dialog.locator('input[type="file"]').count() > 0)
            await batch_dialog.get_by_role('button', name='取消', exact=True).click()
            await batch_dialog.wait_for(state='hidden')
            await page.get_by_role('button', name='用户管理', exact=True).first.click()
            await page.get_by_role('button', name='新增用户', exact=True).click()
            dialog = page.locator('.el-dialog:visible').last
            await dialog.locator('input[autocomplete="username"]').fill(username)
            await dialog.get_by_label(re.compile('姓名|显示名')).fill(display_name)
            await dialog.locator('input[autocomplete="new-password"]').fill(ORDINARY_PASSWORD)
            await dialog.get_by_role('button', name='创建用户', exact=True).click()
            await dialog.wait_for(state='hidden')
            await page.get_by_text(username, exact=True).wait_for(state='visible')
            listed = await page.request.get(base + '/api/v1/users')
            users = (await listed.json())['users']
            created = next(user for user in users if user['username'] == username)
            await check('管理员在后台添加的用户保存到服务端且固定普通角色',
                        created['displayName'] == display_name and created['role'] == 'USER')
            await check('用户管理响应不暴露密码摘要、盐或会话令牌',
                        all(not any(re.search(r'password|salt|hash|token|secret', key, re.I)
                                    for key in user) for user in users))
            await page.screenshot(path=str(ART / 'auth-users-desktop.png'))
            await page.set_viewport_size({'width':390, 'height':895})
            await check('手机用户管理页面可浏览且没有页面横向溢出',
                        await page.locator('.user-management').is_visible()
                        and await page.evaluate('document.body.scrollWidth <= innerWidth'))
            await page.screenshot(path=str(ART / 'auth-users-mobile.png'))
            await page.set_viewport_size({'width':1399, 'height':895})
            duplicate = await page.request.post(base + '/api/v1/users', headers={'Origin':base}, data={
                'username':username.upper(), 'displayName':'重名用户', 'password':ORDINARY_PASSWORD})
            await check('大小写重复账号被服务端拒绝，避免创建重复身份', duplicate.status == 409)
            csrf = await page.request.post(base + '/api/v1/users', headers={'Origin':'https://foreign.invalid'}, data={
                'username':username + '_evil', 'displayName':'跨站用户', 'password':ORDINARY_PASSWORD})
            await check('跨站来源不能调用管理员写接口', csrf.status == 403)
            await sign_out(page)
            replay = await p.request.new_context(extra_http_headers={'Cookie':old_admin_cookie})
            replay_response = await replay.get(base + '/api/v1/auth/me')
            await check('管理员退出后旧会话Cookie无法再次使用', replay_response.status == 401)
            await replay.dispose()
            await page.reload(wait_until='networkidle')
            await page.locator('input[autocomplete="current-password"]').wait_for(state='visible')
            await check('退出并刷新后保持未登录状态', await page.locator('.app-shell').count() == 0)

            # A new browser context proves the created account is held by D1,
            # rather than by the administrator's device-local storage.
            ordinary_context = await browser.new_context(viewport={'width':1399, 'height':895})
            ordinary_page = await ordinary_context.new_page()
            ordinary_page.set_default_timeout(20000)
            ordinary_page.on('pageerror', lambda error: errors.append(str(error)))
            await ordinary_page.goto(base, wait_until='networkidle')
            await sign_in(ordinary_page, username, ORDINARY_PASSWORD)
            await ordinary_page.locator('.app-shell').wait_for(state='visible')
            user_me = await ordinary_page.request.get(base + '/api/v1/auth/me')
            user = (await user_me.json())['user']
            await check('新建普通账号在独立浏览器中可以成功登录',
                        user_me.status == 200 and user['username'] == username and user['role'] == 'USER'
                        and display_name in await ordinary_page.locator('.profile').inner_text()
                        and '普通用户' in await ordinary_page.locator('.profile').inner_text())
            await check('普通用户不显示用户管理或新增用户入口',
                        await ordinary_page.get_by_role('button', name='用户管理', exact=True).count() == 0
                        and await ordinary_page.get_by_role('button', name='新增用户', exact=True).count() == 0)
            forbidden_list = await ordinary_page.request.get(base + '/api/v1/users')
            forbidden_create = await ordinary_page.request.post(base + '/api/v1/users', headers={'Origin':base}, data={
                'username':username + '_child', 'displayName':'越权用户', 'password':ORDINARY_PASSWORD})
            forbidden_upgrade = await ordinary_page.request.post(base + '/api/v1/users', headers={'Origin':base}, data={
                'username':username + '_admin', 'displayName':'越权管理员', 'password':ORDINARY_PASSWORD,
                'role':'SUPER_ADMIN'})
            await check('普通用户直接调用查询和新增用户API均得到403',
                        forbidden_list.status == 403 and forbidden_create.status == 403)
            await check('普通用户篡改role参数也无法创建超级管理员', forbidden_upgrade.status == 403)
            await ordinary_page.goto(base + '/#users', wait_until='networkidle')
            await ordinary_page.locator('.app-shell').wait_for(state='visible')
            await check('普通用户直接进入用户管理地址不会展示管理面板',
                        await ordinary_page.locator('.user-management').count() == 0
                        and await ordinary_page.get_by_role('button', name='新增用户', exact=True).count() == 0)
            await check('普通用户登录也不在前端持久存储密码或权限令牌',
                        await assert_no_stored_credentials(ordinary_page, admin_password, ORDINARY_PASSWORD))
            for width in [1399, 390, 360]:
                await ordinary_page.set_viewport_size({'width':width, 'height':895})
                await check(str(width) + 'px登录后的工作区无页面横向溢出',
                            await ordinary_page.evaluate('document.body.scrollWidth <= innerWidth'))
                await ordinary_page.screenshot(path=str(ART / ('auth-user-' + str(width) + '.png')))
            await sign_out(ordinary_page)
            no_user = await ordinary_page.request.get(base + '/api/v1/auth/me')
            await ordinary_page.reload(wait_until='networkidle')
            await ordinary_page.locator('input[autocomplete="current-password"]').wait_for(state='visible')
            await check('普通用户退出后会话失效并返回登录页',
                        no_user.status == 401 and await ordinary_page.locator('.app-shell').count() == 0)
            await check('登录及权限完整流程无浏览器运行异常', not errors)
            print(json.dumps({'passed':len(CHECKS), 'checks':CHECKS, 'errors':errors}, ensure_ascii=False), flush=True)
        except Exception:
            await page.screenshot(path=str(ART / 'auth-failure.png'), full_page=True)
            if ordinary_context and ordinary_context.pages:
                await ordinary_context.pages[-1].screenshot(path=str(ART / 'auth-user-failure.png'), full_page=True)
            print('BROWSER_ERRORS', errors, flush=True)
            traceback.print_exc()
            raise
        finally:
            await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
