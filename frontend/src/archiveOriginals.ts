export async function originalFingerprint(file:Blob):Promise<{sourceHash:string;sourceSize:number}> {
 if(!file.size)throw new Error('原始文件为空，无法归档');
 if(!globalThis.crypto?.subtle)throw new Error('当前环境无法校验原件摘要，请使用安全连接或 localhost');
 const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
 return {sourceHash:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''),sourceSize:file.size};
}
