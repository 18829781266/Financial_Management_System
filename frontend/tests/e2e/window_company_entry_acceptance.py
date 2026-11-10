"""Window controls, per-entry documents and same-company archive acceptance.

Runs only against an isolated local Worker with synthetic browser data.
"""
import asyncio
import base64
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
        raise RuntimeError('Only isolated local URLs are allowed')
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=os.getenv('BROWSER_EXECUTABLE') or None,
            headless=True, args=['--no-sandbox'])
        context = await browser.new_context(viewport={'width': 1440, 'height': 960},
                                            ignore_https_errors=urlparse(base).scheme == 'https')
        page = await context.new_page()
        page.set_default_timeout(20000)

        async def state():
            return await page.evaluate("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'))")

        async def nav(label, heading=None):
            await page.get_by_role('button', name=label, exact=True).first.click()
            if heading:
                await page.locator('h1').filter(has_text=heading).wait_for()

        async def search(value):
            field = page.get_by_role('textbox', name='搜索凭证或单据', exact=True)
            await field.fill(value)

        async def controls(dialog, label):
            await dialog.locator('.window-dialog__controls').wait_for()
            for name in ['缩小窗口', '放大窗口', '关闭窗口']:
                await check(label + '提供' + name,
                            await dialog.get_by_role('button', name=name, exact=True).count() == 1)
            metrics = await dialog.evaluate('''root=>{
              const rect=root.getBoundingClientRect();
              return {left:rect.left,right:rect.right,viewport:innerWidth,
                controls:[...root.querySelectorAll('.window-dialog__controls button')].map(e=>{
                  const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};
                })};
            }''')
            await check(label + '窗口及控制图标不溢出',
                        metrics['left'] >= -1 and metrics['right'] <= metrics['viewport'] + 1 and
                        all(item['left'] >= -1 and item['right'] <= metrics['viewport'] + 1 and item['width'] >= 32
                            for item in metrics['controls']))

        async def minimize_restore(dialog, draft, expected):
            await dialog.get_by_role('button', name='缩小窗口', exact=True).click()
            await page.wait_for_function('''root=>root.classList.contains('window-dialog--minimized') &&
              getComputedStyle(root.querySelector('.el-dialog__body')).display==='none' &&
              getComputedStyle(root.querySelector('.el-dialog__footer')).display==='none' &&
              root.querySelector('.el-dialog__body').isConnected''', arg=await dialog.element_handle())
            await check('缩小保留已挂载正文和未保存草稿', await draft.input_value() == expected)
            await dialog.get_by_role('button', name='还原窗口', exact=True).click()
            await dialog.locator('.el-dialog__body').wait_for(state='visible')
            await check('还原窗口后草稿仍然存在', await draft.input_value() == expected)

        async def maximize_restore(dialog):
            await dialog.get_by_role('button', name='放大窗口', exact=True).click()
            await page.wait_for_function('''root=>{
              const rect=root.getBoundingClientRect(),style=getComputedStyle(root);
              return root.classList.contains('is-fullscreen') &&
                Math.abs(rect.width-innerWidth)<2 && Math.abs(rect.height-innerHeight)<2 &&
                style.marginTop==='0px';
            }''', arg=await dialog.element_handle())
            await page.wait_for_function('''root=>root.classList.contains('is-fullscreen') &&
              Math.abs(root.getBoundingClientRect().width-innerWidth)<2''', arg=await dialog.element_handle())
            await dialog.get_by_role('button', name='还原窗口大小', exact=True).click()
            await page.wait_for_function("root=>!root.classList.contains('is-fullscreen')",
                                        arg=await dialog.element_handle())
            await check('窗口放大与还原真实改变布局', True)

        async def manual(no):
            await search(no)
            row = page.locator('.records-panel .el-table__row:visible').filter(
                has=page.get_by_role('button', name=no, exact=True))
            await row.get_by_role('button', name='手工匹配', exact=True).click()
            dialog = page.locator('.entry-attachments-dialog:visible,.app-dialog:visible').filter(has_text=no).last
            await dialog.wait_for()
            return dialog

        async def close(dialog):
            await dialog.get_by_role('button', name='关闭窗口', exact=True).click()
            await dialog.locator('..').wait_for(state='hidden')

        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            await page.goto(base, wait_until='networkidle')
            await page.locator('input[autocomplete="username"]').fill('admin')
            await page.locator('input[autocomplete="current-password"]').fill(os.environ['AUTH_ADMIN_PASSWORD'])
            await page.get_by_role('button', name='立即登录', exact=True).click()
            await page.locator('.app-shell').wait_for()
            await nav('规则配置', '匹配规则配置')
            await page.locator('.rule-card .el-switch').first.click()
            await page.wait_for_function("!!localStorage.getItem('langchao-cloud-demo-v1')")
            company = '合成同名企业有限公司'
            fixture = base64.b64encode((ROOT / 'manual-invoice.pdf').read_bytes()).decode()
            await page.evaluate('''async ({company,pdf})=>{
              const s=JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'));
              for(const rule of s.rules)rule.enabled=rule.id==='R08'||rule.id==='R09';
              const doc=(id,name,amount,supplier,status='matched',extra={})=>({
                id,name,type:'invoice',number:id,supplier,payerName:supplier,payeeName:'合成核算主体',
                partyVersion:2,date:'2026-10-20',amount,seal:true,status,extractionStatus:'reviewed',...extra});
              const voucher=(id,no,supplier,amount=100,extra={})=>({
                id,no,period:'2026-10',date:'2026-10-20',summary:no+'合成摘要',supplier,amount,
                status:'pending',documentIds:[],reviewStatus:'reviewed',matchReviewRequired:true,...extra});
              const entry=(summary,debit,credit,account)=>({summary,account,debit,credit});
              const group='name:R08:2026-10:counterparty:synthetic-company';
              s.vouchers=[
                voucher('legacy','分录-金额','金额归集测试',300,{status:'matched',ruleId:'MANUAL',matchReviewRequired:false,
                  documentIds:['legacy-a','legacy-b','legacy-other'],entries:[
                    entry('收到甲公司货款','100.00','0.00','1002 银行存款_尾号3325'),
                    entry('支付乙公司货款','200.00','0.00','1002 银行存款_尾号7788'),
                    entry('结转损益','0.00','300.00','管理费用')]}),
                voucher('ambiguous','分录-同额','同额测试公司',200,{documentIds:['ambiguous-doc'],entries:[
                    entry('同额第一笔','100.00','0.00','1002 银行存款_尾号8899'),
                    entry('同额第二笔','100.00','0.00','1002 银行存款_尾号6677'),
                    entry('对方科目','0.00','200.00','管理费用')]}),
                voucher('candidate','分录-候选','候选测试企业',100,{reviewStatus:'pending',entries:[
                    entry('收取合成货款','100.00','0.00','1002 银行存款_尾号3325'),
                    entry('确认合成收入','0.00','100.00','6001 主营业务收入')]}),
                voucher('exemption','分录-豁免','豁免测试企业',30,{entries:[
                    entry('无外部附件费用','30.00','0.00','管理费用'),
                    entry('无外部附件付款','0.00','30.00','应付账款')]}),
                voucher('existing','分录-原归集',company,80,{documentIds:[],nameAssociationIds:[group],matchReviewRequired:false,
                  entries:[entry('名称归集费用','80.00','0.00','管理费用'),entry('名称归集付款','0.00','80.00','应付账款')]}),
                voucher('company','分录-客商归集','待填写客商',100,{reviewStatus:'pending'}),
                voucher('cross','分录-跨期',company,100,{period:'2026-11',date:'2026-11-20',reviewStatus:'pending'}),
                voucher('different','分录-异名','完全不同的企业',100,{reviewStatus:'pending'}),
                voucher('edit','分录-编辑','编辑测试企业',20),
                voucher('missing','分录-缺失','缺失测试企业',30)
              ];
              s.documents=[
                doc('legacy-a','一百元发票.pdf',100,'金额归集测试'),
                doc('legacy-b','二百元发票.pdf',200,'金额归集测试'),
                doc('legacy-other','九九九元无关附件.pdf',999,'金额归集测试'),
                doc('ambiguous-doc','同额待复核发票.pdf',100,'同额测试公司'),
                doc('company-receipt','同名企业银行回单.pdf',75,company,'pending',{type:'bank',seal:false,nameAssociationIds:[group]}),
                doc('bank-candidate','唯一对应银行回单.pdf',100,'候选测试企业','pending',{type:'bank',seal:false,payeeAccount:'3325'}),
                doc('preview-doc','预览测试单据.pdf',5,'预览测试企业','pending',{fileId:'synthetic-preview'})
              ];
              s.nameAssociations=[{id:group,period:'2026-10',payerName:company,documentIds:['company-receipt'],
                voucherIds:['existing'],updatedAt:'2026-10-20 10:00:00',associationType:'name',ruleId:'R08',
                confidence:100,basis:'counterparty',partyField:'either',documentTypes:['invoice','bank','contract','approval']}];
              s.archives=[];s.payerGroups=[];s.logs=[];delete s.lastMatchRun;
              localStorage.setItem('langchao-cloud-demo-v1',JSON.stringify(s));
              const open=indexedDB.open('langchao-files-v1',1);
              open.onupgradeneeded=()=>open.result.createObjectStore('files');
              await new Promise((resolve,reject)=>{open.onsuccess=resolve;open.onerror=reject;});
              const db=open.result,tx=db.transaction('files','readwrite');
              tx.objectStore('files').put(new Blob([Uint8Array.from(atob(pdf),c=>c.charCodeAt(0))],{type:'application/pdf'}),'synthetic-preview');
              await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=reject;});db.close();
            }''', {'company': company, 'pdf': fixture})
            await page.reload(wait_until='networkidle')
            await page.locator('.app-shell').wait_for()

            # Real user dialog: draft survives CSS-only minimization; busy controls lock.
            await nav('用户管理', '用户管理')
            await page.get_by_role('button', name='新增用户', exact=True).click()
            user_dialog = page.locator('.create-user-dialog:visible')
            await controls(user_dialog, '新增用户')
            await user_dialog.locator('#new-user-display-name').fill('窗口草稿用户')
            await user_dialog.locator('#new-user-username').fill('qa_window_draft')
            await user_dialog.locator('#new-user-password').fill('SyntheticDraft_42!')
            await minimize_restore(user_dialog, user_dialog.locator('#new-user-display-name'), '窗口草稿用户')
            await maximize_restore(user_dialog)

            async def delayed_create(route):
                if route.request.method == 'POST':
                    await asyncio.sleep(1.2)
                await route.continue_()
            await page.route('**/api/v1/users', delayed_create)
            username = 'qa_window_saved'
            await user_dialog.locator('#new-user-display-name').fill('合成账号已保存')
            await user_dialog.locator('#new-user-username').fill(username)
            await user_dialog.locator('#new-user-password').fill('SyntheticUser_42!')
            await user_dialog.get_by_role('button', name='创建用户', exact=True).click()
            await user_dialog.get_by_text('正在创建…', exact=True).wait_for()
            await check('创建用户忙碌时三个窗口操作全部禁用',
                        all([await user_dialog.get_by_role('button', name=name, exact=True).is_disabled()
                            for name in ['缩小窗口', '放大窗口', '关闭窗口']]))
            await user_dialog.wait_for(state='hidden')
            await page.unroute('**/api/v1/users', delayed_create)
            user_row = page.locator('.users-table tbody tr').filter(has_text=username)
            await user_row.get_by_role('button', name='删除用户', exact=True).click()
            await page.locator('.danger-message-box').get_by_role('button', name='确认删除', exact=True).click()
            await user_row.wait_for(state='hidden')

            # Ordinary edit dialog close must preserve the original record, not a draft.
            await nav('数据采集', '数据采集')
            await search('分录-编辑')
            edit_row = page.locator('.records-panel .el-table__row:visible').filter(has_text='分录-编辑')
            await edit_row.get_by_role('button', name='编辑', exact=True).click()
            edit_dialog = page.locator('.record-edit-dialog:visible')
            await controls(edit_dialog, '编辑凭证')
            summary = edit_dialog.locator('.el-form-item').filter(has_text='摘要').locator('input').first
            await summary.fill('只保留在弹窗里的草稿')
            await minimize_restore(edit_dialog, summary, '只保留在弹窗里的草稿')
            await close(edit_dialog)
            saved = await state()
            await check('编辑弹窗关闭不会误保存草稿',
                        next(v for v in saved['vouchers'] if v['id']=='edit')['summary']=='分录-编辑合成摘要')

            # Batch import draft survives minimization; busy import cannot close.
            await page.get_by_role('button', name='批量导入凭证', exact=True).click()
            batch = page.locator('.batch-import-dialog:visible')
            await controls(batch, '批量导入')
            one = {'vouchers':[{'no':'合成批导入草稿','period':'2026-10','date':'2026-10-20','summary':'不提交','supplier':'合成测试','amount':'1.00'}]}
            await batch.locator('input[type=file]').set_input_files({
                'name':'synthetic-draft.json','mimeType':'application/json','buffer':json.dumps(one,ensure_ascii=False).encode()})
            await batch.get_by_role('button', name='确认导入（1）', exact=True).wait_for()
            draft = batch.locator('.el-table__row input[aria-label="摘要"]').first
            await draft.fill('批量导入未提交摘要')
            await minimize_restore(batch, draft, '批量导入未提交摘要')
            await batch.get_by_role('button', name='取消', exact=True).click()
            await batch.wait_for(state='hidden')
            await page.get_by_role('button', name='批量导入凭证', exact=True).click()
            batch = page.locator('.batch-import-dialog:visible')
            payload = {'vouchers':[{'no':f'合成批量-{i}','period':'2026-10','date':'2026-10-20','summary':'忙碌锁合成数据','supplier':'合成批量企业','amount':'1.00'} for i in range(5000)]}
            await batch.locator('input[type=file]').set_input_files({
                'name':'synthetic-busy.json','mimeType':'application/json','buffer':json.dumps(payload,ensure_ascii=False).encode()})
            # Capture Vue's synchronous submit render before the fast local batch finishes.
            busy_state = await batch.get_by_role('button', name='确认导入（5000）', exact=True).evaluate('''button=>{
              button.click();
              return new Promise(resolve=>queueMicrotask(()=>resolve({
                text:button.textContent.trim(),
                controls:[...document.querySelectorAll('.batch-import-dialog .window-dialog__controls button')].map(item=>item.disabled)
              })));
            }''')
            await check('批量导入忙碌时三个窗口操作全部禁用',
                        busy_state['text']=='正在导入…' and busy_state['controls']==[True,True,True])
            await batch.wait_for(state='hidden', timeout=90000)

            # Wait for the real post-import auto-match, then detach the isolated candidate.
            await page.wait_for_function("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')).vouchers.find(v=>v.id==='candidate').status==='matched'")
            await nav('数据采集', '数据采集')
            await search('分录-候选')
            candidate_row = page.locator('.records-panel .el-table__row:visible').filter(has_text='分录-候选')
            await candidate_row.get_by_role('button', name='解除匹配', exact=True).click()
            prompt = page.locator('.el-message-box:visible')
            await prompt.locator('input').fill('合成验收：检查唯一候选在弹窗中的展示')
            await prompt.get_by_role('button', name='确认解除', exact=True).click()
            await page.wait_for_function("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')).vouchers.find(v=>v.id==='candidate').status!=='matched'")

            # Unique bank candidate and nested review dialogs.
            entry = await manual('分录-候选')
            await controls(entry, '分录附件')
            first = entry.locator('.el-table__row').filter(has_text='收取合成货款')
            second = entry.locator('.el-table__row').filter(has_text='确认合成收入')
            await check('唯一对应回单直接落在正确摘要',
                        '唯一对应银行回单.pdf' in await first.inner_text() and
                        '唯一金额候选 · 金额、账号及日期一致' in await first.inner_text() and
                        '唯一对应银行回单.pdf' not in await second.inner_text())
            summary = entry.locator('.voucher-review-form .el-form-item').filter(has_text='摘要').locator('input').first
            await summary.fill('缩小后仍保留的分录摘要')
            await minimize_restore(entry, summary, '缩小后仍保留的分录摘要')
            await maximize_restore(entry)
            await entry.get_by_role('button', name='调整关联第1条分录', exact=True).click()
            review = page.locator('.entry-review-dialog:visible')
            await controls(review, '人工分录复核')
            reason = review.locator('textarea')
            await reason.fill('合成复核依据：缩小不能清空')
            await minimize_restore(review, reason, '合成复核依据：缩小不能清空')
            await review.get_by_role('button', name='取消', exact=True).click()
            await review.locator('..').wait_for(state='hidden')
            await close(entry)

            # Exemption has its own no-evidence voucher, never a bank candidate.
            entry = await manual('分录-豁免')
            await entry.get_by_role('button', name='保存并复核字段', exact=True).click()
            exemption = page.locator('.attachment-exemption-dialog:visible')
            await controls(exemption, '无外部附件二次确认')
            await exemption.get_by_role('button', name='取消', exact=True).click()
            await exemption.locator('..').wait_for(state='hidden')
            await close(entry)

            # Legacy whole-voucher relations are displayed only on unique amount rows.
            entry = await manual('分录-金额')
            rows = entry.locator('.el-table__row')
            first = rows.filter(has_text='收到甲公司货款')
            second = rows.filter(has_text='支付乙公司货款')
            third = rows.filter(has_text='结转损益')
            await check('旧整凭证100元与200元附件各自对应正确摘要',
                        '一百元发票.pdf' in await first.inner_text() and '二百元发票.pdf' not in await first.inner_text() and
                        '二百元发票.pdf' in await second.inner_text() and '一百元发票.pdf' not in await second.inner_text() and
                        await entry.get_by_text('金额一致 · 分录关系待复核', exact=True).count()==2)
            await check('没有对应金额的摘要留空，其他附件在表外待复核',
                        '未关联' in await third.inner_text() and
                        '九九九元无关附件.pdf' not in await third.inner_text() and
                        '九九九元无关附件.pdf' in await entry.locator('.unassigned-documents').inner_text())
            await close(entry)
            entry = await manual('分录-同额')
            await entry.locator('.el-table__row').first.wait_for()
            await check('同额两条摘要不猜测分配，原件在独立待复核区',
                        await entry.locator('.el-table__row .entry-document').count()==0 and
                        '同额待复核发票.pdf' in await entry.locator('.unassigned-documents').inner_text())
            await close(entry)
            entry = await manual('分录-原归集')
            await check('仅企业名称相同的原件不冒充某条摘要的金额附件',
                        await entry.locator('.el-table__row .entry-document').count()==0 and
                        '同名企业银行回单.pdf' in await entry.locator('.unassigned-documents').inner_text())
            await close(entry)

            # Same normalized company + same period joins the existing name group.
            dialog = await manual('分录-客商归集')
            await controls(dialog, '通用手工匹配')
            supplier = dialog.locator('input[aria-required="true"]')
            await supplier.fill(company)
            await dialog.get_by_role('button', name='保存并复核字段', exact=True).click()
            await page.wait_for_function("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')).vouchers.find(v=>v.id==='company').nameAssociationIds?.length===1")
            await close(dialog)
            dialog = await manual('分录-跨期')
            await dialog.get_by_role('button', name='保存并复核字段', exact=True).click()
            await close(dialog)
            dialog = await manual('分录-异名')
            await dialog.get_by_role('button', name='保存并复核字段', exact=True).click()
            await close(dialog)
            saved = await state()
            group = saved['nameAssociations'][0]
            await check('同名同期归组，跨期与异名均不归组',
                        set(group['voucherIds'])=={'existing','company'} and
                        not next(v for v in saved['vouchers'] if v['id']=='cross').get('nameAssociationIds') and
                        not next(v for v in saved['vouchers'] if v['id']=='different').get('nameAssociationIds') and
                        next(v for v in saved['vouchers'] if v['id']=='company')['documentIds']==[])
            await page.reload(wait_until='networkidle')
            await page.locator('.app-shell').wait_for()
            saved = await state()
            await check('刷新后同名企业归组及原金额关系保持不变',
                        set(saved['nameAssociations'][0]['voucherIds'])=={'existing','company'} and
                        next(v for v in saved['vouchers'] if v['id']=='company')['documentIds']==[])
            await nav('电子档案', '电子会计档案')
            await page.locator('.payer-group').filter(has_text=company).click()
            archive = page.locator('.payer-draft')
            await check('电子档案同一企业下可见手工核对凭证',
                        await archive.locator('.linked-voucher').count()==2 and
                        '分录-客商归集' in await archive.inner_text() and
                        '分录-跨期' not in await archive.inner_text() and
                        '分录-异名' not in await archive.inner_text())

            # Detaching does not silently reattach on reload or group rebuild.
            await nav('数据采集', '数据采集')
            await search('分录-客商归集')
            await page.get_by_role('button', name='解除匹配', exact=True).click()
            prompt = page.locator('.el-message-box:visible')
            await prompt.locator('input').fill('合成验收：解除后不应自动挂回')
            await prompt.get_by_role('button', name='确认解除', exact=True).click()
            await page.wait_for_function("!JSON.parse(localStorage.getItem('langchao-cloud-demo-v1')).vouchers.find(v=>v.id==='company').nameAssociationIds?.length")
            await page.reload(wait_until='networkidle')
            await page.locator('.app-shell').wait_for()
            saved = await state()
            await check('解除企业归组后刷新不会自动挂回',
                        not next(v for v in saved['vouchers'] if v['id']=='company').get('nameAssociationIds'))

            # File preview, help, missing-reason, rule and archive-range shared windows.
            await nav('数据采集', '数据采集')
            await page.locator('.section-tabs').get_by_role('button', name='原始单据', exact=False).click()
            await search('预览测试单据.pdf')
            await page.locator('.doc-name').click()
            preview = page.locator('.file-preview-dialog:visible')
            await preview.locator('iframe').wait_for()
            await controls(preview, '原件预览')
            await close(preview)
            await page.locator('button[title="使用帮助"]').click()
            help_dialog = page.locator('.help-dialog:visible')
            await controls(help_dialog, '使用帮助')
            await page.set_viewport_size({'width':390,'height':844})
            await controls(help_dialog, '390px使用帮助')
            await help_dialog.get_by_role('button', name='缩小窗口', exact=True).click()
            await check('390px缩小标题栏无页面横向溢出', await page.evaluate('document.body.scrollWidth<=innerWidth'))
            await page.wait_for_function("root=>root.classList.contains('window-dialog--minimized') && getComputedStyle(root.querySelector('.el-dialog__body')).display==='none'", arg=await help_dialog.element_handle())
            minimized = await help_dialog.evaluate('''root=>{
              const details=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {
                tag:e.tagName,class:e.className,
                rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height},
                opacity:s.opacity,visibility:s.visibility,display:s.display,backgroundColor:s.backgroundColor,
                transform:s.transform,zIndex:s.zIndex,pointerEvents:s.pointerEvents,backdropFilter:s.backdropFilter}};
              const ancestors=[];let current=root;
              while(current){ancestors.push(details(current));current=current.parentElement;}
              return {ancestors,header:details(root.querySelector('.el-dialog__header')),
                title:details(root.querySelector('.el-dialog__title')),viewport:{width:innerWidth,height:innerHeight}};
            }''')
            overlay = next(item for item in minimized['ancestors'] if 'el-overlay' in item['class'].split())
            root = minimized['ancestors'][0]
            await check('390px缩小遮罩透明且不拦截底层操作',
                        overlay['backgroundColor'] == 'rgba(0, 0, 0, 0)' and
                        overlay['backdropFilter'] == 'none' and overlay['pointerEvents'] == 'none')
            await check('390px缩小标题栏完整可见',
                        root['rect']['left'] >= 0 and root['rect']['top'] >= 0 and
                        root['rect']['right'] <= minimized['viewport']['width'] and
                        root['rect']['bottom'] <= minimized['viewport']['height'] and
                        root['rect']['width'] > 200 and root['rect']['height'] >= 44 and
                        root['opacity'] == '1' and root['visibility'] == 'visible' and
                        root['backgroundColor'] != 'rgba(0, 0, 0, 0)' and
                        minimized['header']['opacity'] == '1' and
                        minimized['header']['visibility'] == 'visible' and
                        minimized['header']['display'] != 'none' and
                        minimized['title']['rect']['width'] > 0)
            await page.screenshot(path=str(ART/'window-minimized-mobile-page.png'), full_page=True, animations='disabled')
            await help_dialog.screenshot(path=str(ART/'window-minimized-mobile.png'), animations='disabled')
            await help_dialog.get_by_role('button', name='还原窗口', exact=True).click()
            await close(help_dialog)
            await page.set_viewport_size({'width':1440,'height':960})
            await page.locator('.section-tabs').get_by_role('button', name='记账凭证', exact=False).click()
            await search('分录-缺失')
            missing_row = page.locator('.records-panel .el-table__row:visible').filter(has_text='分录-缺失')
            await missing_row.get_by_role('button', name='标记缺失', exact=True).click()
            missing = page.locator('.app-dialog:visible')
            await controls(missing, '附件缺失')
            await missing.locator('textarea').fill('合成缺失依据草稿')
            await minimize_restore(missing, missing.locator('textarea'), '合成缺失依据草稿')
            await missing.get_by_role('button', name='取消', exact=True).click()
            await nav('规则配置', '匹配规则配置')
            rule_card = page.locator('.rule-card').filter(has=page.locator('.rule-id', has_text='R01'))
            await rule_card.get_by_role('button', name='配置规则', exact=True).click()
            rule = page.locator('.app-dialog:visible')
            await controls(rule, '规则配置')
            await close(rule)
            await nav('电子档案', '电子会计档案')
            await page.get_by_role('button', name='生成档案册', exact=True).first.click()
            create = page.locator('.app-dialog:visible')
            await controls(create, '生成档案册')
            await close(create)
            await check('全部浏览器验收没有JavaScript运行异常', not errors)
            print(json.dumps({'passed':len(CHECKS),'checks':CHECKS,'errors':errors},ensure_ascii=False),flush=True)
        except Exception:
            await page.screenshot(path=str(ART/'window-company-entry-failure.png'),full_page=True)
            print('BROWSER_ERRORS',errors,flush=True)
            traceback.print_exc()
            raise
        finally:
            await context.close()
            await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
