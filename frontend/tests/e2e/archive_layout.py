"""Pinned archive heading and compact linked-record layout, using isolated originals."""
import asyncio
import base64
import json
import os
import traceback
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent
ART = ROOT / 'artifacts'
ART.mkdir(exist_ok=True)
checks = []


async def check(label, condition=True):
    if not condition:
        raise AssertionError(label)
    checks.append(label)
    print('PASS ' + label, flush=True)


def fixture():
    """Two name-association groups exercise real paging without financial binding."""
    rules = json.loads((ROOT.parent / 'fixtures/demo-state.json').read_text())['rules']
    state = {'rules': rules, 'vouchers': [], 'documents': [], 'archives': [], 'logs': [],
             'payerGroups': [], 'nameAssociations': [], 'lastImportSequence': 1000,
             'matchDataRevision': 0}
    for prefix, company, voucher_count, document_count, base in [
        ('layout-main', '布局主企业有限公司', 27, 6, 100),
        ('layout-other', '布局次企业有限公司', 3, 8, 10),
    ]:
        group_id = prefix + '-group'
        voucher_ids = []
        document_ids = []
        for i in range(1, voucher_count + 1):
            ident = f'{prefix}-v-{i}'
            voucher_ids.append(ident)
            state['vouchers'].append({
                'id': ident, 'no': (('次组-1-202606-长凭证编号-辅助核算-' * 2) if prefix == 'layout-other' and i == 1 else ('布局-' if prefix == 'layout-main' else '次组-') + str(i)),
                'period': '2026-06', 'date': '2026-06-20', 'summary': f'第{i}份合成凭证',
                'supplier': company, 'company': company, 'amount': 8400000.32 + i if prefix == 'layout-main' else 1567213.32 + i,
                'status': 'pending', 'reviewStatus': 'reviewed' if prefix == 'layout-other' and i == 3 else 'pending', 'matchReviewRequired': False,
                'documentIds': [], 'nameAssociationIds': [group_id],
                'fileId': ident + '-file', 'fileName': f'合成凭证-{i}.pdf',
                'importSequence': base + i, 'expectedAttachments': 1,
            })
        for i in range(1, document_count + 1):
            ident = f'{prefix}-d-{i}'
            document_ids.append(ident)
            state['documents'].append({
                'id': ident, 'number': f'{prefix.upper()}-{i}', 'name': f'{company}-原件{i}.pdf',
                'type': 'invoice', 'payerName': company, 'supplier': company,
                'payeeName': f'合成收款方{i}', 'partyVersion': 2, 'amount': 286519.29 + i,
                'date': '2026-06-20', 'status': 'pending', 'seal': True,
                'extractionStatus': 'pending' if i == 1 else 'reviewed',
                'matchReviewRequired': False, 'nameAssociationIds': [group_id],
                'fileId': ident + '-file', 'importSequence': base + 50 + i,
            })
        state['nameAssociations'].append({
            'id': group_id, 'period': '2026-06', 'payerName': company,
            'voucherIds': voucher_ids, 'documentIds': document_ids,
            'associationType': 'name', 'ruleId': 'R08', 'confidence': 100,
            'basis': 'company', 'partyField': 'either',
            'documentTypes': ['invoice', 'bank', 'contract', 'approval'],
            'updatedAt': '2026-10-23 12:00:00',
        })
    state['lastMatchRun'] = {
        'id': 'layout-run', 'time': '2026-10-23 12:00:00', 'period': '2026-06',
        'matched': 30, 'remaining': 0, 'groupCount': 2, 'outcomes': [], 'rules': rules,
        'associatedDocuments': 14, 'nameAssociatedVouchers': 30,
        'nameAssociatedDocuments': 14, 'importSequence': 1000, 'dataRevision': 0,
    }
    return state


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.getenv('BROWSER_EXECUTABLE') or None,
                                         headless=True, args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width': 1399, 'height': 895})
        page.set_default_timeout(20000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))

        async def state():
            return await page.evaluate("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'))")

        async def group(company):
            await page.locator('.payer-group').filter(has=page.get_by_text(company, exact=True)).click()

        async def no_overflow():
            return await page.evaluate('document.body.scrollWidth <= innerWidth')

        async def heading_top():
            return await page.locator('.page-heading').evaluate('e=>e.getBoundingClientRect().top')

        try:
            await page.goto(os.getenv('BASE_URL', 'http://localhost:5174'), wait_until='networkidle')
            await page.evaluate("""async data => {
              localStorage.setItem('langchao-cloud-demo-v1', JSON.stringify(data.state));
              const request = indexedDB.open('langchao-files-v1', 1);
              request.onupgradeneeded = () => request.result.createObjectStore('files');
              await new Promise((resolve,reject) => {request.onsuccess=resolve;request.onerror=reject});
              const db = request.result, tx = db.transaction('files','readwrite');
              const blob = new Blob([Uint8Array.from(atob(data.pdf),c=>c.charCodeAt(0))], {type:'application/pdf'});
              for(const record of [...data.state.vouchers,...data.state.documents])
                tx.objectStore('files').put(blob, record.fileId);
              await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=reject});
              db.close();
            }""", {'state': fixture(), 'pdf': base64.b64encode((ROOT / 'manual-invoice.pdf').read_bytes()).decode()})
            await page.reload(wait_until='networkidle')
            await group('布局主企业有限公司')
            await check('主组真实保留27张凭证和6份原始单据',
                        len((await state())['nameAssociations'][0]['voucherIds']) == 27
                        and len((await state())['nameAssociations'][0]['documentIds']) == 6)
            groups = await page.locator('.payer-groups').bounding_box()
            draft = await page.locator('.payer-draft').bounding_box()
            print('LAYOUT_METRICS', json.dumps({'groupWidth':groups['width'],'contentWidth':draft['width'],
                  'pageHeight':await page.evaluate('document.body.scrollHeight'),
                  'previewTop':await page.locator('.draft-preview').evaluate('e=>e.getBoundingClientRect().top+scrollY')}),flush=True)
            await check('企业分组横排在内容上方，不再留下左侧长空栏',
                        groups['width'] >= draft['width'] * .96
                        and groups['y'] < draft['y'] and abs(groups['x']-draft['x']) <= 3)
            await check('桌面第一页仅展示6张凭证且最新导入在前',
                        await page.locator('.linked-voucher').count() == 6
                        and await page.locator('.linked-voucher .voucher-number').first.inner_text() == '布局-27')
            rows = await page.locator('.linked-voucher').evaluate_all('''nodes=>nodes.map(e=>{
              const r=e.getBoundingClientRect(),a=e.querySelector('strong').getBoundingClientRect(),
                actions=e.querySelector('.linked-voucher-actions').getBoundingClientRect();
              return {x:r.x,y:r.y,bottom:r.bottom,right:r.right,width:r.width,
                amountRight:a.right,actionsX:actions.x,actionsRight:actions.right};
            })''')
            await check('桌面凭证逐条竖排且金额与操作列对齐',
                        all(abs(r['x']-rows[0]['x'])<=2 and abs(r['width']-rows[0]['width'])<=2
                            and abs(r['amountRight']-rows[0]['amountRight'])<=2
                            and abs(r['actionsX']-rows[0]['actionsX'])<=2
                            and r['actionsRight']<=r['right']+1 for r in rows)
                        and all(rows[i]['y']>=rows[i-1]['bottom']-1 for i in range(1,len(rows))))
            list_text=await page.locator('.linked-vouchers').inner_text()
            await check('竖排列表提供明确列头与列表语义',
                        all(label in list_text for label in ['凭证号','匹配依据','金额','操作'])
                        and await page.locator('.linked-voucher-list[role="list"] .linked-voucher').count()==6)
            untouched = await state()
            first = page.locator('.linked-voucher').first
            await first.get_by_role('button',name='核对字段',exact=True).click()
            edit = page.locator('.el-dialog:visible').last
            await check('竖排凭证核对字段仍打开所选凭证',
                        '编辑与复核凭证' in await edit.inner_text()
                        and '布局-27' in await edit.locator('input').first.input_value())
            await edit.get_by_role('button',name='取消',exact=True).click()
            await edit.wait_for(state='hidden')
            await first.get_by_role('button',name='查看原件',exact=True).click()
            original = page.locator('.file-preview-dialog:visible')
            await original.locator('iframe').wait_for(state='visible')
            await check('竖排凭证查看原件仍打开真实上传PDF',
                        (await original.locator('iframe').get_attribute('src')).startswith('blob:')
                        and '合成凭证-27.pdf' in await original.inner_text())
            await original.get_by_role('button',name='关闭',exact=True).click()
            await original.wait_for(state='hidden')
            await check('查看原件和取消字段核对均不改动业务数据',await state()==untouched)
            await check('单据表保留全部6份且表格高度受限',
                        await page.locator('.draft-documents tr.el-table__row').count() == 6
                        and (await page.locator('.draft-documents').bounding_box())['height'] <= 362)
            await page.locator('.draft-preview').scroll_into_view_if_needed()
            await page.wait_for_function("document.querySelectorAll('.draft-preview .original-document-page').length===33")
            await check('列表分页不会截断33份原始凭证及单据预览',
                        await page.locator('.draft-preview .original-document-page').count() == 33)
            seen = []
            pager = page.locator('.voucher-pagination')
            for number in range(5):
                seen.extend(await page.locator('.linked-voucher .voucher-number').all_inner_texts())
                if number < 4:
                    await pager.locator('.btn-next').click()
            await check('凭证分页可遍历全部27条，末页3条无遗漏重复',
                        len(seen) == 27 and len(set(seen)) == 27
                        and set(seen) == {'布局-' + str(i) for i in range(1,28)}
                        and await page.locator('.linked-voucher').count() == 3)
            await check('翻到凭证末页后仍保留完整原件集合',
                        await page.locator('.draft-preview .original-document-page').count() == 33)
            await group('布局次企业有限公司')
            await check('切换企业后凭证列表回到第一页',
                        await page.locator('.linked-voucher').count() == 3
                        and await page.locator('.linked-voucher .voucher-number').first.inner_text() == '次组-3')
            await page.locator('.linked-voucher').first.get_by_role('button',name='核对凭证附件',exact=True).click()
            manual=page.locator('.el-dialog:visible').last
            await check('竖排列表已复核凭证可正常进入附件关联',
                        '手工匹配凭证' in await manual.inner_text() and '次组-3' in await manual.inner_text())
            await manual.get_by_role('button',name='取消',exact=True).click()
            await manual.wait_for(state='hidden')
            document_pager = page.locator('.document-pagination')
            first_documents = await page.locator('.draft-documents .document-number').all_inner_texts()
            await document_pager.locator('.btn-next').click()
            last_documents = await page.locator('.draft-documents .document-number').all_inner_texts()
            await check('超过6份单据通过分页完整访问且不重复',
                        len(first_documents) == 6 and len(last_documents) == 2
                        and len(set(first_documents + last_documents)) == 8)
            await group('布局主企业有限公司')
            await check('重新切组同步重置两份列表页码',
                        await page.locator('.linked-voucher').count() == 6
                        and await page.locator('.draft-documents tr.el-table__row').count() == 6)
            await page.locator('.draft-preview .el-select').click()
            await page.get_by_role('option', name='布局-1 · 原始凭证', exact=True).click()
            await check('预览选择末页凭证时列表同步到其所在页',
                        await page.locator('.linked-voucher').count() == 3
                        and await page.locator('.linked-voucher .voucher-number').filter(has_text='布局-1').count() == 1)
            await page.locator('.draft-preview .el-select').click()
            await page.get_by_role('option', name='企业全部凭证与单据', exact=True).click()
            await page.wait_for_function("document.querySelectorAll('.draft-preview .original-document-page').length===33")
            # The exact sticky offset is a user-visible invariant, measured after real window scroll.
            await page.evaluate('window.scrollTo(0,650)')
            await page.wait_for_timeout(180)
            first_top = await heading_top()
            await page.evaluate('window.scrollTo(0,1100)')
            await page.wait_for_timeout(180)
            second_top = await heading_top()
            await check('向下滚动不同位置时标题与生成按钮保持置顶',
                        abs(first_top) <= 2 and abs(second_top) <= 2
                        and await page.locator('.page-heading').get_by_role('button',name='生成档案册',exact=True).is_visible())
            await page.screenshot(path=str(ART / 'archive-layout-pinned.png'))
            await page.locator('.page-heading').get_by_role('button',name='生成档案册',exact=True).click()
            modal = page.locator('.el-dialog:visible').last
            await check('置顶生成按钮仍能打开实际档案生成表单', await modal.locator('#archive-period').is_visible())
            await modal.get_by_role('button',name='取消',exact=True).click()
            await page.locator('.preview-jump').click()
            await page.wait_for_timeout(700)
            header_box = await page.locator('.page-heading').bounding_box()
            preview_box = await page.locator('.draft-preview').bounding_box()
            await check('原件快捷跳转定位在置顶标题下方',
                        preview_box['y'] >= header_box['y']+header_box['height']-2
                        and preview_box['y'] < header_box['height']+130)
            await check('分页后整页高度保持紧凑且桌面无溢出',
                        await page.evaluate('document.body.scrollHeight < 3200') and await no_overflow())
            await page.wait_for_function("document.querySelector('.draft-preview .original-document-page[data-rendered=true]')")
            zoom = page.locator('.draft-preview .original-zoom-button:visible').first
            await zoom.click()
            zoom_dialog = page.locator('.original-page-zoom-dialog:visible')
            await zoom_dialog.wait_for()
            await check('重排后每张原件仍可单独放大且弹窗不被置顶标题遮挡',
                        await zoom_dialog.is_visible()
                        and await zoom_dialog.locator('.zoom-sheet').count() == 1)
            await zoom_dialog.get_by_role('button',name='关闭',exact=True).click()
            await zoom_dialog.wait_for(state='hidden')
            await page.evaluate('window.scrollTo(0,0)')
            await page.wait_for_timeout(180)
            await page.screenshot(path=str(ART / 'archive-layout-desktop.png'),full_page=True)
            await page.set_viewport_size({'width':390,'height':844})
            await page.evaluate('window.scrollTo(0,600)')
            await page.wait_for_timeout(200)
            await check('手机下标题及生成按钮滚动时仍固定且无横向溢出',
                        abs(await heading_top()) <= 2 and await no_overflow()
                        and await page.locator('.page-heading').get_by_role('button',name='生成档案册',exact=True).is_visible())
            for width in [390,360]:
                await page.set_viewport_size({'width':width,'height':844})
                card_geometry = await page.locator('.linked-voucher').evaluate_all('''nodes=>nodes.map(card=>{
                  const bounds=card.getBoundingClientRect(),amountNode=card.querySelector('strong'),amount=amountNode.getBoundingClientRect();
                  const range=document.createRange();range.selectNodeContents(amountNode);const textRects=[...range.getClientRects()];
                  const actions=[...card.querySelectorAll('.text-link')].map(e=>e.getBoundingClientRect());
                  const overlap=actions.some(a=>textRects.some(t=>Math.min(a.right,t.right)-Math.max(a.left,t.left)>1
                    && Math.min(a.bottom,t.bottom)-Math.max(a.top,t.top)>1));
                  return {width:bounds.width,scrollWidth:card.scrollWidth,clientWidth:card.clientWidth,
                    amountWidth:amount.width,amountScrollWidth:amountNode.scrollWidth,amountClientWidth:amountNode.clientWidth,
                    textLineCount:new Set(textRects.filter(t=>t.width>0).map(t=>Math.round(t.top))).size,
                    within:textRects.every(t=>t.left>=bounds.left && t.right<=bounds.right-2),
                    overlap,actionsWithin:actions.every(a=>a.left>=bounds.left&&a.right<=bounds.right-2)};
                })''')
                print('MOBILE_CARD_METRICS',json.dumps({'viewportWidth':width,'cards':card_geometry}),flush=True)
                await check(str(width)+'px手机大额金额单行可读且不与操作重叠或裁剪',
                            all(g['within'] and g['actionsWithin'] and not g['overlap']
                                and g['scrollWidth']<=g['clientWidth']+1
                                and g['amountScrollWidth']<=g['amountClientWidth']+1
                                and g['textLineCount']==1 for g in card_geometry))
                await page.evaluate('''()=>{
                  const h=document.querySelector('.page-heading').getBoundingClientRect().height;
                  const y=document.querySelector('.linked-vouchers').getBoundingClientRect().top+scrollY;
                  window.scrollTo(0,y-h-14);
                }''')
                await page.wait_for_timeout(180)
                await page.screenshot(path=str(ART / ('archive-layout-mobile-cards-'+str(width)+'.png')))

            await page.set_viewport_size({'width':390,'height':844})
            await page.locator('.preview-jump').click()
            await page.wait_for_timeout(700)
            header_box = await page.locator('.page-heading').bounding_box()
            preview_box = await page.locator('.draft-preview').bounding_box()
            await check('手机原件快捷跳转避开置顶标题',
                        preview_box['y'] >= header_box['height']-2 and preview_box['y'] < header_box['height']+130)
            await check('手机原件预览保留完整33页且列表未造成整页溢出',
                        await page.locator('.draft-preview .original-document-page').count() == 33 and await no_overflow())
            await page.screenshot(path=str(ART / 'archive-layout-mobile.png'))
            # 长编号使用次组独立样例，放在主组预览验收之后，避免重挂懒加载原件改变其前提。
            await page.set_viewport_size({'width':360,'height':844})
            await group('布局次企业有限公司')
            long_number=page.locator('.linked-voucher .voucher-number').filter(has_text='长凭证编号').first
            await check('窄屏长凭证号可完整换行且整条记录不被裁剪',
                        await long_number.evaluate('''e=>{const row=e.closest('.linked-voucher'),b=row.getBoundingClientRect(),
                          range=document.createRange();range.selectNodeContents(e);
                          return row.scrollWidth<=row.clientWidth+1&&e.scrollWidth<=e.clientWidth+1
                            && [...range.getClientRects()].every(r=>r.left>=b.left&&r.right<=b.right+1); }''')
                        and await no_overflow())
            await group('布局主企业有限公司')
            await page.set_viewport_size({'width':390,'height':844})
            was_deferred=await page.locator('.draft-preview .flipbook-stage').evaluate(
                "e=>!e.classList.contains('is-ready')")
            await page.locator('.preview-jump').click()
            await page.wait_for_function("document.querySelectorAll('.draft-preview .original-document-page').length===33")
            await page.wait_for_timeout(700)
            header_box=await page.locator('.page-heading').bounding_box()
            preview_box=await page.locator('.draft-preview').bounding_box()
            await check('手机切组后懒加载原件一次跳转即避开置顶标题',
                        was_deferred and preview_box['y']>=header_box['height']-2
                        and preview_box['y']<header_box['height']+130 and await no_overflow())
            before = await state()
            await page.reload(wait_until='networkidle')
            await check('浏览与分页没有改动业务成员或关联数据',
                        (await state())['nameAssociations'] == before['nameAssociations']
                        and len((await state())['vouchers']) == 30 and len((await state())['documents']) == 14)
            await check('布局与置顶浏览器异常为0', not errors)
            print(json.dumps({'passed':len(checks),'checks':checks,'errors':errors},ensure_ascii=False),flush=True)
        except Exception:
            await page.screenshot(path=str(ART / 'archive-layout-failure.png'),full_page=True)
            print('BROWSER_ERRORS',errors,flush=True)
            traceback.print_exc()
            raise
        finally:
            await browser.close()

asyncio.run(main())
