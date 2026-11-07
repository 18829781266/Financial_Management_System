/** 文件存入 IndexedDB，刷新后重新创建预览 URL，不把临时 blob: 地址写作永久地址。 */
const DB_NAME = 'langchao-files-v1';
async function openDb(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw new Error('当前浏览器不支持本地文件存储，请更换浏览器');
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('files');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('无法打开本地文件存储，请检查浏览器存储权限'));
  });
}
export async function saveFiles(files: {id:string;file:Blob}[]): Promise<void> {
  if (!files.length) return;
  const db=await openDb();
  try { await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('files','readwrite');
    files.forEach(item=>tx.objectStore('files').put(item.file,item.id));
    tx.oncomplete=()=>resolve();
    tx.onerror=tx.onabort=()=>reject(new Error('文件保存失败，可能已超出浏览器存储空间；本批次未导入'));
  }); } finally {db.close();}
}
export async function loadFile(id:string):Promise<Blob|undefined>{
  const db=await openDb();
  try{return await new Promise((resolve,reject)=>{const request=db.transaction('files').objectStore('files').get(id);request.onsuccess=()=>resolve(request.result as Blob|undefined);request.onerror=()=>reject(new Error('读取文件失败'));});}finally{db.close();}
}
export async function removeFiles(ids:string[]):Promise<void>{
  if(!ids.length)return;const db=await openDb();
  try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('files','readwrite');ids.forEach(id=>tx.objectStore('files').delete(id));tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(new Error('删除本地文件失败，请重试'));});}finally{db.close();}
}
/** 整个文件仓库一次事务清空，同时移除上传原件、档案PDF和遗留孤儿文件。 */
export async function clearFiles():Promise<void>{
 const db=await openDb();
 try{await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('files','readwrite');tx.objectStore('files').clear();
  tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(new Error('清空本地文件失败，请重试'));
 });}finally{db.close();}
}
export async function validateMedia(file:File):Promise<void>{
  if(!file.size)throw new Error(`${file.name}：文件为空`);
  if(file.size>20*1024*1024)throw new Error(`${file.name}：文件不能超过 20 MB`);
  const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());
  const head=String.fromCharCode(...bytes);
  const extension=file.name.split('.').pop()?.toLowerCase();
  const valid=extension==='pdf'?head.startsWith('%PDF-'):
    extension==='png'?bytes[0]===137&&head.slice(1,4)==='PNG':
    extension==='jpg'||extension==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:false;
  if(!valid)throw new Error(`${file.name}：仅支持内容有效的 PDF、PNG、JPG 文件，请检查文件格式`);
}
