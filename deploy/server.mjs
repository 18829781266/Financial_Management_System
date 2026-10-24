import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { handleAuth } from '../frontend/worker/auth.js';
import { SqliteD1 } from './sqlite-d1.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 4096;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream' };

function httpError(status) { return Object.assign(new Error('Request rejected'), { status }); }
function canonicalOrigin(value) {
  if (!value) throw new Error('PUBLIC_ORIGIN is required');
  const origin = new URL(value);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('PUBLIC_ORIGIN must be a HTTPS origin');
  return origin;
}
function bodyBuffer(request) {
  return new Promise((accept, reject) => {
    let size = 0; const parts = [];
    const onData = chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { cleanup(); request.pause(); reject(httpError(413)); }
      else parts.push(chunk);
    };
    const onEnd = () => { cleanup(); accept(Buffer.concat(parts)); };
    const onError = () => { cleanup(); reject(httpError(400)); };
    function cleanup() { request.off('data', onData); request.off('end', onEnd); request.off('error', onError); request.off('aborted', onError); }
    request.on('data', onData); request.once('end', onEnd); request.once('error', onError); request.once('aborted', onError);
  });
}
function sendJson(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ message }));
}
function safePath(target) {
  if (!target.startsWith('/') || target.startsWith('//')) throw httpError(400);
  let decoded;
  try { decoded = decodeURIComponent(target.split('?')[0]); } catch { throw httpError(400); }
  if (/[\\\0]/.test(decoded) || /%2f|%5c/i.test(target.split('?')[0]) || decoded.split('/').some(segment => segment.startsWith('.'))) throw httpError(400);
  return decoded;
}

/** 应用只监听回环地址；由 Nginx/Caddy 终止 TLS，并覆盖代理头，保持现有 Secure Cookie。 */
export async function createApplication(options = {}) {
  const origin = canonicalOrigin(options.publicOrigin ?? process.env.PUBLIC_ORIGIN);
  const host = options.host ?? process.env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('Application must bind to loopback');
  const dataDirectory = resolve(options.dataDirectory ?? process.env.HUITONG_DATA_DIR ?? resolve(HERE, 'data'));
  const assetRoot = await realpath(options.assetDirectory ?? process.env.HUITONG_ASSET_DIR ?? resolve(HERE, '../frontend/dist/client'));
  const database = new SqliteD1(resolve(dataDirectory, 'accounts.sqlite'), options.migrationsDirectory ?? resolve(HERE, '../frontend/drizzle'));
  const environment = { DB: database, ADMIN_PASSWORD_HASH: options.adminPasswordHash ?? process.env.ADMIN_PASSWORD_HASH };
  const administrator = database.sqlite.prepare("SELECT role FROM auth_users WHERE username = 'admin'").get();
  if ((!administrator && !/^pbkdf2-sha256\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(environment.ADMIN_PASSWORD_HASH ?? '')) || (administrator && administrator.role !== 'SUPER_ADMIN')) {
    database.close();
    throw new Error('Initial administrator hash is missing or administrator role is invalid');
  }
  let active = 0, draining = false;

  const server = createServer({ maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 10000, keepAliveTimeout: 5000 }, async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    response.setHeader('X-Powered-By', 'Huitong Cloud');
    if (draining || active >= 64) { response.setHeader('Connection', 'close'); sendJson(response, 503, '服务繁忙，请稍后重试'); return; }
    active++;
    try {
      // 只信任本机反向代理；不可直接信任浏览器伪造的 CF/X-Forwarded-*。
      if (!LOOPBACK.has(request.socket.remoteAddress) || request.headers.host !== origin.host || request.headers['x-forwarded-proto'] !== 'https') throw httpError(400);
      const path = safePath(request.url ?? '/');
      const url = new URL(request.url, origin);
      if (url.origin !== origin.origin) throw httpError(400);
      if (path === '/healthz' && ['GET', 'HEAD'].includes(request.method)) {
        database.sqlite.prepare('SELECT 1').get();
        response.setHeader('Cache-Control', 'no-store');
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(request.method === 'HEAD' ? undefined : '{"status":"ok"}');
        return;
      }
      if (path.startsWith('/api/')) {
        if (Number(request.headers['content-length'] ?? 0) > MAX_BODY) throw httpError(413);
        const headers = new Headers();
        for (const name of ['content-type', 'origin', 'cookie', 'sec-fetch-site']) if (request.headers[name]) headers.set(name, String(request.headers[name]));
        const realIp = request.headers['x-real-ip'];
        headers.set('CF-Connecting-IP', typeof realIp === 'string' && isIP(realIp) ? realIp : request.socket.remoteAddress);
        const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await bodyBuffer(request);
        const webRequest = new Request(url, { method: request.method, headers, body });
        const result = await handleAuth(webRequest, environment) ?? Response.json({ message: '接口不存在' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
        const outgoing = Object.fromEntries(result.headers.entries());
        if (result.headers.getSetCookie().length) outgoing['set-cookie'] = result.headers.getSetCookie();
        response.writeHead(result.status, outgoing);
        response.end(Buffer.from(await result.arrayBuffer()));
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) { response.setHeader('Allow', 'GET, HEAD'); throw httpError(405); }
      let filename = resolve(assetRoot, '.' + path), metadata;
      if (filename !== assetRoot && !filename.startsWith(assetRoot + sep)) throw httpError(400);
      try { metadata = await stat(filename); } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
      if (!metadata?.isFile()) {
        if (extname(path)) throw httpError(404);
        filename = resolve(assetRoot, 'index.html');
        metadata = await stat(filename);
      }
      const actualFile = await realpath(filename);
      if (!actualFile.startsWith(assetRoot + sep)) throw httpError(404);
      response.writeHead(200, {
        'Content-Type': TYPES[extname(actualFile).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': metadata.size,
        'Cache-Control': path.startsWith('/assets/') && filename !== resolve(assetRoot, 'index.html') ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      if (request.method === 'HEAD') response.end();
      else await pipeline(createReadStream(actualFile), response);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const status = Number.isInteger(error.status) ? error.status : 503;
        response.setHeader('Connection', 'close');
        response.once('finish', () => request.destroy());
        sendJson(response, status, status === 413 ? '提交内容过大' : status === 404 ? '资源不存在' : status === 503 ? '服务暂时不可用，请稍后重试' : '请求无效');
      } else response.destroy();
      if (!error.status && error.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error('Application request failed', error.name);
    } finally { active--; }
  });
  server.maxConnections = 128;
  server.maxRequestsPerSocket = 100;
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  return {
    server, database, host,
    async listen(port = Number(process.env.PORT ?? 8787)) {
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
      await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); accept(); }); });
      return server.address();
    },
    async close() {
      draining = true;
      const timer = setTimeout(() => server.closeAllConnections(), 10000).unref();
      await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
      clearTimeout(timer);
      database.close();
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const application = await createApplication();
    const address = await application.listen();
    console.log(`Huitong Cloud ready on ${address.address}:${address.port}`);
    let stopping = false;
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      try { await application.close(); process.exitCode = 0; } catch { process.exitCode = 1; }
    });
  } catch (error) { console.error('Huitong Cloud startup failed:', error.message); process.exitCode = 1; }
}
