import { reactive } from 'vue';

export type UserRole = 'SUPER_ADMIN' | 'USER';
export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

export class AuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'AuthError';
  }
}

// 角色只采信服务端会话，浏览器不保存密码、会话令牌或可篡改的权限标记。
export const authState = reactive<{ user: AuthUser | null; loading: boolean; error: string }>({
  user: null,
  loading: true,
  error: '',
});

let sessionRevision = 0;

/** 所有账号接口通过同源 HttpOnly Cookie 认证，超时及非 JSON 网关错误统一提示。 */
export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const requestRevision = sessionRevision;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body) headers.set('Content-Type', 'application/json');
  try {
    const response = await fetch(path, {
      ...options,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal ?? controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 && requestRevision === sessionRevision) authState.user = null;
      const message = payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message : '账号服务暂时不可用，请稍后重试';
      throw new AuthError(message, response.status);
    }
    if (!payload || typeof payload !== 'object') throw new AuthError('账号服务响应异常，请稍后重试', 502);
    return payload as T;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(controller.signal.aborted ? '请求超时，请检查网络后重试' : '无法连接账号服务，请检查网络后重试', 0);
  } finally {
    clearTimeout(timeout);
  }
}

let sessionRequest: Promise<void> | undefined;
function validUser(value: unknown): AuthUser {
  if (!value || typeof value !== 'object') throw new AuthError('账号服务响应异常，请稍后重试', 502);
  const user = value as Partial<AuthUser>;
  if (typeof user.id !== 'string' || typeof user.username !== 'string' || typeof user.displayName !== 'string'
    || typeof user.createdAt !== 'string' || (user.role !== 'SUPER_ADMIN' && user.role !== 'USER')) {
    throw new AuthError('账号服务响应异常，请稍后重试', 502);
  }
  return user as AuthUser;
}
function checkSession(initial: boolean): Promise<void> {
  if (sessionRequest) return sessionRequest;
  if (initial) { authState.loading = true; authState.error = ''; }
  const revision = sessionRevision;
  sessionRequest = (async () => {
    try {
      const result = await apiRequest<{ user: AuthUser }>('/api/v1/auth/me');
      const user = validUser(result.user);
      if (revision === sessionRevision) { authState.user = user; authState.error = ''; }
    } catch (error) {
      if (revision !== sessionRevision) return;
      if (error instanceof AuthError && error.status === 401) {
        authState.user = null;
        authState.error = '';
      } else if (initial) {
        authState.user = null;
        authState.error = error instanceof Error ? error.message : '会话检查失败';
      }
      // 后台静默检查遇到临时网络故障时保留当前界面；真实请求仍由服务端逐次鉴权。
    } finally {
      if (initial) authState.loading = false;
      sessionRequest = undefined;
    }
  })();
  return sessionRequest;
}
export function initializeAuth(): Promise<void> { return checkSession(true); }
export function refreshAuth(): Promise<void> { return checkSession(false); }

// 跨标签只发送“会话已变化”的通知，接收方重新向服务器核验，不传密码、令牌或角色。
let sessionChannel: BroadcastChannel | undefined;
if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  try {
    sessionChannel = new BroadcastChannel('langchao-auth-events');
    sessionChannel.onmessage = event => {
      if (event.data === 'signed-out') { sessionRevision++; authState.user = null; authState.error = ''; }
      else if (event.data === 'session-changed') {
        sessionRevision++;
        // 等旧请求结算后再读新 Cookie，防止跨标签切换账号时复用旧会话请求。
        void (sessionRequest ?? Promise.resolve()).then(() => refreshAuth());
      }
    };
  } catch { /* 浏览器关闭跨标签通道时，页面聚焦和定时核验仍会同步会话。 */ }
}

function notifySession(message: 'signed-out' | 'session-changed') {
  try { sessionChannel?.postMessage(message); } catch { /* 已完成的服务端操作不受浏览器通道异常影响。 */ }
}

export async function login(username: string, password: string): Promise<AuthUser> {
  sessionRevision++;
  authState.error = '';
  const result = await apiRequest<{ user: AuthUser }>('/api/v1/auth/login', {
    method: 'POST', body: JSON.stringify({ username: username.trim(), password }),
  });
  const user = validUser(result.user);
  authState.user = user;
  notifySession('session-changed');
  return user;
}

export async function logout(): Promise<void> {
  // 服务端撤销成功后才切换到登录页，网络失败不会假装退出成功。
  await apiRequest<{ message: string }>('/api/v1/auth/logout', { method: 'POST', body: '{}' });
  sessionRevision++;
  authState.user = null;
  authState.error = '';
  notifySession('signed-out');
}
