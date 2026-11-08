import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
// 独立本地配置让 .dev.vars 始终留在忽略目录，绝不复制进发布包。
await mkdir('.sites-runtime',{recursive:true});
const config=JSON.parse(await readFile('dist/server/wrangler.json','utf8'));
config.main='../dist/server/index.js';config.assets.directory='../dist/client';
config.d1_databases.forEach(database=>{database.migrations_dir='../drizzle';});
await writeFile('.sites-runtime/wrangler.json',JSON.stringify(config,null,2)+'\n');
// 桌面内嵌 Electron 以 Node 模式运行时，让 Wrangler 的子进程沿用标准参数偏移。
await writeFile('.sites-runtime/electron-node-compat.cjs','process.defaultApp = true;\n');
const cli=process.argv.slice(2);
const migration=cli.includes('migrate');
const option=(name,fallback)=>{const index=cli.indexOf(name);return index>=0&&cli[index+1]&&!cli[index+1].startsWith('--')?cli[index+1]:fallback;};
const host=option('--host',process.env.HOST||'127.0.0.1');
const port=option('--port',process.env.PORT||'5175');
const localProtocol=option('--local-protocol',process.env.LOCAL_PROTOCOL||'http');
if(!['http','https'].includes(localProtocol))throw new Error('--local-protocol 仅支持 http 或 https');
const args=migration?['d1','migrations','apply','DB','--local']:['dev','--local','--ip',host,'--port',port,'--local-protocol',localProtocol];
args.push('--config','.sites-runtime/wrangler.json','--persist-to','.wrangler/state');
const child=spawn(process.execPath,['--require','./.sites-runtime/electron-node-compat.cjs','node_modules/wrangler/bin/wrangler.js',...args],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
