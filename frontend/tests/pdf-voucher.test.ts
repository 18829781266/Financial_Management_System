import {describe,it,expect} from 'vitest';
import {parseVoucherPages} from '../src/pdfVoucher';
import type {PdfTextItem,PdfTextPage} from '../src/pdfText';
const item=(text:string,x:number,y:number,width=text.length*6,height=10):PdfTextItem=>({text,x,y,width,height});
interface Entry {debit?:string;credit?:string;summary?:string;account?:string}
function fixture(options:{no?:string;part?:string;page?:number;entries?:Entry[];debit?:string;credit?:string;attachments?:number;fragmented?:boolean;company?:string}={}):PdfTextPage{
 const rows=options.entries||[{debit:'125.10',account:'1122 应收账款_customer.测试采购有限公司'},{credit:'125.10',account:'6001 服务收入'}];
 const items:PdfTextItem[]=[item('记账凭证',260,350),item(options.attachments===undefined?'附单据 张':`附单据 ${options.attachments} 张`,500,320),item('单位：'+(options.company||'测试账套有限公司'),70,300),item('日期：2026-05-20',300,300),item(`凭证号：记 - ${options.no||'1'}${options.part?'  '+options.part:''}`,480,300)];
 if(options.fragmented)items.push(item('摘',100,270,10),item('要',110,270,10),item('科',260,270,10),item('目',270,270,10),item('借方',400,270,20),item('金额',420,270,20),item('贷方',500,270,20),item('金额',520,270,20));
 else items.push(item('摘要',100,270,20),item('科目',260,270,20),item('借方金额',400,270,40),item('贷方金额',500,270,40));
 rows.forEach((row,index)=>{const y=240-index*24;items.push(item(row.summary||'测试业务',70,y+2),item(row.account||'6601 费用',180,y));if(row.debit)items.push(item(row.debit,405,y-5,42));if(row.credit)items.push(item(row.credit,505,y-5,42));});
 items.push(item('合',70,50,10),item('计：测试合计',90,50),item(options.debit||'125.10',405,50,42),item(options.credit||'125.10',505,50,42));
 return {pageNumber:options.page||1,width:620,height:370,items,text:items.map(i=>i.text).join('\n')};
}
describe('文字型凭证 PDF 解析',()=>{
 it('按借贷列读取金额并保留凭证号、期间、客商',()=>{const [v]=parseVoucherPages([fixture({no:'0001',attachments:2})]);expect(v).toMatchObject({no:'记-0001',date:'2026-05-20',period:'2026-05',amount:'125.10',supplier:'测试采购有限公司',company:'测试账套有限公司',expectedAttachments:2,sourcePages:[1]});expect(v!.entries).toHaveLength(2);expect(v!.reviewReasons).toEqual([]);});
 it('将跨页累计合计只取末页，分录各累计一次',()=>{const pages=[fixture({part:'1/2',entries:[{debit:'300.00'},{credit:'200.00'}],debit:'300.00',credit:'200.00'}),fixture({page:2,part:'2/2',entries:[{credit:'100.00'}],debit:'300.00',credit:'300.00'})];const [v]=parseVoucherPages(pages);expect(v!.amount).toBe('300.00');expect(v!.entries).toHaveLength(3);expect(v!.sourcePages).toEqual([1,2]);expect(v!.reviewReasons.some(x=>x.includes('合计不一致'))).toBe(false);});
 it('保留同一借方列的正负分录以及合法零净额',()=>{const [v]=parseVoucherPages([fixture({entries:[{debit:'18.26'},{debit:'-18.26'}],debit:'0.00',credit:'0.00'})]);expect(v!.amount).toBe('0.00');expect(v!.entries.map(e=>e.debit)).toEqual(['18.26','-18.26']);expect(v!.entries.map(e=>e.credit)).toEqual(['0.00','0.00']);expect(v!.reviewReasons).toContain('零净额凭证，需按原始正负分录人工复核');expect(v!.reviewReasons.some(x=>x.includes('红字'))).toBe(true);});
 it('不把摘要里的四位小数单价当作金额',()=>{const page=fixture();page.items.push(item('数量 3.3333 吨，单价 100.1234 元',70,232));const [v]=parseVoucherPages([page]);expect(v!.amount).toBe('125.10');expect(v!.entries[0]!.summary).toContain('100.1234');});
 it('多个往来客商不能随意选第一个',()=>{const [v]=parseVoucherPages([fixture({entries:[{debit:'125.10',account:'1122 应收账款_c1.测试客户甲有限公司'},{credit:'125.10',account:'2202 应付账款_c2.测试客户乙有限公司'}]})]);expect(v!.supplier).toBe('');expect(v!.reviewReasons).toContain('包含 2 个往来客商，不能自动指定单一客商');});
 it('不把本企业抬头及待抵扣核算项当作客商',()=>{const [v]=parseVoucherPages([fixture({entries:[{debit:'125.10',account:'1221 其他应收款_0001.待抵扣'},{credit:'125.10',account:'2202 应付账款_c2.测试账套有限公司'}]})]);expect(v!.supplier).toBe('');expect(v!.reviewReasons.some(x=>x.includes('未发现明确外部客商'))).toBe(true);});
 it('原件客商截断时保留原名并提示',()=>{const [v]=parseVoucherPages([fixture({entries:[{debit:'125.10',account:'1122 应收账款_c1.测试客户有限公'},{credit:'125.10'}]})]);expect(v!.supplier).toBe('测试客户有限公');expect(v!.reviewReasons.some(x=>x.includes('截断'))).toBe(true);});
 it('附件数留空时保持未知',()=>{const [v]=parseVoucherPages([fixture()]);expect(v!.expectedAttachments).toBeUndefined();expect(v!.reviewReasons.some(x=>x.includes('附件数为空'))).toBe(true);});
 it('续页缺失时提示，不把第一页累计误称完整凭证',()=>{const [v]=parseVoucherPages([fixture({part:'1/2'})]);expect(v!.reviewReasons.some(x=>x.includes('续页页码缺失'))).toBe(true);});
 it('同号同日无续页标记的重复页要求复核',()=>{const [v]=parseVoucherPages([fixture(),fixture({page:2})]);expect(v!.reviewReasons.some(x=>x.includes('重复'))).toBe(true);});
 it('对分录与最终合计不一致给出明确复核原因',()=>{const [v]=parseVoucherPages([fixture({debit:'126.10'})]);expect(v!.reviewReasons.some(x=>x.includes('原始分录合计'))).toBe(true);});
 it('相同凭证号但不同单位不合并',()=>{const result=parseVoucherPages([fixture(),fixture({page:2,company:'另一测试有限公司'})]);expect(result).toHaveLength(2);});
 it('表头字符拆分时仍能定位借贷列',()=>{const [v]=parseVoucherPages([fixture({fragmented:true})]);expect(v!.amount).toBe('125.10');});
 it('单位名称拆分时不会包含日期及凭证号',()=>{const page=fixture();page.items=page.items.filter(i=>!i.text.startsWith('单位：'));page.items.push(item('单位：',70,300,30),item('拆分单位有限公司',100,300));const [v]=parseVoucherPages([page]);expect(v!.company).toBe('拆分单位有限公司');});
 it('识别到凭证却缺少金额表头时明确报错',()=>{const page=fixture();page.items=page.items.filter(i=>i.text!=='贷方金额');expect(()=>parseVoucherPages([page])).toThrow('分录表头或合计行');});
 it('非凭证页不产生虚构凭证',()=>{const page=fixture();page.items=page.items.filter(i=>!i.text.startsWith('凭证号'));expect(parseVoucherPages([page])).toEqual([]);});
});
