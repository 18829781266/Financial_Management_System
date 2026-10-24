import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApplication } from './server.mjs';
import { SqliteD1 } from './sqlite-d1.mjs';
import { hashPassword } from '../frontend/worker/auth.js';

const ORIGIN = 'https://archive.example.test';
const ADMIN_PASSWORD = 'Synthetic-admin-for-runtime-61';
const USER_PASSWORD = 'Synthetic-user-for-runtime-74';
const passwordHash = await hashPassword(ADMIN_PASSWORD);

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'huitong-runtime-'));
  const assets = join(directory, 'public'), migrations = join(directory, 'migrations');
  await mkdir(assets); await mkdir(migrations); await mkdir(join(assets, 'assets'));
  await writeFile(join(assets, 'index.html'), '<!doctype html><title>汇通云</title>');
  await writeFile(join(assets, 'assets/app-abc123.js'), 'window.huitong = true;');
  await copyFile(new URL('../frontend/drizzle/0000_auth.sql', import.meta.url), join(migrations, '0000_auth.sql'));
  const options = { publicOrigin: ORIGIN, dataDirectory: join(directory, 'data'), assetDirectory: assets, migrationsDirectory: migrations, adminPasswordHash: passwordHash };
  let app = await createApplication(options);
  await app.listen(0);
  return {
    directory, assets, migrations, options,
    get app() { return app; },
    async restart() { await app.close(); app = await createApplication(options); await app.listen(0); },
    async cleanup() { await app.close(); await rm(directory, { recursive: true, force: true }); },
    call(path, { method = 'GET', body, headers = {} } = {}) {
      return new Promise((accept, reject) => {
        const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
        const request = httpRequest({ host: '127.0.0.1', port: app.server.address().port, path, method, headers: {
          Host: new URL(ORIGIN).host, 'X-Forwarded-Proto': 'https', 'X-Real-IP': '192.0.2.20',
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Origin: ORIGIN }), ...headers,
        } }, response => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => accept({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString(), json() { return JSON.parse(this.text); } }));
        });
        request.on('error', reject); request.end(payload);
      });
    },
  };
}
function session(response) { return response.headers['set-cookie'][0].split(';')[0]; }
async function login(f, username = 'admin', password = ADMIN_PASSWORD) { return f.call('/api/v1/auth/login', { method: 'POST', body: { username, password } }); }

test('真实 HTTP + SQLite 保留登录、用户权限、删除会话和重启持久性', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call('/api/v1/auth/me')).status, 401);
    const signedIn = await login(f);
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.json().user.displayName, '赵会计');
    assert.match(signedIn.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Strict/);
    const admin = session(signedIn);
    const created = await f.call('/api/v1/users', { method: 'POST', headers: { Cookie: admin }, body: { username: 'runtime-staff', displayName: '普通用户', password: USER_PASSWORD } });
    assert.equal(created.status, 201);
    const userId = created.json().user.id;
    const userResponse = await login(f, 'runtime-staff', USER_PASSWORD);
    assert.equal(userResponse.status, 200);
    const user = session(userResponse);
    assert.equal((await f.call('/api/v1/users', { headers: { Cookie: user } })).status, 403);
    assert.equal((await f.call('/api/v1/users', { method: 'POST', headers: { Cookie: user }, body: { username: 'forbidden', displayName: '越权', password: USER_PASSWORD } })).status, 403);
    await f.restart();
    assert.equal((await f.call('/api/v1/auth/me', { headers: { Cookie: admin } })).status, 200);
    assert.equal((await login(f, 'runtime-staff', USER_PASSWORD)).status, 200);
    const removed = await f.call('/api/v1/users/' + userId, { method: 'DELETE', headers: { Cookie: admin }, body: {} });
    assert.equal(removed.status, 200);
    assert.equal((await f.call('/api/v1/auth/me', { headers: { Cookie: user } })).status, 401);
    assert.equal((await login(f, 'runtime-staff', USER_PASSWORD)).status, 401);
    assert.equal((await f.call('/api/v1/auth/logout', { method: 'POST', headers: { Cookie: admin }, body: {} })).status, 200);
    assert.equal((await f.call('/api/v1/auth/me', { headers: { Cookie: admin } })).status, 401);
  } finally { await f.cleanup(); }
});

