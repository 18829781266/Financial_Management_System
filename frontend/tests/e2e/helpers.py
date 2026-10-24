"""Test-only browser fixtures; production starts with an empty workspace."""
import json
import re
from pathlib import Path


async def install_demo_fixture(context_or_page):
    """Seed a fresh test origin once, preserving imports, reloads and reset state.

    BrowserContext and Page both support add_init_script. The fixture is injected
    before the app starts and only when its storage key does not exist. An empty
    state saved by a real reset is existing state and must never be replaced.
    """
    fixture = json.loads((Path(__file__).resolve().parent.parent / 'fixtures' / 'demo-state.json').read_text())
    script = """(() => {
      if (window.top !== window || !/^https?:$/.test(location.protocol)) return;
      try {
        const key = 'langchao-cloud-demo-v1';
        if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(FIXTURE));
      } catch { /* Non-storage documents and restricted frames do not need fixture data. */ }
    })();""".replace('FIXTURE', json.dumps(fixture, ensure_ascii=False))
    await context_or_page.add_init_script(script=script)


async def select_archive_range(dialog, period, start, end):
    """Choose the real month and voucher endpoints through the user-facing controls."""
    page = dialog.page
    month_field = dialog.locator('.el-form-item').filter(
        has=page.locator('.el-form-item__label', has_text='会计期间')
    ).first
    month_input = month_field.locator('input').first
    displayed = await month_input.input_value()
    parts = re.search(r'(\d{4})\D+(\d{1,2})', displayed)
    current_period = f'{parts.group(1)}-{int(parts.group(2)):02d}' if parts else ''
    if current_period != period:
        year, month = (int(part) for part in period.split('-'))
        await month_input.click()
        panel = page.locator('.el-date-picker:visible').last
        await panel.wait_for(state='visible')
        for _ in range(200):
            header = await panel.locator('.el-date-picker__header-label').first.inner_text()
            shown_year = int(re.search(r'\d{4}', header).group())
            if shown_year == year:
                break
            await panel.get_by_role('button', name='前一年' if shown_year > year else '后一年', exact=True).click()
        else:
            raise AssertionError(f'无法在月历中定位会计期间 {period}')
        await panel.locator('.el-month-table td').nth(month - 1).click()
        await panel.wait_for(state='hidden')

    async def choose_endpoint(label, voucher_no):
        dropdown = await archive_endpoint_dropdown(dialog, label)
        await dropdown.locator('.el-select-dropdown__item').filter(
            has=page.get_by_text(voucher_no, exact=True)
        ).click()
        await dropdown.wait_for(state='hidden')

    await choose_endpoint('起始凭证号', start)
    await choose_endpoint('终止凭证号', end)


async def archive_endpoint_dropdown(dialog, label):
    """Bind to this select's ARIA popup rather than another closing dropdown."""
    page = dialog.page
    field = dialog.locator('.el-form-item').filter(
        has=page.locator('.el-form-item__label', has_text=label)
    ).first
    select = field.locator('.el-select')
    combo = select.locator('[role="combobox"]')
    popup_id = await combo.get_attribute('aria-controls')
    if await combo.get_attribute('aria-expanded') != 'true':
        await select.click()
    dropdown = page.locator('.el-select-dropdown').filter(
        has=page.locator('[id="' + popup_id + '"]')
    )
    await dropdown.wait_for(state='visible')
    await dropdown.locator('.archive-voucher-option strong').first.wait_for(state='visible')
    return dropdown
