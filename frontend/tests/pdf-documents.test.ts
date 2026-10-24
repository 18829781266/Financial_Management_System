import {describe,it,expect} from 'vitest';
import {parseDocumentPages} from '../src/pdfDocuments';
import type {PdfTextItem,PdfTextPage} from '../src/pdfText';
function item(text:string,x:number,y:number,width=40):PdfTextItem{return{text,x,y,width,height:10};}
function page(items:PdfTextItem[]):PdfTextPage{return{pageNumber:1,width:600,height:840,items,text:items.map(i=>i.text).join('\n')};}
function invoice():PdfTextPage{return page([
 item('电子发票（增值税专用发票）',160,790),item('发票号码：',430,760),item('26000000000000000123',480,760,110),item('开票日期：',430,740),item('2026年06月30日',480,740,110),
 item('名称：',30,680,24),item('示例采购有限公司',60,680,120),item('名称：',320,680,24),item('示例销售有限公司',350,680,130),
 item('合计',30,560),item('¥100.00',380,560),item('¥13.00',530,560),item('价税合计（大写）',30,530),item('（小写）',400,530,40),item('¥113.00',450,530),
 ]);}
describe('文字型原始单据PDF解析',()=>{
 it('保留长发票编号和价税合计，客商使用购买方即付款人',()=>{
  const result=parseDocumentPages([invoice()],'示例采购有限公司')[0]!;
  expect(result.number).toBe('26000000000000000123');expect(result.amount).toBe('113.00');expect(result.date).toBe('2026-06-30');expect(result.supplier).toBe('示例采购有限公司');expect(result.payerName).toBe('示例采购有限公司');expect(result.payeeName).toBe('示例销售有限公司');
 });
 it('本企业是销售方或购买方时，付款人角色均不能倒置',()=>{expect(parseDocumentPages([invoice()],'示例销售有限公司')[0]!.supplier).toBe('示例采购有限公司');});
 it('无需本企业名称也能按购买方和销售方位置读取付款与收款人',()=>{const result=parseDocumentPages([invoice()])[0]!;expect(result.supplier).toBe('示例采购有限公司');expect(result.payerName).toBe('示例采购有限公司');expect(result.payeeName).toBe('示例销售有限公司');});
 it('同页两回单按抬头切分，取记账日期而不是打印日期',()=>{
  const items:PdfTextItem[]=[];
  for(const [offset,amount,number] of [[0,'4.50','A000001'],[400,'123.00','A000002']] as const){items.push(
   item('中国工商银行 网上银行电子回单（补打）',160,790-offset,250),item(`电子回单号码：${number}`,30,760-offset,200),
   item('户 名',90,730-offset,35),item('示例本企业有限公司',140,736-offset,150),item('户 名',330,730-offset,35),item('示例交易对方有限公司',380,736-offset,180),
   item('金 额',90,680-offset,35),item(`￥${amount}元`,140,680-offset,100),item('记账日期',385,540-offset,40),item('2026年06月26日',435,540-offset,120),item('打印日期：2026年7月1日',400,520-offset,180),
  );}
  const result=parseDocumentPages([page(items)],'示例本企业有限公司');expect(result).toHaveLength(2);expect(result.map(d=>d.amount)).toEqual(['4.50','123.00']);expect(result.map(d=>d.date)).toEqual(['2026-06-26','2026-06-26']);expect(result[0]!.sourceRegion!.y).toBe(result[1]!.sourceRegion!.height);expect(result[1]!.supplier).toBe('示例本企业有限公司');expect(result[1]!.payeeName).toBe('示例交易对方有限公司');
 });
 it('只有本企业名称的利息回单不虚构银行客商，不使用打印日期',()=>{
  const result=parseDocumentPages([page([item('利息收入回单',250,790),item('收款人名称：',40,730,60),item('示例本企业有限公司',105,730,170),item('金额：CNY6.82',40,700,150),item('打印日期：2026-07-01',40,600,200),item('回单编号：0000123456789',40,550,200)])],'示例本企业有限公司')[0]!;
  expect(result.supplier).toBe('');expect(result.payerName).toBe('');expect(result.payeeName).toBe('示例本企业有限公司');expect(result.reviewReasons.join('')).toContain('不能以收款人代替');expect(result.date).toBe('');expect(result.amount).toBe('6.82');expect(result.reviewReasons.join('')).toContain('不能使用打印日期');
 });
 it('建行年/月/日分列并用回单序号区分共享交易流水',()=>{
  function receipt(sequence:string):PdfTextPage{return page([item('中国建设银行单位客户专用回单',170,800,250),item(`No：${sequence}`,430,803),item('流水号：ABC123456789',390,780,180),item('2026',250,780,20),item('年',272,780,10),item('06',282,780,10),item('月',292,780,10),item('11',302,780,10),item('日',312,780,10),item('（小写）￥800,000.00',340,700,180)]);}
  const first=parseDocumentPages([receipt('65')])[0]!,second=parseDocumentPages([receipt('66')])[0]!;
  expect(first.date).toBe('2026-06-11');expect(first.amount).toBe('800000.00');expect(first.number).toBe('ABC123456789 / No.65');expect(first.number).not.toBe(second.number);expect(first.bankNo).toBe(second.bankNo);
 });
 it('没有已支持抬头的文件返回空，由导入流程保留人工补录',()=>{expect(parseDocumentPages([page([item('扫描图片',10,20)])])).toEqual([]);});
 it('PDF.js拆分字间距标签时，仍读取金额与客商且不拼入下一栏的收字',()=>{
  const result=parseDocumentPages([page([
   item('中国工商银行 网上银行电子回单（补打）',160,790,250),item('户',90,730,10),item('名',110,730,10),item('示例本企业有限公司',140,736,130),
   item('户',330,730,10),item('名',350,730,10),item('示例收款人有限公司',380,736,150),item('金',90,680,10),item('额',110,680,10),item('￥4.50元',140,680,100),
   item('电子回单号码：A000001',30,760,180),item('记账日期',385,540,40),item('2026年06月26日',435,540,120),
  ])],'示例本企业有限公司')[0]!;
  expect(result.amount).toBe('4.50');expect(result.supplier).toBe('示例本企业有限公司');expect(result.payeeName).toBe('示例收款人有限公司');
  const ccb=parseDocumentPages([page([item('中国建设银行单位客户专用回单',170,800,250),item('全',50,730,10),item('称',70,730,10),item('示例付款有限公司',90,730,120),item('收',284,726,10),item('全',307,730,10),item('称',327,730,10),item('示例本企业有限公司',347,730,140)])],'示例本企业有限公司')[0]!;
  expect(ccb.supplier).toBe('示例付款有限公司');
 });
 it('忽略正文里的回单编号提示，仅使用字段标签；支持分离的CNY金额',()=>{
  const result=parseDocumentPages([page([
   item('电子回单可以重复打印，回单编号相同表示同一笔业务',30,500,260),item('网上银行电子回单',200,790,180),item('回单编号：14918666469482599353',30,750,220),
   item('金额：',40,700,30),item('CNY10.00',69,700,60),item('会计日期',330,600,40),item('20260614',380,600,60),
  ])])[0]!;expect(result.number).toBe('14918666469482599353');expect(result.amount).toBe('10.00');expect(result.date).toBe('2026-06-14');
 });
 it('利息与手续费使用合计金额而不是计息本金，并保留缺流水的复核提示',()=>{
  const result=parseDocumentPages([page([
   item('中国建设银行单位客户专用回单',170,800,250),item('No：70',430,803),item('流水号：',440,780,40),item('2026',210,780,20),item('年',230,780,10),item('06',240,780,10),item('月',250,780,10),item('21',260,780,10),item('日',270,780,10),
   item('本金/积数',310,700),item('41855114.08',330,680,70),item('利息',490,700),item('￥58.13',520,680),item('合计金额',30,600,40),item('(大写)人民币伍拾捌元壹角叁分',90,600,180),item('￥58.13',385,600,50),
  ])])[0]!;expect(result.amount).toBe('58.13');expect(result.date).toBe('2026-06-21');expect(result.number).toBe('No.70 / 2026-06-21');expect(result.reviewReasons.join('')).toContain('未列交易流水号');
 });

 it('付款人是本企业时保留本企业，不能筛掉本企业再误填收款人',()=>{
  const result=parseDocumentPages([page([item('网上银行电子回单',200,790,180),item('付款方',30,730,30),item('户名',70,730,30),item('示例本企业有限公司',110,730,150),item('收款方',310,730,30),item('户名',350,730,30),item('供应商有限公司',390,730,150)])],'示例本企业有限公司')[0]!;
  expect(result.payerName).toBe('示例本企业有限公司');expect(result.supplier).toBe(result.payerName);expect(result.payeeName).toBe('供应商有限公司');
 });
 it('收款回单保留外部客户付款人和本企业收款人',()=>{
  const result=parseDocumentPages([page([item('网上银行电子回单',200,790,180),item('付',25,730,10),item('全称',50,735,30),item('客户付款有限公司',90,735,160),item('收',310,730,10),item('全称',335,735,30),item('示例本企业有限公司',375,735,160)])],'示例本企业有限公司')[0]!;
  expect(result.payerName).toBe('客户付款有限公司');expect(result.supplier).toBe('客户付款有限公司');expect(result.payeeName).toBe('示例本企业有限公司');
 });
 it('明确的付款人名称字段优先角色，不能依左右位置互换',()=>{
  const result=parseDocumentPages([page([item('网上银行电子回单',200,790,180),item('收款人名称：示例收款有限公司',30,730,250),item('付款人名称：示例付款有限公司',320,730,250)])])[0]!;
  expect(result.payerName).toBe('示例付款有限公司');expect(result.payeeName).toBe('示例收款有限公司');expect(result.supplier).toBe('示例付款有限公司');
 });
 it('只有收款人字段时付款人保持未知，不从公司抬头或收款人补值',()=>{
  const result=parseDocumentPages([page([item('网上银行电子回单',200,790,180),item('收款人名称：示例本企业有限公司',30,730,250)])],'示例本企业有限公司')[0]!;
  expect(result.payerName).toBe('');expect(result.supplier).toBe('');expect(result.payeeName).toBe('示例本企业有限公司');expect(result.reviewReasons.join('')).toContain('付款人');
 });
 it('同角色存在多个人名时不任取一个付款人',()=>{
  const result=parseDocumentPages([page([item('网上银行电子回单',200,790,180),item('付款人名称：甲公司',30,730,200),item('付款人名称：乙公司',30,700,200),item('收款人名称：收款公司',330,730,200)])])[0]!;
  expect(result.payerName).toBe('');expect(result.reviewReasons.join('')).toContain('多个付款人');
 });
 it('收费专用回单的扣费户名是付款人，计息回单的存款户名是收款人',()=>{
  const base=[item('中国建设银行单位客户专用回单',170,800,250),item('户名：',30,730,30),item('示例本企业有限公司',70,730,180)];
  const fee=parseDocumentPages([page([...base,item('项目名称',30,700),item('工本费/转账汇款手续费',90,700,180),item('付款方式：',30,650,70)])])[0]!;
  expect(fee.payerName).toBe('示例本企业有限公司');expect(fee.supplier).toBe(fee.payerName);expect(fee.payeeName).toBe('');
  const interest=parseDocumentPages([page([...base,item('计息项目',30,700),item('结息日',150,700),item('上列存款利息,已照收你单位',30,650,230)])])[0]!;
  expect(interest.payerName).toBe('');expect(interest.payeeName).toBe('示例本企业有限公司');expect(interest.supplier).toBe('');
 });

});
