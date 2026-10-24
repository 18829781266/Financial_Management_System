import {mkdir,rm,cp,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
const run=(file,args)=>{const result=spawnSync(process.execPath,[file,...args],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);};
await rm('dist',{recursive:true,force:true});
run('node_modules/vue-tsc/bin/vue-tsc.js',['-b']);
run('node_modules/vite/bin/vite.js',['build']);
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
await build({entryPoints:['worker/index.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/server/index.js'});
const manifest=JSON.parse(await readFile('.openai/hosting.json','utf8'));
await writeFile('dist/.openai/hosting.json',JSON.stringify(manifest,null,2)+'\n');
// Sites 官方部署契约：托管迁移从 dist/.openai/drizzle 读取。
await cp('drizzle','dist/.openai/drizzle',{recursive:true});
const config={name:'langchao-archive-cloud',main:'index.js',compatibility_date:'2025-11-01',assets:{directory:'../client',binding:'ASSETS',not_found_handling:'single-page-application',run_worker_first:['/api/*']},d1_databases:[{binding:'DB',database_name:'langchao-accounts',database_id:'local-auth-db',migrations_dir:'../.openai/drizzle'}]};
await writeFile('dist/server/wrangler.json',JSON.stringify(config,null,2)+'\n');
console.log('Built Worker, Vue assets and account schema.');
