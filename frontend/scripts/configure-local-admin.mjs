import {pbkdf2Sync,randomBytes} from 'node:crypto';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';

// 仅供首次初始化本地账号；口令不进入命令参数、源码或终端输出。
const destination=new URL('../.sites-runtime/.dev.vars',import.meta.url);
try{await access(destination);console.error('本地管理员摘要已配置；保留现有配置。');process.exit(1);}catch(error){if(error?.code!=='ENOENT')throw error;}
if(!process.stdin.isTTY){console.error('请在交互式终端运行，输入不会回显。');process.exit(1);}
let muted=false;
const output=new Writable({write(chunk,encoding,callback){if(!muted)process.stdout.write(chunk,encoding);callback();}});
const input=createInterface({input:process.stdin,output,terminal:true});
const question=prompt=>new Promise(resolve=>{process.stdout.write(prompt);muted=true;input.question('',answer=>{muted=false;process.stdout.write('\n');resolve(answer);});});
input.on('SIGINT',()=>{input.close();process.stdout.write('\n');process.exit(130);});
try{
 const password=await question('设置本地超级管理员密码（6–128位）：');
 if(password.length<6||password.length>128)throw new Error('密码长度须为6–128位。');
 const confirmation=await question('再次输入密码：');
 if(password!==confirmation)throw new Error('两次密码不一致，未保存。');
 const salt=randomBytes(16);
 const encoded=`pbkdf2-sha256$100000$${salt.toString('hex')}$${pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex')}`;
 await mkdir(new URL('../.sites-runtime/',import.meta.url),{recursive:true});
 await writeFile(destination,`ADMIN_PASSWORD_HASH=${encoded}\n`,{mode:0o600,flag:'wx'});
 console.log(`已设置本地管理员 admin（赵会计），摘要保存在忽略的 ${fileURLToPath(destination)}。`);
 console.log('仅用于首次初始化；已有数据库中的账号密码不会被此脚本重置。');
}catch(error){console.error(error instanceof Error?error.message:'配置失败');process.exitCode=1;}
finally{input.close();}
