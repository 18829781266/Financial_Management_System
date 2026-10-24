#!/usr/bin/env node
/** 从已构建的资源生成独立服务器安装包；只打包白名单，不包含数据库、凭据及用户原件。 */
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || join(root, 'releases'));
const temporary = await mkdtemp(join(tmpdir(), 'huitong-package-'));
const stage = join(temporary, 'huitong-server');
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('无法确认源码版本，打包已停止');
  return result.stdout.trim();
}
async function copyFile(path) {
  const source = join(root, path);
  const metadata = await stat(source);
  if (!metadata.isFile()) throw new Error(`打包文件不存在：${path}`);
  await mkdir(dirname(join(stage, path)), { recursive: true });
  await cp(source, join(stage, path));
}
async function walk(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.name.startsWith('.')) throw new Error(`不允许隐藏文件进入服务器安装包：${item.name}`);
    const path = join(directory, item.name);
    if (item.isDirectory()) files.push(...await walk(path));
    else if (item.isFile()) files.push(path);
    else throw new Error(`不允许链接或特殊文件进入服务器安装包：${path}`);
  }
  return files.sort();
}
try {
  await mkdir(stage);
  for (const path of ['deploy/server.mjs', 'deploy/sqlite-d1.mjs', 'deploy/install.sh', 'deploy/README.md', 'frontend/package.json', 'frontend/worker/auth.js']) await copyFile(path);
  for (const directory of ['frontend/drizzle', 'frontend/dist/client', 'deploy/systemd', 'deploy/nginx']) {
    for (const file of await walk(join(root, directory))) await copyFile(relative(root, file));
  }
  const files = [];
  for (const file of await walk(stage)) {
    const content = await readFile(file);
    const path = relative(stage, file).replaceAll('\\', '/');
    if (/(^|\/)(?:\.env|\.dev\.vars|node_modules|uploads|\.wrangler)(?:\/|$)|\.(?:sqlite3?|db|log)$/i.test(path)) throw new Error(`发现运行时或私密文件：${path}`);
    files.push({ path, size: content.length, sha256: sha256(content), mode: path.endsWith('.sh') ? '0755' : '0644' });
  }
  const manifest = {
    schemaVersion: 1, name: '汇通云服务器', createdAt: new Date().toISOString(),
    sourceCommit: git('rev-parse', 'HEAD'), sourceDirty: Boolean(git('status', '--porcelain')),
    nodeVersion: '24.19.0', files,
  };
  await writeFile(join(stage, 'RELEASE.json'), JSON.stringify(manifest, null, 2) + '\n');
  await mkdir(output, { recursive: true });
  const archive = join(output, 'huitong-server.tar.gz');
  const result = spawnSync('tar', ['--sort=name', '--owner=0', '--group=0', '--numeric-owner', '-czf', archive, '-C', temporary, 'huitong-server'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('生成安装包失败');
  const digest = sha256(await readFile(archive));
  await writeFile(archive + '.sha256', `${digest}  huitong-server.tar.gz\n`);
  console.log(JSON.stringify({ archive, sha256: digest, files: files.length, bytes: (await stat(archive)).size, sourceCommit: manifest.sourceCommit, sourceDirty: manifest.sourceDirty }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
