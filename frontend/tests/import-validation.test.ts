import { describe, expect, it } from 'vitest';
import { amountCents } from '../src/money';
import { voucherInputIssues } from '../src/voucherValidation';

/** 合成校验夹具：不代表已读取或验证用户桌面的真实文件。 */
const validVoucher = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  no: '记-0101',
  period: '2026-10',
  date: '2026-10-20',
  summary: '采购技术服务',
  supplier: '示例科技有限公司',
  amount: '1234.01',
  expectedAttachments: 1,
  ...patch,
});

describe('金额缺失、格式与精度校验', () => {
  it.each([undefined, '', '   '])('空白值 %s 明确提示填写金额', value => {
    expect(() => amountCents(value)).toThrow('请填写金额');
  });

  it.each([
    '¥1,234.01',
    '￥１，２３４．０１',
    '人民币 1,234.01 元',
    'RMB 1234.01',
    'CNY1234.01',
  ])('接受明确的人民币格式：%s', value => {
    expect(amountCents(value)).toBe(123401);
  });

  it.each([
    ['1,23', '错误的千分位分组'],
    ['1 2', '数字中间的空格'],
    ['1.230', '三位小数'],
    ['1e3', '科学计数法字符串'],
  ])('拒绝 %s（%s），避免静默改变金额', value => {
    expect(() => amountCents(value)).toThrow();
  });

  it('数值零可以被解析，是否允许零交给凭证业务校验', () => {
    expect(amountCents(0)).toBe(0);
    expect(voucherInputIssues(validVoucher({ amount: 0 })).some(issue => issue.field === 'amount')).toBe(true);
  });
});

describe('凭证逐字段校验与错误定位', () => {
  it('空凭证同时列出缺失的必填字段，不被金额解析的首个异常截断', () => {
    const issues = voucherInputIssues({});
    const fields = new Set(issues.map(issue => issue.field));
    for (const field of ['no', 'period', 'date', 'summary', 'supplier', 'amount']) {
      expect(fields.has(field), `应报告缺失字段 ${field}`).toBe(true);
    }
    expect(issues.every(issue => typeof issue.message === 'string' && issue.message.trim().length > 0)).toBe(true);
  });

  it('将仅包含空格的文本作为未填写字段处理', () => {
    const issues = voucherInputIssues(validVoucher({ no: ' ', summary: '  ', supplier: ' ', amount: ' ' }));
    const fields = issues.map(issue => issue.field);
    expect(fields).toEqual(expect.arrayContaining(['no', 'summary', 'supplier', 'amount']));
  });

  it.each([
    '¥1,234.01',
    '￥１，２３４．０１',
    '人民币 1,234.01 元',
    'RMB 1234.01',
    'CNY1234.01',
  ])('完整凭证的有效格式化金额 %s 不产生问题', amount => {
    expect(voucherInputIssues(validVoucher({ amount }))).toEqual([]);
  });

  it.each(['1,23', '1 2', '1.230', '1e3'])('非法金额 %s 能定位到金额字段', amount => {
    const issues = voucherInputIssues(validVoucher({ amount }));
    expect(issues.some(issue => issue.field === 'amount')).toBe(true);
  });

  it('日期与会计期间不一致时报告日期或期间字段问题', () => {
    const issues = voucherInputIssues(validVoucher({ period: '2026-10', date: '2026-09-20' }));
    expect(issues.some(issue => issue.field === 'date' || issue.field === 'period')).toBe(true);
  });
});
