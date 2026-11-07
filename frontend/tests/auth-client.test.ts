import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/auth';

const administrator: AuthUser = { id: 'admin-test', username: 'admin-test', displayName: '测试管理员', role: 'SUPER_ADMIN', createdAt: '2026-10-23T12:00:00.000Z' };
const member: AuthUser = { id: 'member-test', username: 'member-test', displayName: '测试成员', role: 'USER', createdAt: '2026-10-23T12:00:00.000Z' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('客户端会话与权限边界', () => {
  it('未登录的会话检查是正常状态，采用同源Cookie且禁止缓存', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ message: '请先登录' }, 401));
    vi.stubGlobal('fetch', fetcher);
    const auth = await import('../src/auth');
    await auth.initializeAuth();
    expect(auth.authState).toMatchObject({ user: null, loading: false, error: '' });
    expect(fetcher).toHaveBeenCalledWith('/api/v1/auth/me', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
  });

  it('登录仅采信服务端身份，保留密码原值且不写浏览器存储', async () => {
    const write = vi.fn(); vi.stubGlobal('localStorage', { setItem: write });
    const fetcher = vi.fn().mockResolvedValue(response({ user: member })); vi.stubGlobal('fetch', fetcher);
    const auth = await import('../src/auth');
    await auth.login(' member-test ', '  sample-password  ');
    const [, request] = fetcher.mock.calls[0]!;
    expect(JSON.parse(request.body)).toEqual({ username: 'member-test', password: '  sample-password  ' });
    expect(request.headers.get('Content-Type')).toBe('application/json');
    expect(request.credentials).toBe('same-origin');
    expect(auth.authState.user).toEqual(member);
    expect(auth.authState.user?.role).toBe('USER');
    expect(write).not.toHaveBeenCalled();
  });

  it('无效角色的成功响应不能使客户端进入工作空间', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ user: { ...member, role: 'administrator' } })));
    const auth = await import('../src/auth');
    await expect(auth.login('member-test', 'sample-password')).rejects.toThrow('账号服务响应异常');
    expect(auth.authState.user).toBeNull();
  });

  it('错误密码只返回提交错误，不冒充会话服务故障', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ message: '账号或密码错误' }, 401)));
    const auth = await import('../src/auth');
    await expect(auth.login('member-test', 'wrong-password')).rejects.toMatchObject({ status: 401, message: '账号或密码错误' });
    expect(auth.authState.user).toBeNull();
    expect(auth.authState.error).toBe('');
  });

  it('静默核验暂时断网保留当前账号，真实401清除已过期会话', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValueOnce(response({ message: '会话已过期' }, 401));
    vi.stubGlobal('fetch', fetcher);
    const auth = await import('../src/auth'); auth.authState.user = member; auth.authState.loading = false;
    await auth.refreshAuth();
    expect(auth.authState.user).toEqual(member);
    expect(auth.authState.loading).toBe(false);
    await auth.refreshAuth();
    expect(auth.authState.user).toBeNull();
  });

  it('退出网络失败时不假装成功，成功时发送JSON并清空会话', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValueOnce(response({ message: '已退出登录' }));
    vi.stubGlobal('fetch', fetcher);
    const auth = await import('../src/auth'); auth.authState.user = member;
    await expect(auth.logout()).rejects.toThrow('无法连接账号服务');
    expect(auth.authState.user).toEqual(member);
    await auth.logout();
    expect(auth.authState.user).toBeNull();
    const [, request] = fetcher.mock.calls[1]!;
    expect(request.method).toBe('POST');
    expect(request.body).toBe('{}');
    expect(request.headers.get('Content-Type')).toBe('application/json');
  });

  it.each([200, 401])('旧会话的晚到%d响应不能覆盖已完成的新登录', async status => {
    let finishOld!: (value: Response) => void;
    const oldRequest = new Promise<Response>(resolve => { finishOld = resolve; });
    const fetcher = vi.fn().mockImplementationOnce(() => oldRequest).mockResolvedValueOnce(response({ user: member }));
    vi.stubGlobal('fetch', fetcher);
    const auth = await import('../src/auth');
    const initial = auth.initializeAuth();
    await auth.login('member-test', 'sample-password');
    finishOld(status === 200 ? response({ user: administrator }) : response({ message: '旧会话已失效' }, 401));
    await initial;
    expect(auth.authState.user).toEqual(member);
    expect(auth.authState.loading).toBe(false);
    expect(auth.authState.error).toBe('');
  });

  it('重复会话核验共用一次请求，不创建Node环境的跨标签通道', async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    const channel = vi.fn(); vi.stubGlobal('BroadcastChannel', channel); vi.stubGlobal('fetch', fetcher);
    const auth = await import('../src/auth');
    const first = auth.initializeAuth(), second = auth.refreshAuth();
    expect(first).toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish(response({ user: administrator })); await first;
    expect(channel).not.toHaveBeenCalled();
  });
});
