"""Original-document flipbook regression using generated, non-business fixtures.

Run against a local build: BASE_URL=http://localhost:5174 BROWSER_EXECUTABLE=/usr/bin/chromium python tests/e2e/original_preview.py
"""
import asyncio, base64, hashlib, json, os, struct, traceback, zlib
from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parent
ARTIFACTS=ROOT/'artifacts';ARTIFACTS.mkdir(exist_ok=True)
CHECKS=[]

def bank_pdf(path, layouts):
 writer=PdfWriter()
 font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
 for index,(width,height,rotation) in enumerate(layouts,1):
  page=writer.add_blank_page(width=width,height=height)
  page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
  # Distinct colored edges and a stamp verify that the raw original is drawn completely.
  content=f'1 1 1 rg 0 0 {width} {height} re f\n0.03 0.24 0.63 rg 0 {height-25} {width} 25 re f\n0.10 0.55 0.30 rg 0 0 {width} 20 re f\n0.88 0.10 0.10 rg {width-100} 30 60 60 re f\n0 0 0 rg BT /F1 20 Tf 35 {height-70} Td (BANK ORIGINAL PAGE {index}) Tj ET\n0 0 0 RG 1 w 25 110 {width-50} {max(20,height-220)} re S\nBT /F1 12 Tf 40 140 Td (RAW RECEIPT / KEEP ORIGINAL LAYOUT) Tj ET\n'.encode()
  stream=DecodedStreamObject();stream.set_data(content);page[NameObject('/Contents')]=writer._add_object(stream)
  if rotation:page.rotate(rotation)
 with path.open('wb') as file:writer.write(file)

def colored_png(path):
 width,height=480,240
 rows=[]
 for y in range(height):
  row=bytearray()
  for x in range(width):
   color=(18,62,160) if y<25 else (25,140,77) if y>=220 else (224,25,25) if 350<=x<410 and 150<=y<210 else (255,255,255)
   row.extend(color)
  rows.append(b'\x00'+row)
 def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
 path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b''))

async def check(name,condition=True):
 if not condition:raise AssertionError(name)
 CHECKS.append(name);print('PASS',name,flush=True)

