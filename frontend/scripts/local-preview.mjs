import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
// 独立本地配置让 .dev.vars 始终留在忽略目录，绝不复制进发布包。
await mkdir('.sites-runtime',{recursive:true});
const config=JSON.parse(await readFile('dist/server/wrangler.json','utf8'));
config.main='../dist/server/index.js';config.assets.directory='../dist/client';
config.d1_databases.forEach(database=>{database.migrations_dir='../drizzle';});
await writeFile('.sites-runtime/wrangler.json',JSON.stringify(config,null,2)+'\n');
const migration=process.argv[2]==='migrate';
const args=migration?['d1','migrations','apply','DB','--local']:['dev','--local','--ip','127.0.0.1','--port',process.env.PORT||'5175'];
args.push('--config','.sites-runtime/wrangler.json','--persist-to','.wrangler/state');
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
