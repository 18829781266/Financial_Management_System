import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {authState} from '../src/auth';
import type {AuthUser} from '../src/auth';
import {useArchiveStore,visibleOperationLogs} from '../src/store';
import type {OperationLog} from '../src/types';

const memory=new Map<string,string>();
vi.stubGlobal('localStorage',{getItem:(key:string)=>memory.get(key)||null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)});
const store=useArchiveStore();
const user=(id:string,role:AuthUser['role']='USER'):AuthUser=>({id,username:`account-${id}`,displayName:'同名操作员',role,createdAt:'2026-01-01T00:00:00.000Z'});
const entry=(id:string,operatorId?:string):OperationLog=>({id,time:'2026-11-04 10:00:00',action:'合成操作',detail:id,operator:'同名操作员',operatorId});

beforeEach(()=>{store.state.logs=[];authState.user=null;});
afterEach(()=>{authState.user=null;});

describe('操作日志按稳定账号身份分权',()=>{
 it('普通用户只能看到本人日志，同名他人及无身份旧记录不可见',()=>{
  const current=user('u-current'),logs=[entry('本人','u-current'),entry('同名他人','u-other'),entry('旧记录')];
  expect(visibleOperationLogs(logs,current).map(item=>item.id)).toEqual(['本人']);
 });
 it('超级管理员看到全部日志，未登录不返回任何日志',()=>{
  const logs=[entry('甲','u-a'),entry('乙','u-b'),entry('旧记录')];
  expect(visibleOperationLogs(logs,user('admin','SUPER_ADMIN'))).toBe(logs);
  expect(visibleOperationLogs(logs,null)).toEqual([]);
 });
 it('新写入日志同时保存用户ID和登录账号，并按当前用户过滤',()=>{
  const current=user('u-current');authState.user=current;
  store.recordOperation('归档生成失败','合成失败日志');
  const latest=store.state.logs[0]!;
  expect(latest.operatorId).toBe(current.id);expect(latest.operatorUsername).toBe(current.username);expect(latest.operator).toBe(current.displayName);
  expect(visibleOperationLogs(store.state.logs,current).map(item=>item.id)).toContain(latest.id);
  expect(visibleOperationLogs(store.state.logs,user('u-other'))).toEqual([]);
 });
});
