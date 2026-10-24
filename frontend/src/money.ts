/** 金额保留原始十进制文本，先验证再以整数“分”参与比较，禁止先 Number() 丢掉格式信息。 */
export function amountCents(value:unknown):number {
 const source=String(value??'').normalize('NFKC').trim();
 if(!source)throw new Error('请填写金额');
 // 只去除明确的人民币前后缀；内部空格或错误逗号分组不直接拼接成数字。
 let raw=source.replace(/^(?:人民币|RMB|CNY|¥)\s*/i,'').replace(/\s*(?:元|圆)$/,'').trim();
 if(/^\(.*\)$/.test(raw))raw='-'+raw.slice(1,-1).trim();
 if(/\s/.test(raw)||!/^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)){
  if(/\d\.\d{3,}$/.test(raw))throw new Error('金额最多支持两位小数，请核对原始值');
  throw new Error('金额格式应为数字，最多两位小数，例如 1234.56 或 1,234.56');
 }
 raw=raw.replace(/,/g,'');
 const negative=raw.startsWith('-');const [whole='0',fraction='']=raw.replace(/^[-+]/,'').split('.');
 const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(cents))throw new Error('金额超出可精确处理的范围');
 return negative?-cents:cents;
}
