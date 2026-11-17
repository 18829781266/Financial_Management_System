import {describe,expect,it} from 'vitest';
import {createCsv,csvCell} from '../src/csvExport';

describe('spreadsheet-safe CSV export',()=>{
  it.each(['=HYPERLINK("https://example.invalid","x")','+SUM(1,2)','-1+2','@SUM(A1:A2)','\t=1+1','\r\n =1+1','\uFEFF=1+1','\u3000＝1+1'])('quotes imported formula text %j',value=>{
    expect(csvCell(value)).toBe('"\''+value.replaceAll('"','""')+'"');
  });
  it('retains signed numeric amounts as numbers',()=>{
    expect(csvCell(-100.25)).toBe('"-100.25"');
    expect(csvCell(0)).toBe('"0"');
    expect(csvCell('0000123456')).toBe('"0000123456"');
  });
  it('escapes commas, quotes and newlines without losing original content',()=>{
    expect(createCsv([['摘要','金额'],['采购,"材料"\n费用',1234.56]])).toBe('\uFEFF"摘要","金额"\r\n"采购,""材料""\n费用","1234.56"');
  });
  it('rejects invalid numeric values rather than exporting misleading amounts',()=>{
    expect(()=>csvCell(Number.NaN)).toThrow('无效数值');
    expect(()=>csvCell(Infinity)).toThrow('无效数值');
  });
});
