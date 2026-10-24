<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { CheckCheck, CircleAlert, LoaderCircle, Plus, RefreshCw, Search, ShieldCheck, Trash2, UserRound, UsersRound } from 'lucide-vue-next';
import { apiRequest, authState } from '../auth';
import type { AuthUser } from '../auth';

const isAdministrator = computed(() => authState.user?.role === 'SUPER_ADMIN');
const users = ref<AuthUser[]>([]);
const loading = ref(false);
const loadError = ref('');
const query = ref('');
const createOpen = ref(false);
const creating = ref(false);
const createError = ref('');
const createErrorElement = ref<HTMLElement>();
const successMessage = ref('');
const deleteTargetId = ref('');
const deleting = ref(false);
let disposed = false;
const form = ref({ username: '', displayName: '', password: '' });
const passwordVisible = ref(false);
const filteredUsers = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase();
  return users.value.filter(user => `${user.username} ${user.displayName}`.toLocaleLowerCase().includes(keyword));
});
const ordinaryCount = computed(() => users.value.filter(user => user.role === 'USER').length);
const administratorCount = computed(() => users.value.filter(user => user.role === 'SUPER_ADMIN').length);
const firstCharacter = (name: string) => Array.from(name.trim())[0] || '用';
const dateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
function formatDate(value: string) { const time = new Date(value); return Number.isNaN(time.getTime()) ? value : dateFormat.format(time); }

async function loadUsers() {
  if (!isAdministrator.value || loading.value || deleteTargetId.value) return;
  loading.value = true; loadError.value = '';
  try { const result = await apiRequest<{ users: AuthUser[] }>('/api/v1/users'); users.value = result.users; }
  catch (failure) { loadError.value = failure instanceof Error ? failure.message : '用户列表加载失败，请重试'; }
  finally { loading.value = false; }
}
function startCreate() {
  if (!isAdministrator.value || loading.value || creating.value || deleteTargetId.value) return;
  form.value = { username: '', displayName: '', password: '' };
  passwordVisible.value = false; createError.value = ''; successMessage.value = '';
  createOpen.value = true;
}
function closeCreate() { if (!creating.value) createOpen.value = false; }
function clearDraft() {
  // 对话框关闭后清除初始密码，刷新或重新打开不会带出上次输入。
  form.value = { username: '', displayName: '', password: '' };
  createError.value = ''; passwordVisible.value = false;
}
async function createUser() {
  if (creating.value || deleteTargetId.value || !isAdministrator.value) return;
  createError.value = '';
  const username = form.value.username.trim(), displayName = form.value.displayName.trim();
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) createError.value = '账号需为3–32位字母、数字、下划线、点或短横线';
  else if (!displayName || displayName.length > 40) createError.value = '请输入1–40个字符的姓名';
  else if (form.value.password.length < 6 || form.value.password.length > 128) createError.value = '初始密码需为6–128个字符';
  if (createError.value) { await nextTick(); createErrorElement.value?.focus(); return; }
  creating.value = true;
  try {
    // 角色由服务器固定为普通用户，不接受客户端传入或提升权限。
    const result = await apiRequest<{ user: AuthUser }>('/api/v1/users', { method: 'POST', body: JSON.stringify({ username, displayName, password: form.value.password }) });
    form.value.password = '';
    createOpen.value = false;
    successMessage.value = `普通用户“${result.user.displayName}”已创建，可使用新账号登录。`;
    // 先显示服务端返回的真实记录，再刷新列表；列表读取失败不会导致重复创建。
    users.value = [result.user, ...users.value.filter(user => user.id !== result.user.id)];
    await loadUsers();
  } catch (failure) { createError.value = failure instanceof Error ? failure.message : '创建失败，请稍后重试'; await nextTick(); createErrorElement.value?.focus(); }
  finally { creating.value = false; }
}
async function deleteUser(user: AuthUser) {
  if (!isAdministrator.value || user.role !== 'USER' || loading.value || creating.value || deleteTargetId.value) return;
  // 确认期间也占用操作锁，避免连点弹出多个确认框或刷新回填旧列表。
  deleteTargetId.value = user.id;
  successMessage.value = '';
  try {
    await ElMessageBox.confirm(
      `确认删除普通用户“${user.displayName}”（账号：${user.username}）？删除后无法撤销，该用户现有登录将立即失效。`,
      '删除用户确认',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning', closeOnClickModal: false },
    );
    if (disposed || !isAdministrator.value) return;
    deleting.value = true;
    const result = await apiRequest<{ message: string; id: string }>(`/api/v1/users/${encodeURIComponent(user.id)}`, { method: 'DELETE', body: '{}' });
    if (result.id !== user.id) throw new Error('删除结果响应异常，请刷新用户列表后核对');
    // 使用服务端确认删除的 ID 更新列表与统计，避免再发读取请求产生竞态回填。
    users.value = users.value.filter(item => item.id !== result.id);
    loadError.value = '';
    successMessage.value = `普通用户“${user.displayName}”已删除，该账号的登录会话已失效。`;
  } catch (failure) {
    if (failure !== 'cancel' && failure !== 'close') loadError.value = failure instanceof Error ? failure.message : '删除用户失败，请稍后重试';
  } finally {
    deleting.value = false;
    deleteTargetId.value = '';
  }
}
watch(isAdministrator, allowed => { if (!allowed) { users.value = []; createOpen.value = false; clearDraft(); } });
onMounted(loadUsers);
onBeforeUnmount(() => {
  disposed = true;
  // 跨标签退出或切换账号时关闭本组件尚未确认的弹框，避免覆盖新登录页。
  if (deleteTargetId.value && !deleting.value) ElMessageBox.close();
});
</script>