async def main():
 multi=ARTIFACTS/'original-bank-multipage.pdf';single=ARTIFACTS/'original-voucher-single.pdf';image=ARTIFACTS/'original-bank-image.png'
 bank_pdf(multi,[(600,300,0),(600,800,0),(600,800,90)])
 bank_pdf(single,[(600,300,0)]);colored_png(image)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('BROWSER_EXECUTABLE') or None,headless=True,args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':1536,'height':1100});await page.add_init_script("""(()=>{const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL),live=new Set();URL.createObjectURL=blob=>{const url=create(blob);live.add(url);return url;};URL.revokeObjectURL=url=>{live.delete(url);revoke(url);};window.__originalPreviewLiveUrls=live;})();""");page.set_default_timeout(20000);errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
  async def state():return await page.evaluate("JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'))")
  async def nav(name):await page.get_by_role('button',name=name,exact=True).first.click();await page.wait_for_timeout(150)
  async def wait_canvas(file_id,source_page=1):
   await page.wait_for_function("""({id,n})=>[...document.querySelectorAll('.original-document-page')].filter(e=>e.dataset.fileId===id&&e.dataset.sourcePage===String(n)).some(e=>{const c=e.querySelector('canvas');if(!c||c.width<=100||c.height<=100)return false;const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>0&&Math.min(pixels[i],pixels[i+1],pixels[i+2])<180)return true;return false;})""",arg={'id':file_id,'n':source_page})
  async def group(name):
   await page.locator('.payer-group').filter(has_text=name).click();await page.wait_for_timeout(200)
   # Every fixture has a real matched voucher; select its linked documents to test one-file pagination.
   await page.locator('.draft-preview .el-select').click();await page.get_by_role('option',name='全部已关联单据',exact=True).click();await page.wait_for_timeout(150)
  async def image_ready():await page.wait_for_function("[...document.querySelectorAll('img.original-document-image')].some(e=>e.complete&&e.naturalWidth===480)")
  try:
   await page.goto(os.environ.get('BASE_URL','http://localhost:5173/'),wait_until='networkidle')
   # At least one original follows the real upload/validation/IndexedDB path.
   await nav('数据采集');await page.locator('.section-tabs').get_by_role('button',name='原始单据',exact=False).first.click();await page.get_by_role('button',name='批量上传单据',exact=True).click();dialog=page.locator('.batch-import-dialog:visible')
   await dialog.locator('input[type=file]').set_input_files(str(multi));await page.wait_for_function("!document.querySelector('.batch-import-dialog .upload-zone')?.disabled")
   for name,value in [('客商名称','测试银行甲'),('日期','2026-10-20'),('金额','100.00'),('单据编号','ORIGINAL-BANK-MULTI')]:await dialog.get_by_role('textbox',name=name,exact=True).fill(value)
   await dialog.locator('.el-select').click();await page.locator('.el-select-dropdown:visible').get_by_text('银行回单',exact=True).click();await dialog.get_by_role('button',name='确认导入（1）',exact=True).click();await dialog.wait_for(state='hidden')
   imported=next(d for d in (await state())['documents'] if d['number']=='ORIGINAL-BANK-MULTI');file_id=imported['fileId'];await check('真实UI上传保留一份多页银行原件',bool(file_id) and imported['type']=='bank')
   inputs={'fileId':file_id,'single':base64.b64encode(single.read_bytes()).decode(),'image':base64.b64encode(image.read_bytes()).decode()}
   await page.evaluate("""async data=>{const s=JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'));const bank=s.documents.find(d=>d.fileId===data.fileId);bank.status='matched';bank.matchReviewRequired=false;const make=(id,name,payer,fileId)=>({id,name,type:'bank',supplier:payer,payerName:payer,payeeName:'合成收款方',partyVersion:2,amount:100,date:'2026-10-20',number:id,seal:true,status:'matched',matchReviewRequired:false,extractionStatus:'reviewed',fileId,importSequence:5});s.vouchers=[];s.documents=[bank,make('preview-image','原始银行图片.png','测试银行乙','preview-image-file'),make('preview-missing','原件已清理.pdf','测试银行缺件','preview-no-file'),make('preview-single-pdf','单页银行原件.pdf','测试银行单页','preview-voucher-file')];s.archives=[];s.lastImportSequence=5;s.vouchers=s.documents.map((d,i)=>({id:'preview-linked-voucher-'+i,no:'关联-'+(i+1),period:'2026-10',date:'2026-10-20',summary:'合成原件关联',supplier:d.payerName,amount:100,status:'matched',matchReviewRequired:false,documentIds:[d.id],reviewStatus:'reviewed',importSequence:5}));s.payerGroups=s.documents.map((d,i)=>({id:'preview-group-'+i,period:'2026-10',payerName:d.payerName,documentIds:[d.id],voucherIds:[s.vouchers[i].id],updatedAt:'2026-10-22 10:00:00'}));s.lastMatchRun={id:'preview-run',time:'2026-10-22 10:00:00',period:'2026-10',matched:4,remaining:0,groupCount:4,outcomes:[],rules:s.rules};localStorage.setItem('langchao-cloud-demo-v1',JSON.stringify(s));const open=indexedDB.open('langchao-files-v1',1);await new Promise((resolve,reject)=>{open.onsuccess=resolve;open.onerror=reject;});const db=open.result;const tx=db.transaction('files','readwrite');const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));tx.objectStore('files').put(new Blob([bytes(data.single)],{type:'application/pdf'}),'preview-voucher-file');tx.objectStore('files').put(new Blob([bytes(data.image)],{type:'image/png'}),'preview-image-file');await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=reject;});db.close();}""",inputs)
   await page.reload(wait_until='networkidle');await page.get_by_role('button',name='已匹配归档',exact=False).first.click();await group('测试银行甲');await wait_canvas(file_id,1)
   await check('单记录多页银行PDF自动展开全部3页',await page.locator('.draft-page-controls').inner_text()=='1 / 3')
   await check('工作稿直接使用原件画布而不是重新排版信息页',await page.locator('.draft-preview canvas.original-document-canvas').count()>=3 and await page.locator('.draft-preview .record-sheet').count()==0)
   pixels=await page.locator(f'.original-document-page[data-file-id="{file_id}"][data-source-page="1"] canvas').first.evaluate("""c=>{const x=c.getContext('2d');const at=(u,v)=>Array.from(x.getImageData(Math.floor(c.width*u),Math.floor(c.height*v),1,1).data);return {width:c.width,height:c.height,top:at(.05,.03),bottom:at(.05,.98),stamp:at(.90,.8),fit:getComputedStyle(c).objectFit};}""")
   await check('横版原件完整保留顶部蓝栏底部绿栏和红章',pixels['width']==2*pixels['height'] and pixels['top'][2]>pixels['top'][0]*3 and pixels['bottom'][1]>pixels['bottom'][0]*2 and pixels['stamp'][0]>pixels['stamp'][1]*3 and pixels['fit']=='contain')
   await wait_canvas(file_id,2);await wait_canvas(file_id,3)
   sizes=await page.locator(f'.original-document-page[data-file-id="{file_id}"] canvas').evaluate_all('(items)=>items.map(c=>({width:c.width,height:c.height}))')
   await check('竖版及旋转页使用原始方向和比例',any(abs(x['width']/x['height']-.75)<.01 for x in sizes) and any(abs(x['width']/x['height']-4/3)<.01 for x in sizes))
   before_hash=await page.evaluate("""async id=>{const req=indexedDB.open('langchao-files-v1',1);await new Promise(r=>req.onsuccess=r);const db=req.result;const get=db.transaction('files').objectStore('files').get(id);await new Promise(r=>get.onsuccess=r);const hash=await crypto.subtle.digest('SHA-256',await get.result.arrayBuffer());db.close();return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}""",file_id)
   await check('预览不改写上传银行原件字节',before_hash==hashlib.sha256(multi.read_bytes()).hexdigest())
   await page.get_by_role('button',name='工作稿下一页',exact=True).click();await page.wait_for_timeout(1100);await check('多页单据可翻到最后页且正确禁用下一页','3 / 3'==await page.locator('.draft-page-controls').inner_text() and await page.get_by_role('button',name='工作稿下一页',exact=True).is_disabled())
   await group('测试银行乙');await image_ready();await check('单张图片直接显示PNG原件无信息页',await page.locator('img.original-document-image').count()==1 and await page.locator('.draft-preview .record-sheet').count()==0)
   image_properties=await page.locator('img.original-document-image').evaluate('(e)=>({width:e.naturalWidth,height:e.naturalHeight,fit:getComputedStyle(e).objectFit})');await check('图片按原始比例完整包含显示',image_properties=={'width':480,'height':240,'fit':'contain'})
   await group('测试银行缺件');await check('原件缺失明确显示说明且不伪造票据',await page.locator('.draft-preview').get_by_text('未找到',exact=False).count()>0 and await page.locator('.draft-preview .record-sheet').count()==0)
   await group('测试银行单页');await wait_canvas('preview-voucher-file');await check('单页PDF直接静态显示原件且没有无效翻页按钮',await page.locator('.draft-preview canvas.original-document-canvas').count()==1 and await page.locator('.draft-page-controls').count()==0)
   for _ in range(4):
    await page.locator('.payer-group').filter(has_text='测试银行甲').click();await page.locator('.payer-group').filter(has_text='测试银行乙').click()
   await group('测试银行乙');await image_ready();await check('快速切换分组后只显示当前图片原件',await page.locator('.draft-preview img.original-document-image').count()==1 and await page.locator('.draft-preview canvas.original-document-canvas').count()==0)
   await nav('数据采集');await page.wait_for_function('window.__originalPreviewLiveUrls.size===0');await check('退出原件预览释放图片临时ObjectURL',await page.evaluate('window.__originalPreviewLiveUrls.size===0'))
   # Prepare an isolated formal archive with one voucher PDF, one 3-page bank original and one image.
   await page.evaluate("""id=>{const s=JSON.parse(localStorage.getItem('langchao-cloud-demo-v1'));const bank=s.documents.find(d=>d.fileId===id);const image=s.documents.find(d=>d.id==='preview-image');bank.status=image.status='matched';s.vouchers=[{id:'preview-voucher',no:'原件-1',period:'2026-10',date:'2026-10-20',summary:'合成原件预览',supplier:'测试银行甲',amount:200,status:'matched',documentIds:[bank.id,image.id],fileId:'preview-voucher-file',fileName:'原始记账凭证.pdf',importSequence:6}];s.archives=[{id:'preview-archive',title:'原始单据翻页验收',period:'2026-10',startVoucherNo:'原件-1',endVoucherNo:'原件-1',voucherCount:1,pageCount:5,amount:200,createdAt:'2026-10-22 10:00:00',status:'locked'}];delete s.lastMatchRun;localStorage.setItem('langchao-cloud-demo-v1',JSON.stringify(s));}""",file_id)
   await page.reload(wait_until='networkidle');await page.get_by_role('button',name='档案册管理',exact=False).first.click();await wait_canvas('preview-voucher-file');await check('正式档案原件预览按实际页面汇总5页','/ 05' in await page.locator('.page-controls').inner_text())
   await page.get_by_role('button',name='目录',exact=True).click();catalog=page.locator('.catalog-popup > button');await check('目录按PDF全部页面展开',await catalog.count()==5)
   await catalog.nth(3).click();await page.wait_for_timeout(1100);await check('目录可跳转到银行PDF的第3页',await page.locator('.page-controls b').inner_text() in ['03','04'] and await page.locator('.catalog-popup').count()==0)
   await page.get_by_title('放大',exact=True).click();await page.get_by_title('放大',exact=True).click();await check('原件支持保留现有缩放控件',await page.locator('.zoom-value').inner_text()=='110%')
   await page.get_by_title('全屏预览').click();await check('原件翻页可进入全屏',await page.evaluate('!!document.fullscreenElement'));await page.get_by_title('全屏预览').click();await check('全屏退出后原件仍可翻阅',not await page.evaluate('!!document.fullscreenElement') and await page.locator('.original-document-page').count()==5)
   await page.get_by_role('button',name='查看首页',exact=True).click();await page.wait_for_timeout(1100);await page.screenshot(path=str(ARTIFACTS/'original-preview-desktop.png'),full_page=True)
   await page.set_viewport_size({'width':390,'height':844});await page.wait_for_timeout(450);await check('手机原件预览页面无横向溢出',await page.evaluate('document.body.scrollWidth<=innerWidth'))
   await page.get_by_role('button',name='下一页',exact=True).click();await page.wait_for_timeout(1100);await check('手机单页模式仍可翻阅原件',await page.locator('.page-controls b').inner_text()!='01')
   await page.screenshot(path=str(ARTIFACTS/'original-preview-mobile.png'),full_page=True)
   for _ in range(3):await nav('数据采集');await nav('电子档案')
   await check('反复卸载和重新进入无浏览器异常',not errors)
   print(json.dumps({'passed':len(CHECKS),'checks':CHECKS,'errors':errors},ensure_ascii=False),flush=True)
  except Exception:
   await page.screenshot(path=str(ARTIFACTS/'original-preview-failure.png'),full_page=True);print('BROWSER_ERRORS',errors,flush=True);traceback.print_exc();raise
  finally:await browser.close()

if __name__=='__main__':asyncio.run(main())