test('拒绝伪造代理来源、跨站请求和超长请求，限流只用代理覆盖的真实 IP', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call('/', { headers: { Host: 'evil.example.test' } })).status, 400);
    assert.equal((await f.call('/', { headers: { 'X-Forwarded-Proto': 'http' } })).status, 400);
    assert.equal((await f.call('/api/v1/auth/login', { method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD }, headers: { Origin: 'https://evil.example.test' } })).status, 403);
    assert.equal((await f.call('/api/v1/auth/login', { method: 'POST', body: 'x'.repeat(4097) })).status, 413);
    const failed = await f.call('/api/v1/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong-password' }, headers: { 'CF-Connecting-IP': '198.51.100.90', 'X-Forwarded-For': '198.51.100.90' } });
    assert.equal(failed.status, 401);
    const proxyIpHash = createHash('sha256').update('192.0.2.20').digest('hex');
    const forgedIpHash = createHash('sha256').update('198.51.100.90').digest('hex');
    assert.equal(f.app.database.sqlite.prepare('SELECT failure_count FROM auth_login_attempts WHERE attempt_key = ?').get('ip:' + proxyIpHash).failure_count, 1);
    assert.equal(f.app.database.sqlite.prepare('SELECT failure_count FROM auth_login_attempts WHERE attempt_key = ?').get('ip:' + forgedIpHash), undefined);
  } finally { await f.cleanup(); }
});

test('静态文件支持 SPA/HEAD，拒绝目录穿越、隐藏文件和越界软链接', async () => {
  const f = await fixture();
  try {
    const index = await f.call('/archives/2026-06');
    assert.equal(index.status, 200); assert.match(index.text, /汇通云/); assert.equal(index.headers['cache-control'], 'no-cache');
    const js = await f.call('/assets/app-abc123.js');
    assert.equal(js.status, 200); assert.match(js.headers['content-type'], /javascript/); assert.match(js.headers['cache-control'], /immutable/);
    assert.equal((await f.call('/assets/missing.js')).status, 404);
    assert.equal((await f.call('/assets/app-abc123.js', { method: 'HEAD' })).text, '');
    for (const path of ['/../secret', '/%2e%2e/secret', '/assets%2fsecret', '/.env', '/assets/../secret', '/%00']) assert.equal((await f.call(path)).status, 400, path);
    await writeFile(join(f.directory, 'private.txt'), 'private');
    await symlink(join(f.directory, 'private.txt'), join(f.assets, 'leak.txt'));
    assert.equal((await f.call('/leak.txt')).status, 404);
    assert.equal((await f.call('/healthz')).json().status, 'ok');
    assert.equal((await f.call('/api/not-found')).status, 404);
  } finally { await f.cleanup(); }
});

test('SQLite 批量失败整体回滚，迁移幂等并拒绝已应用迁移篡改', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.app.database.batch([
      f.app.database.prepare('INSERT INTO auth_login_attempts VALUES (?, ?, ?, ?)').bind('rollback', 1, 0, 0),
      f.app.database.prepare('INSERT INTO table_does_not_exist VALUES (?)').bind(1),
    ]));
    assert.equal(f.app.database.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_login_attempts WHERE attempt_key = ?').get('rollback').n, 0);
    await f.restart();
    assert.equal(f.app.database.sqlite.prepare('SELECT COUNT(*) AS n FROM _huitong_migrations').get().n, 1);
    const filename = join(f.migrations, '0000_auth.sql');
    await writeFile(filename, (await readFile(filename, 'utf8')) + '\n-- modified');
    assert.throws(() => new SqliteD1(join(f.directory, 'data/accounts.sqlite'), f.migrations), /modified/);
    await writeFile(filename, await readFile(new URL('../frontend/drizzle/0000_auth.sql', import.meta.url), 'utf8'));
    await writeFile(join(f.migrations, '0001_broken.sql'), 'CREATE TABLE should_rollback (id INTEGER); INSERT INTO missing_table VALUES (1);');
    assert.throws(() => new SqliteD1(join(f.directory, 'data/accounts.sqlite'), f.migrations));
    assert.equal(f.app.database.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'should_rollback'").get(), undefined);
  } finally { await f.cleanup(); }
});

test('生产启动强制 HTTPS origin 和回环监听，禁止不安全兼容开关', async () => {
  await assert.rejects(createApplication({ publicOrigin: 'http://archive.example.test' }), /HTTPS/);
  await assert.rejects(createApplication({ publicOrigin: 'https://archive.example.test/path' }), /HTTPS/);
  await assert.rejects(createApplication({ publicOrigin: ORIGIN, host: '0.0.0.0' }), /loopback/);
});