<template>
  <section class="user-management" aria-label="用户管理">
    <div v-if="!isAdministrator" class="users-forbidden" role="alert"><ShieldCheck :size="40"/><h2>仅超级管理员可管理用户</h2><p>当前账号没有添加或删除用户的权限。</p></div>
    <template v-else>
      <div class="users-overview"><div class="users-overview-copy"><span class="users-overview-icon"><ShieldCheck :size="26"/></span><div><h2>统一管理团队账号</h2><p>由超级管理员创建普通账号，成员即可登录使用业务功能；离职或停用的普通账号可删除。</p></div></div><button class="btn primary" :disabled="loading||creating||!!deleteTargetId" @click="startCreate"><Plus :size="17"/>新增用户</button></div>
      <div class="users-stats"><div><span class="users-stat-icon all-users"><UsersRound :size="23"/></span><div><p>账号总数</p><strong>{{users.length}}<small>个</small></strong></div></div><div><span class="users-stat-icon admin-users"><ShieldCheck :size="23"/></span><div><p>超级管理员</p><strong>{{administratorCount}}<small>个</small></strong></div></div><div><span class="users-stat-icon ordinary-users"><UserRound :size="23"/></span><div><p>普通用户</p><strong>{{ordinaryCount}}<small>个</small></strong></div></div></div>
      <div v-if="successMessage" class="users-success" role="status"><CheckCheck :size="18"/><span>{{successMessage}}</span></div>
      <div class="users-panel">
        <div class="users-panel-heading"><div><h3>用户列表 <span>{{users.length}}</span></h3><p>普通账号仅可由超级管理员创建或删除</p></div><div class="users-tools"><label class="users-search"><Search :size="17"/><input v-model="query" type="search" aria-label="搜索账号或姓名" placeholder="搜索账号或姓名"/></label><button class="btn" :disabled="loading||creating||!!deleteTargetId" @click="loadUsers" aria-label="刷新用户列表"><RefreshCw :size="16" :class="{'users-spinner':loading}"/><span>刷新</span></button></div></div>
        <div v-if="loadError" class="users-load-error" role="alert"><CircleAlert :size="18"/><span>{{loadError}}</span><button class="text-link" :disabled="loading||creating||!!deleteTargetId" @click="loadUsers">重新加载</button></div>
        <div v-if="loading&&!users.length" class="users-loading" role="status"><LoaderCircle :size="24" class="users-spinner"/>正在加载用户…</div>
        <div v-else class="users-table-scroll"><table class="users-table"><thead><tr><th scope="col">用户</th><th scope="col">账号</th><th scope="col">角色</th><th scope="col">创建时间</th><th scope="col">状态</th><th scope="col" class="user-actions-heading">操作</th></tr></thead><tbody><tr v-for="user in filteredUsers" :key="user.id"><td><div class="user-identity"><span :class="['user-list-avatar',{'is-admin':user.role==='SUPER_ADMIN'}]">{{firstCharacter(user.displayName)}}</span><div><strong>{{user.displayName}}</strong><small v-if="user.id===authState.user?.id">当前账号</small></div></div></td><td><span class="user-account">{{user.username}}</span></td><td><span :class="['user-role-badge',{'is-admin':user.role==='SUPER_ADMIN'}]"><ShieldCheck v-if="user.role==='SUPER_ADMIN'" :size="13"/><UserRound v-else :size="13"/>{{user.role==='SUPER_ADMIN'?'超级管理员':'普通用户'}}</span></td><td><time :datetime="user.createdAt">{{formatDate(user.createdAt)}}</time></td><td><span class="user-status"><i></i>正常</span></td><td class="user-actions"><button v-if="user.role==='USER'" class="btn danger delete-user-button" :disabled="loading||creating||!!deleteTargetId" @click="deleteUser(user)"><LoaderCircle v-if="deleting&&deleteTargetId===user.id" :size="14" class="users-spinner"/><Trash2 v-else :size="14"/><span>{{deleting&&deleteTargetId===user.id?'正在删除…':'删除用户'}}</span></button><span v-else class="system-account">系统账号</span></td></tr><tr v-if="!filteredUsers.length"><td colspan="6" class="users-empty"><UsersRound :size="31"/><p>{{query?'未找到符合条件的用户':'暂无账号数据，请刷新重试'}}</p></td></tr></tbody></table></div>
        <div class="users-table-footer"><span>共 {{filteredUsers.length}} 个{{query?'符合条件的':''}}账号</span><span><ShieldCheck :size="14"/>用户管理仅对超级管理员开放</span></div>
      </div>
      <el-dialog v-model="createOpen" class="create-user-dialog" title="新增普通用户" width="520px" :close-on-click-modal="false" :close-on-press-escape="!creating" :show-close="!creating" @closed="clearDraft">
        <form id="create-user-form" class="create-user-form" novalidate :aria-busy="creating" @submit.prevent="createUser">
          <p class="create-user-description">为团队成员创建独立账号。创建后，将账号与初始密码告知本人即可登录。</p>
          <div v-if="createError" ref="createErrorElement" class="create-user-error" role="alert" tabindex="-1"><CircleAlert :size="18"/><span>{{createError}}</span></div>
          <div class="create-user-field"><label for="new-user-display-name">姓名 <span>*</span></label><input id="new-user-display-name" v-model="form.displayName" name="displayName" autocomplete="off" maxlength="40" placeholder="请输入成员姓名" :disabled="creating" required/></div>
          <div class="create-user-field"><label for="new-user-username">账号 <span>*</span></label><input id="new-user-username" v-model="form.username" name="username" autocomplete="username" autocapitalize="none" :spellcheck="false" maxlength="32" placeholder="3–32位字母、数字、下划线、点或短横线" :disabled="creating" required/></div>
          <div class="create-user-field"><label for="new-user-password">初始密码 <span>*</span></label><div class="new-user-password-wrap"><input id="new-user-password" v-model="form.password" name="password" :type="passwordVisible?'text':'password'" autocomplete="new-password" minlength="6" maxlength="128" placeholder="请输入至少6位初始密码" :disabled="creating" required/><button type="button" :disabled="creating" :aria-label="passwordVisible?'隐藏初始密码':'显示初始密码'" :aria-pressed="passwordVisible" @click="passwordVisible=!passwordVisible">{{passwordVisible?'隐藏':'显示'}}</button></div></div>
          <div class="create-user-role"><span><UserRound :size="17"/>普通用户</span><p>可登录使用业务功能，没有添加或删除用户的权限。</p></div>
        </form>
        <template #footer><button class="btn" :disabled="creating" @click="closeCreate">取消</button><button class="btn primary" type="submit" form="create-user-form" :disabled="creating"><LoaderCircle v-if="creating" :size="16" class="users-spinner"/><span>{{creating?'正在创建…':'创建用户'}}</span></button></template>
      </el-dialog>
    </template>
  </section>
