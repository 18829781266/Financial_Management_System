import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleAuth, hashPassword, verifyPassword } from '../worker/auth.js';

/** D1 的最小调用适配层，SQL 在真实 SQLite 中执行，避免模拟 SQL 掩盖约束或事务错误。 */
class LocalD1 {
  sqlite = new DatabaseSync(':memory:');
  constructor() { this.sqlite.exec(readFileSync(new URL('../drizzle/0000_auth.sql', import.meta.url), 'utf8')); }
  prepare(sql: string) {
    const sqlite = this.sqlite;
    let values: (string | number)[] = [];
    const statement = {
      bind(...args: (string | number)[]) { values = args; return statement; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...values) }; },
      async run() { return { success: true, meta: sqlite.prepare(sql).run(...values) }; },
    };
    return statement;
  }
  async batch(statements: { run(): Promise<unknown> }[]) {
    this.sqlite.exec('BEGIN');
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run());
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
const ORIGIN = 'https://archive.test';
const ADMIN_TEST_PASSWORD = 'SyntheticAdmin-321';
const USER_TEST_PASSWORD = 'SyntheticUser-987';
let adminHash: string;
let DB: LocalD1;
let env: { DB: LocalD1; ADMIN_PASSWORD_HASH: string };
function request(path: string, body?: unknown, cookie = '', headers: Record<string, string> = {}) {
  return new Request(ORIGIN + path, { method: body === undefined ? 'GET' : 'POST', headers: {
    ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: ORIGIN }),
    ...(cookie ? { Cookie: cookie } : {}), ...headers,
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function call(path: string, body?: unknown, cookie = '', headers: Record<string, string> = {}) {
  const response = await handleAuth(request(path, body, cookie, headers), env);
  expect(response).toBeInstanceOf(Response);
  return response!;
}
function cookie(response: Response) { return response.headers.get('Set-Cookie')!.split(';')[0]; }
async function login(username = 'admin', password = ADMIN_TEST_PASSWORD) {
  return call('/api/v1/auth/login', { username, password });
}
async function adminCookie() { const response = await login(); expect(response.status).toBe(200); return cookie(response); }
async function createNormal(admin: string, extra = {}) {
  return call('/api/v1/users', { username: 'staff01', displayName: '普通会计', password: USER_TEST_PASSWORD, ...extra }, admin);
}
async function removeUser(userId: string, session = '', headers: Record<string, string> = {}, body: unknown = {}) {
  return handleAuth(new Request(ORIGIN + '/api/v1/users/' + userId, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(session ? { Cookie: session } : {}), ...headers },
    body: JSON.stringify(body),
  }), env);
}

beforeAll(async () => { adminHash = await hashPassword(ADMIN_TEST_PASSWORD); });
beforeEach(() => { DB = new LocalD1(); env = { DB, ADMIN_PASSWORD_HASH: adminHash }; });
afterEach(() => { vi.restoreAllMocks(); DB.sqlite.close(); });

