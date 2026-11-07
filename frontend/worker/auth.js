/**
 * 应用账号认证。Sites 原有访问边界保留，本模块在其内部执行账号及角色校验。
 * 不把密码、角色或可登录令牌放进 localStorage，也不信任前端传入的权限。
 */
const SESSION_COOKIE = '__Host-langchao_session';
const SESSION_SECONDS = 12 * 60 * 60;
const PASSWORD_ITERATIONS = 100000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_BODY_BYTES = 4096;
const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(status, message, headers = {}) { super(message); this.status = status; this.headers = headers; }
}
function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...headers,
  } });
}
function publicUser(row) {
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role, createdAt: row.created_at };
}
function hex(bytes) { return [...bytes].map(value => value.toString(16).padStart(2, '0')).join(''); }
function unhex(value) { return Uint8Array.from(value.match(/../g) ?? [], pair => Number.parseInt(pair, 16)); }
function randomHex(length) { return hex(crypto.getRandomValues(new Uint8Array(length))); }
async function digest(value) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
function passwordParts(value) {
  if (typeof value !== 'string') return null;
  const match = /^pbkdf2-sha256\$100000\$([0-9a-f]{32})\$([0-9a-f]{64})$/.exec(value);
  return match ? { salt: unhex(match[1]), expected: unhex(match[2]) } : null;
}
async function derivePassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS }, key, 256));
}
/** 每个密码使用独立的随机盐；数据库不保存或返回原始密码。 */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${hex(salt)}$${hex(await derivePassword(password, salt))}`;
}
export async function verifyPassword(password, encoded) {
  const parts = passwordParts(encoded);
  if (!parts) return false;
  const actual = await derivePassword(password, parts.salt);
  let difference = actual.length ^ parts.expected.length;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ parts.expected[i];
  return difference === 0;
}
function usernameValue(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{3,32}$/.test(value.trim())) throw new HttpError(400, '账号须为 3–32 位字母、数字、下划线、点或短横线');
  return value.trim().toLowerCase();
}
function passwordValue(value) {
  if (typeof value !== 'string' || value.length < 6 || value.length > 128) throw new HttpError(400, '密码须为 6–128 个字符');
  return value; // 密码不 trim；空格属于密码本身，避免前后端校验不一致。
}
function displayNameValue(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 40 || /[\u0000-\u001f\u007f]/.test(value)) throw new HttpError(400, '姓名须为 1–40 个有效字符');
  return value.trim();
}
function setCookie(token, maxAge = SESSION_SECONDS) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}
function cookieToken(request) {
  const values = (request.headers.get('Cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(SESSION_COOKIE + '='));
  if (values.length !== 1) return '';
  const token = values[0].slice(SESSION_COOKIE.length + 1);
  return /^[0-9a-f]{64}$/.test(token) ? token : '';
}
/** 所有写接口同时检查来源和 JSON 类型，避免跨站表单及携带 Cookie 的跨站请求。 */
async function readBody(request) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new HttpError(403, '请求来源无效，请从本站重新操作');
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new HttpError(415, '请使用 JSON 格式提交');
  const declaredLength = Number(request.headers.get('Content-Length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) throw new HttpError(413, '提交内容过大');
  const reader = request.body?.getReader();
  if (!reader) return {};
  let bytes = 0; const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new HttpError(413, '提交内容过大'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  try {
    const body = JSON.parse(new TextDecoder().decode(joined) || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid object');
    return body;
  } catch { throw new HttpError(400, '提交内容不是有效的 JSON 对象'); }
}
async function ensureAdministrator(env, now) {
  const existing = await env.DB.prepare('SELECT id, role FROM auth_users WHERE username = ?').bind('admin').first();
  if (existing) {
    if (existing.role !== 'SUPER_ADMIN') throw new HttpError(503, '管理员账号配置异常，请联系网站管理员');
    return;
  }
  if (!passwordParts(env.ADMIN_PASSWORD_HASH)) throw new HttpError(503, '管理员账号尚未配置，请稍后重试');
  await env.DB.prepare('INSERT OR IGNORE INTO auth_users (id, username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), 'admin', '赵会计', env.ADMIN_PASSWORD_HASH, 'SUPER_ADMIN', new Date(now).toISOString()).run();
}
async function authenticatedUser(request, env, now) {
  const token = cookieToken(request);
  if (!token) return null;
  const tokenHash = await digest(token);
  // 角色来自用户表的实时查询，而不是 Cookie、请求体或客户端缓存。
  const row = await env.DB.prepare('SELECT u.id, u.username, u.display_name, u.role, u.created_at, s.expires_at FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id WHERE s.token_hash = ?').bind(tokenHash).first();
  if (!row) return null;
  if (row.expires_at <= now) {
    await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  return row;
}
async function requireAdministrator(request, env, now) {
  const user = await authenticatedUser(request, env, now);
  if (!user) throw new HttpError(401, '请先登录', { 'Set-Cookie': setCookie('', 0) });
  if (user.role !== 'SUPER_ADMIN') throw new HttpError(403, '只有超级管理员可以管理用户');
  return user;
}
async function loginKeys(request, username) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  return [{ key: 'account:' + await digest(username), limit: 5 }, { key: 'ip:' + await digest(ip), limit: 20 }];
}
async function checkLoginLimit(env, keys, now) {
  for (const { key } of keys) {
    const row = await env.DB.prepare('SELECT blocked_until FROM auth_login_attempts WHERE attempt_key = ?').bind(key).first();
    if (row?.blocked_until > now) throw new HttpError(429, '登录尝试过多，请稍后再试', { 'Retry-After': String(Math.ceil((row.blocked_until - now) / 1000)) });
  }
}
async function recordFailure(env, keys, now) {
  // SQLite 的 UPSERT 原子累加，多个 Worker 实例同时失败也不会丢失次数。
  await env.DB.batch(keys.map(({ key, limit }) => env.DB.prepare(`INSERT INTO auth_login_attempts (attempt_key, failure_count, window_start, blocked_until) VALUES (?, 1, ?, 0)
    ON CONFLICT(attempt_key) DO UPDATE SET
    failure_count = CASE WHEN window_start <= ? THEN 1 ELSE failure_count + 1 END,
    blocked_until = CASE WHEN window_start > ? AND failure_count + 1 >= ? THEN ? ELSE 0 END,
    window_start = CASE WHEN window_start <= ? THEN ? ELSE window_start END`)
    .bind(key, now, now - LOGIN_WINDOW_MS, now - LOGIN_WINDOW_MS, limit, now + LOGIN_WINDOW_MS, now - LOGIN_WINDOW_MS, now)));
}
async function login(request, env, now) {
  const body = await readBody(request);
  const username = usernameValue(body.username), password = passwordValue(body.password);
  const keys = await loginKeys(request, username);
  await checkLoginLimit(env, keys, now);
  await ensureAdministrator(env, now);
  const user = await env.DB.prepare('SELECT id, username, display_name, password_hash, role, created_at FROM auth_users WHERE username = ?').bind(username).first();
  // 不存在的账号仍执行相同的派生工作，不通过响应文案暴露账号是否存在。
  const passwordHash = user?.password_hash || env.ADMIN_PASSWORD_HASH;
  const valid = passwordParts(passwordHash) ? await verifyPassword(password, passwordHash) : await verifyPassword(password, 'pbkdf2-sha256$100000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000');
  if (!user || !valid) { await recordFailure(env, keys, now); throw new HttpError(401, '账号或密码错误'); }
  const token = randomHex(32), tokenHash = await digest(token);
  const previousToken = cookieToken(request);
  const statements = [
    env.DB.prepare('INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(tokenHash, user.id, now, now + SESSION_SECONDS * 1000),
    env.DB.prepare('DELETE FROM auth_login_attempts WHERE attempt_key = ?').bind(keys[0].key),
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM auth_login_attempts WHERE window_start < ? AND blocked_until <= ?').bind(now - 24 * 60 * 60 * 1000, now),
  ];
  if (previousToken) statements.push(env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await digest(previousToken)));
  await env.DB.batch(statements);
  return json({ user: publicUser(user) }, 200, { 'Set-Cookie': setCookie(token) });
}
async function logout(request, env) {
  await readBody(request);
  const token = cookieToken(request);
  if (token) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await digest(token)).run();
  return json({ message: '已退出登录' }, 200, { 'Set-Cookie': setCookie('', 0) });
}
async function createUser(request, env, now) {
  await requireAdministrator(request, env, now);
  const body = await readBody(request);
  if (body.role !== undefined || body.isAdmin !== undefined || body.permissions !== undefined) throw new HttpError(403, '新增账号只能是普通用户');
  const username = usernameValue(body.username), password = passwordValue(body.password), displayName = displayNameValue(body.displayName);
  if (username === 'admin') throw new HttpError(409, '该账号已存在，请更换账号');
  const passwordHash = await hashPassword(password);
  const user = { id: crypto.randomUUID(), username, display_name: displayName, role: 'USER', created_at: new Date(now).toISOString() };
  // UNIQUE 索引兜底处理并发创建；不依赖先查后写，避免竞态造成重复账号。
  try {
    await env.DB.prepare('INSERT INTO auth_users (id, username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(user.id, username, displayName, passwordHash, user.role, user.created_at).run();
  } catch (error) {
    if (/UNIQUE constraint failed: auth_users.username|auth_users_username_unique/i.test(String(error))) throw new HttpError(409, '该账号已存在，请更换账号');
    throw error;
  }
  return json({ user: publicUser(user) }, 201);
}
async function deleteUser(request, env, now, encodedId) {
  await requireAdministrator(request, env, now);
  await readBody(request);
  let userId;
  try { userId = decodeURIComponent(encodedId); }
  catch { throw new HttpError(400, '用户标识无效'); }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) throw new HttpError(400, '用户标识无效');
  const target = await env.DB.prepare('SELECT id, role FROM auth_users WHERE id = ?').bind(userId).first();
  if (!target) throw new HttpError(404, '用户不存在或已被删除');
  if (target.role !== 'USER') throw new HttpError(403, '不能删除超级管理员账号');
  // D1 batch 在同一事务中撤销全部会话并删除账号；任一步失败都会整体回滚。
  // 两个语句均以实时 USER 角色为条件，避免先查后删之间角色变更时误删管理员及其会话。
  const result = await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM auth_users WHERE id = ? AND role = 'USER')").bind(userId, userId),
    env.DB.prepare("DELETE FROM auth_users WHERE id = ? AND role = 'USER'").bind(userId),
  ]);
  if (Number(result[1]?.meta?.changes ?? 0) !== 1) {
    const remaining = await env.DB.prepare('SELECT id, role FROM auth_users WHERE id = ?').bind(userId).first();
    if (remaining?.role === 'SUPER_ADMIN') throw new HttpError(403, '不能删除超级管理员账号');
    throw new HttpError(404, '用户不存在或已被删除');
  }
  return json({ message: '用户已删除，该账号的登录会话已失效', id: userId });
}
/** 非本模块接口返回 null，交由 Worker 入口处理。 */
export async function handleAuth(request, env) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/v1/auth/') && path !== '/api/v1/users' && !path.startsWith('/api/v1/users/')) return null;
  try {
    if (!env.DB) throw new HttpError(503, '账号服务暂不可用，请稍后重试');
    const now = Date.now();
    const userPath = /^\/api\/v1\/users\/([^/]+)$/.exec(path);
    const route = {
      '/api/v1/auth/me': ['GET'], '/api/v1/auth/login': ['POST'],
      '/api/v1/auth/logout': ['POST'], '/api/v1/users': ['GET', 'POST'],
    }[path] || (userPath ? ['DELETE'] : null);
    if (!route) throw new HttpError(404, '接口不存在');
    if (!route.includes(request.method)) throw new HttpError(405, '不支持此请求方法', { Allow: route.join(', ') });
    if (userPath) return await deleteUser(request, env, now, userPath[1]);
    if (path === '/api/v1/auth/login') return await login(request, env, now);
    if (path === '/api/v1/auth/logout') return await logout(request, env);
    if (path === '/api/v1/auth/me') {
      const user = await authenticatedUser(request, env, now);
      if (!user) throw new HttpError(401, '请先登录', { 'Set-Cookie': setCookie('', 0) });
      return json({ user: publicUser(user) });
    }
    if (request.method === 'POST') return await createUser(request, env, now);
    await requireAdministrator(request, env, now);
    const result = await env.DB.prepare('SELECT id, username, display_name, role, created_at FROM auth_users ORDER BY created_at DESC, id DESC').all();
    return json({ users: (result.results ?? []).map(publicUser) });
  } catch (error) {
    if (error instanceof HttpError) return json({ message: error.message }, error.status, error.headers);
    // 错误响应不包含 SQL、密码摘要、令牌或数据库内部信息。
    console.error('Account service failure', error instanceof Error ? error.name : 'UnknownError');
    return json({ message: '账号服务暂不可用，请稍后重试' }, 503);
  }
}