</template>

<style scoped>
.user-management{font-size:14px;color:#4d6581}.users-overview{display:flex;align-items:center;justify-content:space-between;gap:22px;padding:24px 26px;border:1px solid #dbe7f6;border-radius:15px;background:radial-gradient(ellipse at 100% 0,#e2eeff88,transparent 60%),linear-gradient(105deg,#f5f9ff,#fff);margin-bottom:20px}.users-overview-copy{display:flex;align-items:center;gap:16px}.users-overview-icon{width:54px;height:54px;display:grid;place-items:center;flex-shrink:0;background:linear-gradient(140deg,#e6f0ff,#f0f6ff);color:#4c86dc;border:1px solid #dbe8fa;border-radius:16px}.users-overview h2{font-size:19px;color:#365983;font-weight:650;line-height:1.6}.users-overview p{font-size:13px;color:#8194ad;line-height:1.8;margin-top:4px}.users-overview>.btn{flex-shrink:0}.users-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-bottom:21px}.users-stats>div{display:flex;align-items:center;gap:17px;background:#fff;border:1px solid #e3eaf3;border-radius:13px;padding:22px 24px;box-shadow:0 3px 14px #1e416605}.users-stat-icon{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;flex-shrink:0}.all-users{background:#eef4ff;color:#5184dc}.admin-users{background:#f0edff;color:#8a73d4}.ordinary-users{background:#eaf7f3;color:#4aa88e}.users-stats p{font-size:12px;color:#8294ab;margin-bottom:7px}.users-stats strong{font-size:28px;line-height:1.3;font-weight:700;color:#355680;font-variant-numeric:tabular-nums}.users-stats small{font-size:11px;color:#8f9fb4;font-weight:400;margin-left:8px}.users-success{display:flex;align-items:center;gap:10px;border:1px solid #d4eade;background:#f1faf5;color:#49886b;padding:13px 16px;border-radius:10px;font-size:13px;line-height:1.8;margin-bottom:17px}.users-success>svg{flex-shrink:0}.users-panel{border:1px solid #e0e8f2;border-radius:14px;background:#fff;overflow:hidden;box-shadow:0 4px 17px #24446b05}.users-panel-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:23px 25px;border-bottom:1px solid #eaf0f7}.users-panel-heading h3{display:flex;align-items:center;gap:9px;color:#3c5d85;font-size:16px;font-weight:650}.users-panel-heading h3>span{min-width:22px;line-height:20px;text-align:center;font-size:11px;border-radius:5px;background:#edf3fc;color:#6085b6;padding:0 5px}.users-panel-heading p{font-size:11px;color:#93a3b8;line-height:1.8;margin-top:5px}.users-tools{display:flex;align-items:center;gap:10px}.users-search{display:flex;align-items:center;gap:8px;padding:0 11px;min-height:38px;width:240px;border:1px solid #dfe7f1;border-radius:8px;background:#fafcff;color:#94a8c1}.users-search:focus-within{border-color:#90b1e6;box-shadow:0 0 0 3px #edf3fe}.users-search>input{min-width:0;width:100%;border:0;outline:none;background:transparent;font:inherit;font-size:12px;color:#536f92;padding:10px 0}.users-search>input::placeholder{color:#98a9bd}.users-search>svg{flex-shrink:0}.users-table-scroll{overflow:auto;scrollbar-width:thin;max-height:620px}.users-table{width:100%;border-collapse:collapse;min-width:850px;text-align:left;font-size:13px}.users-table thead{position:sticky;top:0;z-index:1}.users-table th{font-weight:550;font-size:12px;color:#7088a7;background:#f5f8fd;border-bottom:1px solid #e6edf6;padding:15px 22px;white-space:nowrap}.users-table td{padding:18px 22px;border-bottom:1px solid #edf1f7;color:#7489a4;line-height:1.7}.users-table tbody tr:last-child td{border-bottom:0}.users-table tbody tr:hover{background:#fafcff}.user-identity{display:flex;align-items:center;gap:11px;min-width:160px}.user-list-avatar{display:grid;place-items:center;width:37px;height:37px;flex-shrink:0;border:1px solid #dcebe7;background:linear-gradient(140deg,#e6f4ef,#f4faf7);border-radius:11px;color:#5c9a86;font-weight:600;font-size:14px}.user-list-avatar.is-admin{background:linear-gradient(140deg,#e9eeff,#f3f5ff);border-color:#dfe6fb;color:#708bd0}.user-identity strong{font-size:14px;font-weight:600;color:#44658d;overflow-wrap:anywhere}.user-identity small{display:block;font-size:10px;color:#8fa4bf;line-height:1.6;margin-top:1px}.user-account{font-variant-numeric:tabular-nums;color:#5c789a;overflow-wrap:anywhere}.user-role-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:5px;color:#62859f;background:#f0f6fb;border:1px solid #e1ebf4;font-size:11px;white-space:nowrap}.user-role-badge.is-admin{background:#f0effb;color:#8577b7;border-color:#e5e0f5}.users-table time{font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums;color:#8798ae}.user-status{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#61a088;white-space:nowrap}.user-status i{width:5px;height:5px;border-radius:50%;background:#70b299}.users-table-footer{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 23px;border-top:1px solid #edf1f7;color:#92a4bb;font-size:11px;line-height:1.7}.users-table-footer>span:last-child{display:inline-flex;align-items:center;gap:5px}.users-load-error{display:flex;align-items:center;gap:9px;margin:18px 23px;padding:12px 14px;border:1px solid #f0dbdb;background:#fff7f7;border-radius:8px;font-size:12px;color:#ac6670;line-height:1.8}.users-load-error>svg{flex-shrink:0}.users-load-error>.text-link{margin-left:auto;white-space:nowrap;font-size:12px}.users-loading{display:flex;align-items:center;justify-content:center;gap:12px;min-height:240px;color:#8a9fb9;font-size:13px}.users-empty{text-align:center!important;height:190px;color:#9aaec6!important}.users-empty>svg{margin:0 auto 12px;display:block}.users-empty p{font-size:13px}.users-forbidden{display:flex;align-items:center;flex-direction:column;justify-content:center;min-height:330px;padding:30px;text-align:center;border:1px solid #e1e9f4;border-radius:14px;background:#fff;color:#95abc7}.users-forbidden h2{font-size:20px;color:#4b6c96;line-height:1.8;margin-top:20px}.users-forbidden p{font-size:13px;line-height:1.8;margin-top:8px}.create-user-form{padding:0 1px}.create-user-description{font-size:12px;line-height:1.9;color:#91a2b8;margin-bottom:21px}.create-user-field{margin-top:17px}.create-user-field>label{display:block;font-size:13px;color:#6b83a2;line-height:1.7;margin-bottom:8px}.create-user-field>label>span{color:#cd7e87;margin-left:3px}.create-user-field>input,.new-user-password-wrap{display:block;width:100%;border:1px solid #dce6f2;border-radius:8px;background:#fbfcff;min-height:42px;padding:10px 12px;font:inherit;font-size:13px;color:#4b6a91;outline:none;box-shadow:none;transition:border-color .18s,box-shadow .18s}.create-user-field>input:focus,.new-user-password-wrap:focus-within{border-color:#8caee4;box-shadow:0 0 0 3px #edf3ff}.create-user-field input::placeholder{color:#a1b0c4;font-size:12px}.new-user-password-wrap{display:flex;align-items:center;gap:10px;padding:0 7px 0 12px}.new-user-password-wrap>input{border:0;min-width:0;width:100%;padding:11px 0;background:transparent;font:inherit;color:inherit;font-size:13px;outline:none;box-shadow:none}.new-user-password-wrap>button{padding:5px 7px;flex-shrink:0;font-size:11px;color:#7d99bd;line-height:1.8;border:0;border-radius:5px;background:transparent;cursor:pointer}.new-user-password-wrap>button:hover{background:#edf4ff;color:#3b78c9}.create-user-role{padding:12px 14px;border:1px solid #e2ebf7;background:#f5f9ff;border-radius:9px;margin:22px 0 3px}.create-user-role>span{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:550;color:#6386b4}.create-user-role p{font-size:11px;color:#8a9fb9;line-height:1.8;margin-top:5px}.create-user-error{display:flex;align-items:flex-start;gap:9px;background:#fff4f5;border:1px solid #f0d8dd;border-radius:8px;padding:11px 13px;font-size:12px;line-height:1.8;color:#b16a78;outline-offset:3px}.create-user-error>svg{flex-shrink:0;margin-top:2px}.users-spinner{animation:users-spin .85s linear infinite}@keyframes users-spin{to{transform:rotate(360deg)}}
.user-actions-heading,.user-actions{text-align:right;white-space:nowrap}.delete-user-button{min-height:32px;padding:0 10px;font-size:12px;gap:6px}.system-account{font-size:12px;color:#95a4b8;white-space:nowrap}
@media(max-width:1100px){.users-overview{padding:22px}.users-overview h2{font-size:18px}.users-overview p{font-size:12px}.users-stats{gap:13px}.users-stats>div{padding:20px;gap:12px}.users-stat-icon{width:42px;height:42px}.users-stats strong{font-size:25px}.users-panel-heading{padding:21px}.users-search{width:200px}}
@media(max-width:760px){.users-overview{align-items:flex-start;flex-wrap:wrap;gap:17px;padding:19px}.users-overview-copy{gap:11px;align-items:flex-start}.users-overview-icon{width:43px;height:43px;border-radius:13px}.users-overview-icon>svg{width:23px}.users-overview h2{font-size:17px;line-height:1.6}.users-overview p{font-size:12px;line-height:1.8}.users-overview>.btn{margin-left:54px;font-size:12px}.users-stats{gap:9px;grid-template-columns:1fr;margin-bottom:18px}.users-stats>div{padding:14px 17px;gap:13px}.users-stat-icon{width:38px;height:38px;border-radius:11px}.users-stat-icon>svg{width:21px}.users-stats>div>div{display:flex;align-items:center;justify-content:space-between;gap:20px;flex:1}.users-stats p{font-size:12px;margin:0}.users-stats strong{font-size:23px}.users-stats small{font-size:10px}.users-panel-heading{padding:18px;flex-wrap:wrap;gap:15px}.users-panel-heading h3{font-size:15px}.users-panel-heading p{font-size:10px}.users-tools{width:100%;gap:8px}.users-search{width:100%;min-width:0;flex:1}.users-tools>.btn{min-height:38px;padding:0 9px}.users-tools>.btn>span{display:none}.users-table th{padding:13px 16px;font-size:11px}.users-table td{padding:15px 16px}.users-table-footer{padding:14px 17px;font-size:10px;flex-wrap:wrap;gap:8px}.users-table-footer>span:last-child{font-size:9px}.users-load-error{margin:15px;font-size:11px;flex-wrap:wrap}.users-load-error>.text-link{font-size:11px}.users-success{font-size:12px;padding:11px 13px}.create-user-field input::placeholder{font-size:11px}.users-forbidden h2{font-size:18px}}
@media(prefers-reduced-motion:reduce){.users-spinner{animation:none}.create-user-field>input,.new-user-password-wrap{transition:none}}
</style>