describe('密码派生与信息保护', () => {
  it('随机盐使同一密码生成不同摘要且可校验，错误密码失败', async () => {
    const one = await hashPassword(USER_TEST_PASSWORD), two = await hashPassword(USER_TEST_PASSWORD);
    expect(one).toMatch(/^pbkdf2-sha256\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(one).not.toEqual(two);
    expect(one).not.toContain(USER_TEST_PASSWORD);
    expect(await verifyPassword(USER_TEST_PASSWORD, one)).toBe(true);
    expect(await verifyPassword('incorrect-password', one)).toBe(false);
    expect(await verifyPassword(USER_TEST_PASSWORD, 'invalid')).toBe(false);
  });
  it('首次正确登录幂等创建赵会计超级管理员，不返回密码摘要', async () => {
    const response = await login();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.user).toMatchObject({ username: 'admin', displayName: '赵会计', role: 'SUPER_ADMIN' });
    expect(Object.keys(data.user).sort()).toEqual(['createdAt', 'displayName', 'id', 'role', 'username']);
    await login();
    expect(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM auth_users').get()!.count).toBe(1);
    expect(DB.sqlite.prepare('SELECT password_hash FROM auth_users').get()!.password_hash).toBe(adminHash);
  });
  it('未知账号和错误密码返回一致错误且不泄露服务端字段', async () => {
    const unknown = await login('unknown-user', 'wrong-password'), wrong = await login('admin', 'wrong-password');
    expect(unknown.status).toBe(401); expect(wrong.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrong.json());
  });
  it('后台异常只返回通用消息', async () => {
    const bad = await handleAuth(request('/api/v1/auth/me'), {});
    expect(bad!.status).toBe(503);
    expect(await bad!.text()).not.toContain('SQL');
  });
});

describe('服务端会话与超级管理员权限', () => {
  it('未登录不能读取用户或添加用户，不能读取当前用户', async () => {
    for (const [path, body] of [['/api/v1/auth/me', undefined], ['/api/v1/users', undefined], ['/api/v1/users', {}]] as const) {
      expect((await call(path, body)).status).toBe(401);
    }
    expect(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM auth_users').get()!.count).toBe(0);
  });
  it('管理员创建的普通用户能登录，但无法读取用户列表或创建账号', async () => {
    const admin = await adminCookie();
    const created = await createNormal(admin);
    expect(created.status).toBe(201);
    const user = (await created.json()).user;
    expect(user).toMatchObject({ username: 'staff01', displayName: '普通会计', role: 'USER' });
    const response = await login('staff01', USER_TEST_PASSWORD);
    expect(response.status).toBe(200);
    const staff = cookie(response);
    expect((await (await call('/api/v1/auth/me', undefined, staff)).json()).user.role).toBe('USER');
    expect((await call('/api/v1/users', undefined, staff)).status).toBe(403);
    expect((await createNormal(staff, { username: 'forbidden' })).status).toBe(403);
    expect(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM auth_users').get()!.count).toBe(2);
  });
  it('安全Cookie不暴露数据库摘要，数据库只存令牌摘要', async () => {
    const response = await login(), header = response.headers.get('Set-Cookie')!;
    expect(header).toContain('__Host-langchao_session=');
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=43200']) expect(header).toContain(attribute);
    const token = cookie(response).split('=')[1];
    const row = DB.sqlite.prepare('SELECT token_hash FROM auth_sessions').get()!;
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('退出登录立即删除会话，重放旧Cookie失败', async () => {
    const admin = await adminCookie();
    const response = await call('/api/v1/auth/logout', {}, admin);
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect((await call('/api/v1/auth/me', undefined, admin)).status).toBe(401);
    expect(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get()!.count).toBe(0);
  });
  it('会话12小时后失效并从数据库移除', async () => {
    const admin = await adminCookie();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 12 * 60 * 60 * 1000 + 1);
    expect((await call('/api/v1/auth/me', undefined, admin)).status).toBe(401);
    expect(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get()!.count).toBe(0);
  });
  it('伪造Cookie或本地角色不能授权，实时角色降级立即生效', async () => {
    const admin = await adminCookie();
    expect((await call('/api/v1/users', undefined, '__Host-langchao_session=SUPER_ADMIN')).status).toBe(401);
    DB.sqlite.prepare("UPDATE auth_users SET role='USER' WHERE username='admin'").run();
    expect((await call('/api/v1/users', undefined, admin, { 'X-Role': 'SUPER_ADMIN' })).status).toBe(403);
    expect((await (await call('/api/v1/auth/me', undefined, admin)).json()).user.role).toBe('USER');
  });
  it('重新登录轮换当前会话，旧会话不能重放', async () => {
    const first = await adminCookie();
    const second = await call('/api/v1/auth/login', { username: 'admin', password: ADMIN_TEST_PASSWORD }, first);
    expect(second.status).toBe(200); expect(cookie(second)).not.toBe(first);
    expect((await call('/api/v1/auth/me', undefined, first)).status).toBe(401);
    expect((await call('/api/v1/auth/me', undefined, cookie(second))).status).toBe(200);
  });
});

describe('账号创建与请求约束', () => {
  it('角色升级字段被拒绝，管理员也只能创建普通用户', async () => {
    const admin = await adminCookie();
    for (const extra of [{ role: 'SUPER_ADMIN' }, { role: 'USER' }, { isAdmin: true }, { permissions: ['manage-users'] }]) {
      expect((await createNormal(admin, extra)).status).toBe(403);
    }
    expect(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM auth_users').get()!.count).toBe(1);
  });
  it('账号忽略大小写并使用唯一约束处理重复与并发', async () => {
    const admin = await adminCookie();
    const responses = await Promise.all([createNormal(admin), createNormal(admin, { username: 'STAFF01' })]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect((await login('StAfF01', USER_TEST_PASSWORD)).status).toBe(200);
    expect(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM auth_users').get()!.count).toBe(2);
  });
  it('姓名、账号和密码边界验证，密码空格不被截掉', async () => {
    const admin = await adminCookie();
    for (const extra of [{ username: 'ab' }, { username: '非法账号' }, { username: 'x'.repeat(33) }, { displayName: '' }, { displayName: 'x'.repeat(41) }, { password: '12345' }, { password: 'x'.repeat(129) }]) {
      expect((await createNormal(admin, extra)).status).toBe(400);
    }
    const password = ' with-spaces ';
    expect((await createNormal(admin, { password })).status).toBe(201);
    expect((await login('staff01', password)).status).toBe(200);
    expect((await login('staff01', password.trim())).status).toBe(401);
  });
  it('管理员能看真实列表，列表不返回密码或会话秘密', async () => {
    const admin = await adminCookie(); await createNormal(admin);
    const response = await call('/api/v1/users', undefined, admin), data = await response.json();
    expect(response.status).toBe(200); expect(data.users).toHaveLength(2);
    expect(data.users[0].username).toBe('staff01');
    for (const user of data.users) expect(Object.keys(user).sort()).toEqual(['createdAt', 'displayName', 'id', 'role', 'username']);
  });
  it('跨站来源和缺少Origin被拒绝，即使携带有效管理员Cookie', async () => {
    const admin = await adminCookie();
    expect((await createNormal(admin, {},)).status).toBe(201);
    expect((await call('/api/v1/users', { username: 'bad-site', displayName: '外站', password: USER_TEST_PASSWORD }, admin, { Origin: 'https://other.test' })).status).toBe(403);
    const missing = request('/api/v1/auth/logout', {}, admin); missing.headers.delete('Origin');
    expect((await handleAuth(missing, env))!.status).toBe(403);
    expect((await call('/api/v1/auth/logout', {}, admin, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
  });
  it('拒绝错误方法、非JSON、数组及过大请求，不提供注册接口', async () => {
    expect((await call('/api/v1/auth/login')).status).toBe(405);
    expect((await call('/api/v1/auth/register', {})).status).toBe(404);
    expect((await call('/api/v1/auth/login', {}, '', { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await call('/api/v1/auth/login', [])).status).toBe(400);
    expect((await call('/api/v1/auth/login', { username: 'x'.repeat(5000) })).status).toBe(413);
    expect(await handleAuth(request('/unrelated'), env)).toBeNull();
  });
  it('失败次数持久化，超过5次临时限制，时间窗结束可正常登录', async () => {
    for (let i = 0; i < 5; i++) expect((await login('admin', 'wrong-password')).status).toBe(401);
    const restartedEnv = { DB, ADMIN_PASSWORD_HASH: adminHash };
    const blocked = await handleAuth(request('/api/v1/auth/login', { username: 'admin', password: ADMIN_TEST_PASSWORD }), restartedEnv);
    expect(blocked!.status).toBe(429); expect(Number(blocked!.headers.get('Retry-After'))).toBeGreaterThan(0);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60 * 1000);
    expect((await login()).status).toBe(200);
  });
});

describe('仅超级管理员删除普通用户', () => {
  it('删除账号同时撤销该账号全部会话，旧会话及密码无法再登录', async () => {
    const admin = await adminCookie();
    const user = (await (await createNormal(admin)).json()).user;
    const first = cookie(await login('staff01', USER_TEST_PASSWORD));
    const second = cookie(await login('staff01', USER_TEST_PASSWORD));
    expect(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id=?').get(user.id)!.count).toBe(2);
    const response = await removeUser(user.id, admin);
    expect(response!.status).toBe(200);
    expect(await response!.json()).toMatchObject({ id: user.id });
    expect(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id=?').get(user.id)!.count).toBe(0);
    expect(DB.sqlite.prepare('SELECT id FROM auth_users WHERE id=?').get(user.id)).toBeUndefined();
    for (const session of [first, second]) expect((await call('/api/v1/auth/me', undefined, session)).status).toBe(401);
    expect((await login('staff01', USER_TEST_PASSWORD)).status).toBe(401);
    expect((await call('/api/v1/auth/me', undefined, admin)).status).toBe(200);
  });
  it('匿名及普通用户不能删除账号，伪造管理员字段也不会授予权限', async () => {
    const admin = await adminCookie();
    const user = (await (await createNormal(admin)).json()).user;
    const staff = cookie(await login('staff01', USER_TEST_PASSWORD));
    expect((await removeUser(user.id))!.status).toBe(401);
    expect((await removeUser(user.id, staff))!.status).toBe(403);
    expect((await removeUser(user.id, staff, { 'X-Role': 'SUPER_ADMIN' }, { role: 'SUPER_ADMIN' }))!.status).toBe(403);
    expect(DB.sqlite.prepare('SELECT id FROM auth_users WHERE id=?').get(user.id)).toBeTruthy();
    expect((await call('/api/v1/auth/me', undefined, staff)).status).toBe(200);
  });
  it('超级管理员也不能删除自身或其他超级管理员，会话均保留', async () => {
    const admin = await adminCookie();
    const own = (await (await call('/api/v1/auth/me', undefined, admin)).json()).user;
    const other = (await (await createNormal(admin)).json()).user;
    const otherSession = cookie(await login('staff01', USER_TEST_PASSWORD));
    DB.sqlite.prepare("UPDATE auth_users SET role='SUPER_ADMIN' WHERE id=?").run(other.id);
    for (const id of [own.id, other.id]) expect((await removeUser(id, admin))!.status).toBe(403);
    expect((await call('/api/v1/auth/me', undefined, admin)).status).toBe(200);
    expect((await call('/api/v1/auth/me', undefined, otherSession)).status).toBe(200);
    expect(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM auth_users').get()!.count).toBe(2);
  });
  it('目标不存在或已被删除时返回404，不报告虚假的删除成功', async () => {
    const admin = await adminCookie();
    expect((await removeUser(crypto.randomUUID(), admin))!.status).toBe(404);
    const user = (await (await createNormal(admin)).json()).user;
    expect((await removeUser(user.id, admin))!.status).toBe(200);
    expect((await removeUser(user.id, admin))!.status).toBe(404);
  });
  it('删除要求同源JSON请求，缺少Origin、跨站及错误类型均不能删除', async () => {
    const admin = await adminCookie();
    const user = (await (await createNormal(admin)).json()).user;
    expect((await removeUser(user.id, admin, { Origin: '' }))!.status).toBe(403);
    expect((await removeUser(user.id, admin, { Origin: 'https://other.test' }))!.status).toBe(403);
    expect((await removeUser(user.id, admin, { 'Sec-Fetch-Site': 'cross-site' }))!.status).toBe(403);
    expect((await removeUser(user.id, admin, { 'Content-Type': 'text/plain' }))!.status).toBe(415);
    expect((await removeUser(user.id, admin, {}, []))!.status).toBe(400);
    expect(DB.sqlite.prepare('SELECT id FROM auth_users WHERE id=?').get(user.id)).toBeTruthy();
  });
  it('目标标识需要有效UUID，用户详情路径只接受DELETE', async () => {
    const admin = await adminCookie();
    for (const value of ['invalid-user', 'admin', '%27%20OR%201%3D1', 'x'.repeat(200)]) {
      expect((await removeUser(value, admin))!.status).toBe(400);
    }
    const detail = await call('/api/v1/users/' + crypto.randomUUID(), undefined, admin);
    expect(detail.status).toBe(405);
    expect(detail.headers.get('Allow')).toBe('DELETE');
  });
  it('角色在查询后提升时不会误删管理员或撤销其现有会话', async () => {
    const admin = await adminCookie();
    const user = (await (await createNormal(admin)).json()).user;
    const staff = cookie(await login('staff01', USER_TEST_PASSWORD));
    const prepare = DB.prepare.bind(DB);
    let promoted = false;
    vi.spyOn(DB, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      if (sql === 'SELECT id, role FROM auth_users WHERE id = ?' && !promoted) {
        const first = statement.first;
        statement.first = async () => {
          const target = await first();
          if (!promoted) { DB.sqlite.prepare("UPDATE auth_users SET role='SUPER_ADMIN' WHERE id=?").run(user.id); promoted = true; }
          return target;
        };
      }
      return statement;
    });
    expect((await removeUser(user.id, admin))!.status).toBe(403);
    expect(DB.sqlite.prepare('SELECT role FROM auth_users WHERE id=?').get(user.id)!.role).toBe('SUPER_ADMIN');
    expect(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id=?').get(user.id)!.count).toBe(1);
    expect((await call('/api/v1/auth/me', undefined, staff)).status).toBe(200);
  });
  it('删除失败时事务回滚，不会留下账号仍在但全部会话已误删的半完成状态', async () => {
    const admin = await adminCookie();
    const user = (await (await createNormal(admin)).json()).user;
    const staff = cookie(await login('staff01', USER_TEST_PASSWORD));
    DB.sqlite.exec("CREATE TRIGGER synthetic_delete_failure BEFORE DELETE ON auth_users WHEN OLD.role='USER' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await removeUser(user.id, admin))!.status).toBe(503);
    expect(DB.sqlite.prepare('SELECT id FROM auth_users WHERE id=?').get(user.id)).toBeTruthy();
    expect(DB.sqlite.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id=?').get(user.id)!.count).toBe(1);
    expect((await call('/api/v1/auth/me', undefined, staff)).status).toBe(200);
  });
});
