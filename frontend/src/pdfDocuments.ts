import type { PdfTextItem, PdfTextPage } from './pdfText';
import { amountCents } from './money';
import {normalizeBankAccount} from './entryAttachments';

export interface ParsedPdfDocument {
 type:'invoice'|'bank'|'contract'|'approval';
 number:string;
 /** 客商按原件付款人展示；发票的购买方即付款主体，不因本企业角色而交换买卖双方。 */
 payerName:string;
 payeeName:string;
 supplier:string;
 amount:string;
 date:string;
 sourcePages:number[];
 reviewReasons:string[];
 sourceRegion?:{x:number;y:number;width:number;height:number};
 bankNo?:string;
 receiptNo?:string;
 payerAccount?:string;
 payeeAccount?:string;
 accountVersion?:number;
}
const compact=(text:string)=>text.normalize('NFKC').replace(/\s+/g,'');
/** PDF.js 常将带字间距的“户 名”“全 称”拆成单字；仅合并已知同基线字段标签。 */
function combineLabels(items:PdfTextItem[]):PdfTextItem[]{
 const consumed=new Set<PdfTextItem>();const result:PdfTextItem[]=[];
 for(const item of items){
  if(consumed.has(item))continue;
  const first=compact(item.text);const label=['户名','全称','金额','摘要','账号','用途'].find(value=>value[0]===first);
  if(label){
   const next=items.find(candidate=>candidate!==item&&!consumed.has(candidate)&&compact(candidate.text)===label[1]&&Math.abs(candidate.y-item.y)<1&&candidate.x>=item.x+item.width-1&&candidate.x-item.x-item.width<Math.max(12,item.height*1.6));
   if(next){result.push({...item,text:label,width:next.x+next.width-item.x});consumed.add(next);continue;}
  }
  result.push(item);
 }
 return result;
}
function cleanAmount(text:string):string{
 const normalized=compact(text).replace(/^[（(]?小写[）)]?[:：]?/,'');
 const match=normalized.match(/(?:CNY|RMB|[¥￥])?([-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?:元|圆)?/i);
 if(!match)return '';
 try{return (amountCents(match[1])/100).toFixed(2);}catch{return '';}
}
function dateIn(text:string):string{
 const normalized=compact(text);
 const match=normalized.match(/(20\d{2})[年\-/ .](\d{1,2})[月\-/ .](\d{1,2})日?/)||normalized.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
 if(!match)return '';
 const value=`${match[1]}-${match[2]!.padStart(2,'0')}-${match[3]!.padStart(2,'0')}`;
 const date=new Date(`${value}T00:00:00Z`);
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:'';
}
/** 优先同一基线右侧值；不同栏的账号、开户行与打印日期不能成为字段值。 */
function rightOf(label:PdfTextItem,items:PdfTextItem[],width:number,tolerance=10):string{
 const limit=label.x<width/2?width/2:width;
 const candidates=items.filter(item=>item!==label&&item.x>=label.x+Math.max(3,label.width-12)&&item.x<limit&&Math.abs(item.y-label.y)<=tolerance).sort((a,b)=>a.x-b.x);
 const selected:PdfTextItem[]=[];
 for(const item of candidates){const previous=selected.at(-1);if(previous&&item.x-previous.x-previous.width>Math.max(15,item.height*1.7))break;selected.push(item);}
 return selected.map(item=>item.text).join('').trim();
}
function labelValue(items:PdfTextItem[],width:number,label:RegExp):string{
 const target=items.find(item=>label.test(compact(item.text)));
 if(!target)return '';
 const text=compact(target.text);const matched=text.match(label);
 const rest=matched?text.slice((matched.index??0)+matched[0].length).replace(/^[:：]/,''):'';
 return rest||rightOf(target,items,width);
}
type PartyRole='payer'|'payee';
interface PartyFields {payerName:string;payeeName:string}
function isPartyName(value:string):boolean{
 return /[A-Za-z\u4e00-\u9fff]/.test(value)&&!/^(?:开户行|账号|名称|户名|全称|付款人|收款人|统一社会信用代码|纳税人识别号)/.test(compact(value));
}
function partyFields(items:PdfTextItem[],width:number,kind:'invoice'|'bank',reasons:string[]):PartyFields{
 const names:Record<PartyRole,string[]>={payer:[],payee:[]};
 const add=(role:PartyRole,value:string)=>{const name=value.trim();if(name&&isPartyName(name)&&!names[role].includes(name))names[role].push(name);};
 // 优先使用明确的字段名称。只有“收款人名称”的利息回单不能反过来填成付款人。
 const explicit=/^(付款人名称|付款方名称|付款人户名|付款方户名|付款人全称|收款人名称|收款方名称|收款人户名|收款方户名|收款人全称|购买方名称|销售方名称)[:：]?/;
 for(const label of items){
  const matched=compact(label.text).match(explicit);if(!matched)continue;
  const value=compact(label.text).slice(matched[0].length)||rightOf(label,items,width,10);
  add(/^(付款|购买)/.test(matched[1]!)?'payer':'payee',value);
 }
 const generic=items.filter(item=>/^(?:户名|全称|名称)[:：]?$/.test(compact(item.text)));
 for(const label of generic){
  const value=rightOf(label,items,width,10);if(!isPartyName(value))continue;
  // 银行抬头常把“付/收”纵排，户名/全称则横排；只使用标签左侧邻近角色，忽略右侧“借方/贷方回单”等说明。
  const roleMarkers=items.filter(item=>item.x<label.x&&label.x-item.x<90&&Math.abs(item.y-label.y)<40&&/^(?:付|付款|付款人|付款方|收|收款|收款人|收款方|购|购买方|销|销售方)$/.test(compact(item.text))).sort((a,b)=>Math.abs(a.y-label.y)+Math.abs(a.x-label.x)-Math.abs(b.y-label.y)-Math.abs(b.x-label.x));
  let role:PartyRole|undefined;
  if(roleMarkers[0])role=/^(付|购)/.test(compact(roleMarkers[0].text))?'payer':'payee';
  else if(kind==='invoice'){
   // 支持的电子发票版式：购买方名称在左栏，销售方名称在右栏，与文件夹及本企业名称无关。
   role=label.x<width/2?'payer':'payee';
  }else if(generic.some(other=>other!==label&&Math.abs(other.y-label.y)<12&&(other.x<width/2)!==(label.x<width/2))){
   // 已支持的双栏银行模板中付款在左、收款在右；单独一栏又缺少角色时保持未知。
   role=label.x<width/2?'payer':'payee';
  }else if(generic.length===1){
   const context=compact(items.map(item=>item.text).join(''));
   // 建行的收费专用回单只打印扣费户名；同时具备收费项目与付款方式时该户名即付款人。
   // 计息回单中的存款户名则是收息方，不能填成付款人。
   if(/付款方式/.test(context)&&/工本费|汇款手续费/.test(context))role='payer';
   else if(/计息项目/.test(context)&&/存款利息|结息日/.test(context))role='payee';
  }
  if(role)add(role,value);
 }
 const payerName=names.payer.length===1?names.payer[0]!:'';
 const payeeName=names.payee.length===1?names.payee[0]!:'';
 if(!payerName)reasons.push(names.payer.length>1?'原件存在多个付款人名称，请核对付款主体':'原件未列明或未可靠读取付款人名称，请从原件补录，不能以收款人代替');
 if(names.payee.length>1)reasons.push('原件存在多个收款人名称，请核对收款主体');
 return {payerName,payeeName};
}
function parseInvoice(page:PdfTextPage):ParsedPdfDocument{
 const {items,width}=page;const reasons:string[]=[];
 const number=labelValue(items,width,/发票号码[:：]?/).replace(/\s/g,'').match(/\d{8,30}/)?.[0]||'';
 const date=dateIn(labelValue(items,width,/开票日期[:：]?/));
 const smallLabel=items.find(item=>/^[（(]小写[）)][:：]?$/.test(compact(item.text)));
 // 价税合计的小写值位于对应标签右侧，不能取不含税合计、税额或项目单价。
 let amount=smallLabel?cleanAmount(rightOf(smallLabel,items,width,6)):'';
 if(!amount){
  const totalLabel=items.find(item=>/价税合计/.test(compact(item.text)));
  if(totalLabel){
   const candidates=items.filter(item=>item.x>width*0.5&&Math.abs(item.y-totalLabel.y)<9&&/[¥￥]|CNY/.test(item.text));
   if(candidates.length===1)amount=cleanAmount(candidates[0]!.text);
  }
 }
 const parties=partyFields(items,width,'invoice',reasons);
 if(!number)reasons.push('未可靠读取发票号码，请从原件补录');
 if(!date)reasons.push('未可靠读取开票日期，请从原件补录');
 if(!amount)reasons.push('未可靠读取价税合计，请从原件补录');
 reasons.push('文字提取不核验印章或发票真伪，请检查原件');
 return {type:'invoice',number,...parties,supplier:parties.payerName,amount,date,sourcePages:[page.pageNumber],reviewReasons:reasons};
}
function bankTitle(text:string):boolean{
 return /^(?:中国工商银行)?网上银行电子回单(?:[（(]补打[）)])?$/.test(compact(text))||/^(?:中国建设银行单位客户专用回单|客户付费回单|利息收入回单|国内支付业务付款回单)$/.test(compact(text));
}
function bankDate(items:PdfTextItem[],width:number):string{
 for(const label of [/会计日期[:：]?/,/记账日期[:：]?/,/^日期[:：]?/]){
  const text=labelValue(items,width,label);const date=dateIn(text);if(date)return date;
 }
 // 建行抬头按年/月/日分列，限定在日期标签同一行读取，不使用“生成时间”。
 const yearLabel=items.find(item=>compact(item.text)==='年');
 if(yearLabel){
  const nearby=items.filter(item=>Math.abs(item.y-yearLabel.y)<=3&&item.x>yearLabel.x-35&&item.x<yearLabel.x+70).sort((a,b)=>a.x-b.x);
  const digits=nearby.map(item=>compact(item.text)).filter(text=>/^\d{2,4}$/.test(text));
  if(digits.length===3){const date=dateIn(`${digits[0]}-${digits[1]}-${digits[2]}`);if(date)return date;}
 }
 return '';
}
function bankAmount(items:PdfTextItem[],width:number):string{
 // 工行的金额、农行的小写金额、建行的“小写”值与中行的CNY金额分别选择其专用字段。
 const small=items.find(item=>/^(?:金额)?[（(]小写[）)]/.test(compact(item.text)));
 if(small){const inline=compact(small.text).replace(/^(?:金额)?[（(]小写[）)][:：]?/,'');const value=cleanAmount(inline||rightOf(small,items,width,6));if(value)return value;}
 const labeled=items.find(item=>/^金额[:：](?:CNY|RMB|[¥￥])/.test(compact(item.text)));
 if(labeled)return cleanAmount(compact(labeled.text).replace(/^金额[:：]/,''));
 const totalLabel=items.find(item=>compact(item.text)==='合计金额');
 if(totalLabel){const values=items.filter(item=>item.x>totalLabel.x+totalLabel.width&&Math.abs(item.y-totalLabel.y)<=4&&/^[¥￥]/.test(compact(item.text)));if(values.length===1)return cleanAmount(values[0]!.text);}
 const amountLabel=items.find(item=>/^金额[:：]?$/.test(compact(item.text)));
 if(amountLabel){const value=rightOf(amountLabel,items,width,6);if(/^(?:CNY|RMB|[¥￥])/.test(compact(value)))return cleanAmount(value);}
 return '';
}
/** 收付款账号分开提取。通用“账号”仅在角色或已支持的双栏布局明确时归属。 */
function bankAccounts(items:PdfTextItem[],width:number):{payerAccount:string;payeeAccount:string}{
 const accounts:{payer:string[];payee:string[]}={payer:[],payee:[]};
 const explicit=/^(付款人(?:开户)?账号|付款(?:银行)?账号|付款方账号|付方账号|付款账户|付款人账户|借方账号|转出账号|收款人(?:开户)?账号|收款(?:银行)?账号|收款方账号|收方账号|收款账户|收款人账户|贷方账号|转入账号)[:：]?/;
 const generic=items.filter(item=>/^(?:账号|帐?号|账户|银行账号|开户账号)[:：]?/.test(compact(item.text)));
 for(const label of items){
  const text=compact(label.text),match=text.match(explicit);
  let role:PartyRole|undefined;let value='';
  if(match){role=/^(?:付|借|转出)/.test(match[1]!)?'payer':'payee';value=text.slice(match[0].length)||rightOf(label,items,width,6);}
  else if(generic.includes(label)){
   const prefix=text.match(/^(?:银行账号|开户账号|账号|帐?号|账户)[:：]?/)![0];
   value=text.slice(prefix.length)||rightOf(label,items,width,6);
   const markers=items.filter(item=>item.x<=label.x&&label.x-item.x<100&&Math.abs(item.y-label.y)<85&&/^(?:付|付款|付款人|付款方|收|收款|收款人|收款方)$/.test(compact(item.text))).sort((a,b)=>Math.abs(a.y-label.y)-Math.abs(b.y-label.y));
   if(markers[0])role=/^付/.test(compact(markers[0].text))?'payer':'payee';
   else if(generic.some(other=>other!==label&&Math.abs(other.y-label.y)<12&&(other.x<width/2)!==(label.x<width/2)))role=label.x<width/2?'payer':'payee';
  }
  const account=normalizeBankAccount(value);
  if(role&&account&&!accounts[role].includes(account))accounts[role].push(account);
 }
 return {payerAccount:accounts.payer.length===1?accounts.payer[0]!:'',payeeAccount:accounts.payee.length===1?accounts.payee[0]!:''};
}
function parseBankRegion(page:PdfTextPage,items:PdfTextItem[],region:ParsedPdfDocument['sourceRegion']):ParsedPdfDocument{
 const reasons:string[]=[];const width=page.width;
 const receiptNo=labelValue(items,width,/^(?:电子回单号码|回单编号)[:：]?/).replace(/\s/g,'').match(/[A-Za-z0-9][A-Za-z0-9-]{5,}/)?.[0]||'';
 const bankNo=labelValue(items,width,/^(?:交易流水号|流水号)[:：]?/).replace(/\s/g,'').match(/[A-Za-z0-9][A-Za-z0-9-]{4,}/)?.[0]||'';
 const sequence=labelValue(items,width,/^No[:：]?/i).replace(/\s/g,'').match(/^\d+/)?.[0]||'';
 const date=bankDate(items,width);const amount=bankAmount(items,width);
 const number=receiptNo||(bankNo?(sequence?`${bankNo} / No.${sequence}`:bankNo):sequence&&date?`No.${sequence} / ${date}`:'');
 if(!receiptNo&&!bankNo&&sequence)reasons.push('原件未列交易流水号，日期与回单序号仅作本地索引，请复核');
 const parties=partyFields(items,width,'bank',reasons);
 const accounts=bankAccounts(items,width);
 if(!accounts.payeeAccount)reasons.push('未可靠读取收款账号，请核对原件后补录');
 if(!number)reasons.push('未可靠读取回单编号，请从原件补录');
 if(!date)reasons.push('未可靠读取记账或会计日期，请从原件补录，不能使用打印日期');
 if(!amount)reasons.push('未可靠读取交易金额，请从原件补录');
 return {type:'bank',number,...parties,...accounts,accountVersion:1,supplier:parties.payerName,amount,date,sourcePages:[page.pageNumber],sourceRegion:region,reviewReasons:reasons,bankNo:bankNo||undefined,receiptNo:receiptNo||undefined};
}
/** 按真实抬头切分同页多回单；无法识别模板时保留为待补录，禁止推算金额或主体。 */
export function parseDocumentPages(pages:PdfTextPage[],_ownCompany?:string):ParsedPdfDocument[]{
 const documents:ParsedPdfDocument[]=[];
 for(const input of pages){
  const page={...input,items:combineLabels(input.items)};
  if(/电子发票|发票[（(]增值税/.test(compact(page.text))){documents.push(parseInvoice(page));continue;}
  const titles=page.items.filter(item=>bankTitle(item.text)).sort((a,b)=>b.y-a.y);
  const unique=titles.filter((item,index)=>!index||Math.abs(item.y-titles[index-1]!.y)>5);
  for(let index=0;index<unique.length;index++){
   const top=index===0?page.height:Math.min(page.height,unique[index]!.y+25);
   const bottom=index+1<unique.length?Math.min(page.height,unique[index+1]!.y+25):0;
   const items=page.items.filter(item=>item.y>=bottom&&item.y<top);
   documents.push(parseBankRegion(page,items,{x:0,y:bottom,width:page.width,height:top-bottom}));
  }
 }
 return documents;
}
