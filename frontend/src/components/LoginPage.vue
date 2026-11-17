<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { ArrowRight, Eye, EyeOff, FileCheck2, Files, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, UserRound } from 'lucide-vue-next';
import { authState, initializeAuth, login } from '../auth';

const emit = defineEmits<{ 'logged-in': [] }>();
const username = ref('');
const password = ref('');
const passwordVisible = ref(false);
const remember = ref(false);
const busy = ref(false);
const error = ref('');
const errorElement = ref<HTMLElement>();
const visibleError = computed(() => error.value || authState.error);
const STORAGE_KEY = 'huitong-remembered-login-v1';

function clearRememberedLogin() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* 浏览器禁用存储时不影响正常登录。 */ }
}
function handleRememberChange() {
  if (!remember.value) clearRememberedLogin();
}

onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { username?: unknown; password?: unknown } | null;
    if (saved && typeof saved.username === 'string' && typeof saved.password === 'string'
      && saved.username.length <= 32 && saved.password.length <= 128) {
      username.value = saved.username;
      password.value = saved.password;
      remember.value = true;
    } else if (saved) clearRememberedLogin();
  } catch { clearRememberedLogin(); }
});

async function submit() {
  if (busy.value) return;
  error.value = '';
  if (!username.value.trim()) error.value = '请输入账号';
  else if (!password.value) error.value = '请输入密码';
  if (error.value) { await nextTick(); errorElement.value?.focus(); return; }
  busy.value = true;
  try {
    await login(username.value, password.value);
    if (remember.value) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ username: username.value.trim(), password: password.value })); }
      catch { /* 存储不可用时仍继续已成功的服务器登录。 */ }
    } else clearRememberedLogin();
    password.value = '';
    emit('logged-in');
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '登录失败，请稍后重试';
    await nextTick(); errorElement.value?.focus();
  } finally { busy.value = false; }
}
</script>

<template>
  <main class="login-page">
    <div class="login-shell">
      <section class="login-story" aria-label="汇通云电子会计档案">
        <div class="login-brand"><img src="/huitong-cloud.svg" width="48" height="48" alt=""/><div>汇通云<small>HUITONG CLOUD</small></div></div>
        <div class="login-intro"><span class="login-kicker">电子会计档案 · 财务工作空间</span><h1>让每一份凭证，<br/>归档有据。</h1><p>从数据采集到智能匹配，<br/>让财务档案清晰、有序、触手可及。</p></div>
        <div class="login-illustration" aria-hidden="true">
          <div class="login-orbit orbit-one"></div><div class="login-orbit orbit-two"></div>
          <div class="login-paper back-paper"><div></div><div></div><div></div></div>
          <div class="login-paper front-paper">
            <div class="paper-top"><span class="paper-icon"><FileCheck2 :size="24" :stroke-width="1.5"/></span><span class="paper-status"><span></span>已匹配</span></div>
            <strong>电子会计凭证</strong><span class="paper-caption">完整记录 · 有序归集</span>
            <div class="paper-lines"><i></i><i></i><i></i></div>
            <div class="paper-bottom"><span><ShieldCheck :size="15"/>安全留存</span><Files :size="19"/></div>
          </div>
          <div class="login-floating"><FileCheck2 :size="20"/><span>每一次查阅，都有迹可循</span></div>
        </div>
        <div class="login-story-footer"><ShieldCheck :size="17"/><span>统一账号管理，专注每一笔财务记录</span></div>
      </section>
      <section class="login-form-side" aria-labelledby="login-title">
        <div class="login-form-wrap">
          <div class="login-form-heading"><span class="login-welcome-icon"><KeyRound :size="28" :stroke-width="1.5"/></span><div><h2 id="login-title">欢迎登录</h2><p class="login-form-description">汇通云 · 电子会计档案工作空间</p></div></div>
          <form class="login-form" novalidate @submit.prevent="submit" :aria-busy="busy">
            <div v-if="visibleError" ref="errorElement" class="login-error" role="alert" tabindex="-1"><ShieldCheck :size="18"/><span>{{visibleError}}</span></div>
            <div class="login-field"><div class="login-input"><UserRound :size="19"/><input id="login-username" v-model="username" name="username" aria-label="账号" autocomplete="username" autocapitalize="none" :spellcheck="false" maxlength="32" placeholder="请输入账号" :disabled="busy" :aria-invalid="!!error" required/></div></div>
            <div class="login-field"><div class="login-input"><LockKeyhole :size="19"/><input id="login-password" v-model="password" name="password" aria-label="密码" :type="passwordVisible?'text':'password'" autocomplete="current-password" maxlength="128" placeholder="请输入密码" :disabled="busy" :aria-invalid="!!error" required/><button type="button" class="login-password-toggle" :aria-label="passwordVisible?'隐藏密码':'显示密码'" :aria-pressed="passwordVisible" :disabled="busy" @click="passwordVisible=!passwordVisible"><EyeOff v-if="passwordVisible" :size="19"/><Eye v-else :size="19"/></button></div></div>
            <div class="login-remember-row"><label class="login-remember"><input v-model="remember" type="checkbox" :disabled="busy" @change="handleRememberChange"/><span>记住账号和密码</span></label><span class="login-remember-note">仅当前浏览器</span></div>
            <button class="login-submit" type="submit" :disabled="busy"><LoaderCircle v-if="busy" :size="19" class="login-spinner"/><span>{{busy?'正在登录…':'立即登录'}}</span><ArrowRight v-if="!busy" :size="19"/></button>
            <button v-if="authState.error" class="login-retry" type="button" :disabled="busy||authState.loading" @click="initializeAuth">重新连接账号服务</button>
          </form>
          <div class="login-help"><span class="login-help-icon"><ShieldCheck :size="20" :stroke-width="1.5"/></span><div><strong>账号由管理员统一管理</strong><p>如需开通账号，请联系超级管理员。</p></div></div>
        </div>
        <div class="login-copyright">汇通云 · 电子凭证自动匹配与归档系统</div>
      </section>
    </div>
  </main>
</template>

<style scoped>
/* 参考图的深蓝展示区与浅色表单；账号验证和表单行为保持原样。 */
.login-page{
 --login-ink:var(--ws-ink);
 --login-muted:var(--ws-muted);
 --login-line:var(--ws-line);
 --login-accent:var(--ws-accent);
 --login-paper:var(--ws-surface);
 min-height:100svh;max-width:none;padding:42px 32px;display:grid;place-items:center;
 background:radial-gradient(ellipse at 7% -8%,#dceaff 0,transparent 48%),radial-gradient(ellipse at 91% 100%,#e4effd 0,transparent 48%),#f2f6fb;color:var(--login-ink);
 font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
}
.login-shell{
 width:min(1188px,100%);min-height:715px;display:grid;grid-template-columns:52% 48%;
 border:0;border-radius:26px;background:var(--login-paper);
 box-shadow:0 22px 64px rgb(28 67 112 / .1);overflow:hidden;
}
.login-story{
 position:relative;isolation:isolate;overflow:hidden;padding:46px 44px 30px;
 background:radial-gradient(ellipse at 100% 100%,rgb(51 156 188 / .3),transparent 66%),linear-gradient(145deg,#173554 0%,#19477b 66%,#1e6294 100%);color:#ffffff;display:flex;flex-direction:column;
}
.login-story::before{content:"";position:absolute;z-index:-1;pointer-events:none;width:440px;height:440px;left:-260px;top:100px;border:1px solid rgb(157 207 249 / .055);border-radius:50%}
.login-brand{display:flex;align-items:center;gap:13px;font-size:29px;font-weight:700;letter-spacing:1px}
.login-brand img{display:block;flex-shrink:0;filter:none}
.login-brand small{display:block;font-size:9px;letter-spacing:2.8px;color:#b5ddfa;font-weight:500;margin-top:6px}
.login-intro{margin-top:94px}
.login-kicker{display:none;font-size:12px;letter-spacing:1px;color:#48688f}
.login-intro h1{font-size:38px;line-height:1.55;font-weight:700;letter-spacing:.5px;margin:0 0 13px;color:#ffffff}
.login-intro p{font-size:13px;line-height:2;color:#c1e2f9}
.login-illustration{position:relative;flex:1;min-height:242px;margin:16px 0 8px 25px}
.login-orbit{position:absolute;pointer-events:none;border:1px solid rgb(168 213 247 / .08);border-radius:50%}
.orbit-one{width:330px;height:160px;left:27px;top:50px;transform:rotate(-21deg)}
.orbit-two{width:300px;height:100px;left:43px;top:143px;transform:rotate(11deg)}
.login-paper{position:absolute;width:230px;height:214px;border-radius:13px;border:0;box-shadow:0 12px 26px rgb(7 36 71 / .12)}
.back-paper{top:7px;left:60px;transform:rotate(-11deg);background:#b5d9ed;padding:26px 24px}
.back-paper>div{height:6px;background:#95c2dc;border-radius:3px;margin-bottom:16px}
.back-paper>div:nth-child(2){width:70%}
.front-paper{top:24px;left:102px;transform:rotate(6deg);background:linear-gradient(150deg,#ffffff,#eff8ff);padding:18px 20px;color:var(--login-ink)}
.paper-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.paper-icon{width:38px;height:38px;border-radius:11px;background:#e7f1ff;color:#2776ee;display:grid;place-items:center}
.paper-status{display:flex;align-items:center;gap:5px;background:oklch(0.94 0.025 165);border:1px solid oklch(0.88 0.04 165);color:oklch(0.43 0.075 165);border-radius:4px;padding:4px 6px;font-size:9px}
.paper-status>span{width:4px;height:4px;border-radius:50%;background:oklch(0.52 0.09 165)}
.front-paper>strong{display:block;font-size:16px;line-height:1.4;font-weight:650;letter-spacing:.3px}
.paper-caption{display:block;font-size:10px;line-height:1.5;color:var(--login-muted);margin-top:4px}
.paper-lines{margin-top:12px;display:grid;gap:7px}
.paper-lines i{height:4px;background:#e0e9f6;border-radius:2px}
.paper-lines i:nth-child(2){width:78%}.paper-lines i:nth-child(3){width:89%}
.paper-bottom{display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--login-line);margin-top:10px;padding-top:8px;color:oklch(0.43 0.075 165)}
.paper-bottom>span{display:flex;gap:5px;align-items:center;font-size:10px}
.login-floating{position:absolute;left:17px;top:196px;display:flex;align-items:center;gap:10px;padding:11px 14px;background:#ffffff;color:#4e6b91;border-radius:11px;box-shadow:0 7px 18px rgb(6 37 70 / .1);font-size:10px;line-height:1.6;white-space:nowrap}
.login-floating>svg{color:#159c9e;flex-shrink:0}
.login-story-footer{display:flex;align-items:center;gap:8px;font-size:11px;color:#b5d7f2;margin-top:12px;line-height:1.8;padding-top:0;border:0}
.login-story-footer>svg{flex-shrink:0;color:#a3ccec}
.login-form-side{display:flex;flex-direction:column;justify-content:center;position:relative;padding:56px 64px 28px;background:radial-gradient(ellipse at 100% 0,#eefaff 0,transparent 56%),#ffffff}
.login-form-wrap{width:100%;max-width:400px;margin:auto}
.login-form-heading{display:flex;align-items:center;gap:16px;padding-bottom:28px;border-bottom:1px solid #e2ebf6}
.login-welcome-icon{display:grid;place-items:center;flex-shrink:0;width:56px;height:56px;border:1px solid #d3e7ff;background:#eaf4ff;box-shadow:none;color:#2b7ce9;border-radius:17px}
.login-form-heading>div{min-width:0}
.login-form-wrap h2{font-size:30px;font-weight:700;letter-spacing:.3px;color:var(--login-ink);line-height:1.4}
.login-form-description{font-size:13px;color:var(--login-muted);line-height:1.75;margin-top:6px}
.login-form{margin-top:29px;display:grid;gap:18px}
.login-field{min-width:0}
.login-input{display:flex;align-items:center;gap:11px;min-height:54px;border:1px solid #d3e0f1;border-radius:12px;padding:0 14px;background:#f5f8fc;color:#637e9f;box-shadow:none;transition:border-color .18s,box-shadow .18s,background-color .18s}
.login-input:hover{border-color:#a0bbe5}
.login-input:focus-within{border-color:var(--login-accent);box-shadow:0 0 0 3px rgb(45 105 230 / .12);background:var(--login-paper);color:var(--login-accent)}
.login-input>svg{flex-shrink:0}
.login-input input{width:100%;min-width:0;font:inherit;font-size:14px;background:transparent;border:0;padding:16px 0;outline:none;color:var(--login-ink);box-shadow:none;caret-color:var(--login-accent)}
.login-input input::placeholder{color:var(--login-muted);opacity:1}
.login-input input:-webkit-autofill{-webkit-text-fill-color:var(--login-ink);-webkit-box-shadow:0 0 0 1000px #f5f8fc inset;caret-color:var(--login-accent)}
.login-input:focus-within input:-webkit-autofill{-webkit-box-shadow:0 0 0 1000px var(--login-paper) inset}
.login-password-toggle{display:grid;place-items:center;flex-shrink:0;width:40px;height:44px;background:transparent;border:0;color:#5a789d;border-radius:6px;padding:0;cursor:pointer}
.login-password-toggle:hover{color:var(--login-accent);background:#eaf2ff}
.login-password-toggle:focus-visible,.login-submit:focus-visible,.login-retry:focus-visible,.login-remember input:focus-visible{outline:2px solid var(--login-accent);outline-offset:3px}
.login-remember-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px;margin-top:-2px}
.login-remember{display:flex;align-items:center;gap:8px;min-height:40px;color:#4b6382;font-size:13px;line-height:1.5;cursor:pointer;user-select:none}
.login-remember input{width:16px;height:16px;margin:0;accent-color:var(--login-accent);cursor:pointer}
.login-remember input:disabled,.login-remember:has(input:disabled){cursor:not-allowed;opacity:.65}
.login-remember-note{flex-shrink:0;color:#5d7594;font-size:11px;white-space:nowrap}
.login-submit{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;min-height:54px;margin-top:0;border:1px solid #2866d7;border-radius:12px;background:linear-gradient(100deg,#2a78e4,#285ed4);box-shadow:0 8px 18px rgb(36 99 211 / .13);color:#ffffff;font-size:15px;font-weight:600;letter-spacing:.3px;cursor:pointer;transition:background-color .18s,box-shadow .18s}
.login-submit:hover:not(:disabled){background:#2057cb;border-color:#2057cb;box-shadow:0 3px 8px rgb(32 86 180 / .16)}
.login-submit:active:not(:disabled){background:#194bb8;box-shadow:none}
.login-submit:disabled{opacity:.65;cursor:wait}
.login-error{display:flex;gap:9px;align-items:flex-start;padding:12px 13px;border:1px solid oklch(0.85 0.055 15);border-radius:8px;background:oklch(0.97 0.012 15);color:oklch(0.44 0.12 15);font-size:13px;line-height:1.7;outline-offset:3px}
.login-error>svg{flex-shrink:0;margin-top:2px}
.login-retry{display:block;justify-self:center;min-height:44px;color:var(--login-accent);font-size:13px;padding:6px;background:none;border:0;border-radius:4px;cursor:pointer}
.login-retry:hover{text-decoration:underline}
.login-help{display:flex;gap:12px;align-items:center;margin-top:24px;padding:17px 16px;border:1px solid #dce9f9;background:#f7fbff;border-radius:12px}
.login-help-icon{display:grid;place-items:center;flex-shrink:0;width:35px;height:35px;border:1px solid #dce9f9;background:#ffffff;border-radius:9px;color:#4389c7}
.login-help>div{min-width:0}
.login-help strong{display:block;font-size:12px;font-weight:600;color:#435e82;line-height:1.7}
.login-help p{font-size:12px;line-height:1.8;color:var(--login-muted);margin-top:3px}
.login-copyright{font-size:10px;color:#5b7393;line-height:1.8;text-align:center;margin-top:28px;letter-spacing:.2px}
.login-spinner{animation:login-spin .85s linear infinite}
@keyframes login-spin{to{transform:rotate(360deg)}}
@media(max-width:1000px){
 .login-page{padding:24px}.login-shell{min-height:650px;grid-template-columns:1fr 1fr}
 .login-story{padding:34px 29px 28px}.login-intro{margin-top:44px}.login-intro h1{font-size:32px}
 .login-illustration{margin-left:-35px;transform:scale(.9);transform-origin:center}
 .login-form-side{padding:40px 30px 26px}.login-form-heading{gap:12px}.login-form-wrap h2{font-size:27px}.login-form-description{font-size:12px}.login-brand{font-size:27px}
}
@media(max-width:720px){
 .login-page{padding:20px 16px;align-items:start}.login-shell{display:block;min-height:0;max-width:450px;border-radius:12px}
 .login-story{padding:25px 26px 27px}.login-brand{font-size:25px;gap:10px}.login-brand img{width:40px;height:40px}.login-brand small{font-size:8px;margin-top:5px;letter-spacing:2.3px}
 .login-intro{margin-top:25px}.login-kicker{font-size:10px;letter-spacing:.7px}.login-intro h1{font-size:25px;line-height:1.5;margin:10px 0 0}
 .login-intro p,.login-illustration,.login-story-footer{display:none}.login-form-side{padding:28px 22px 22px}
 .login-form-heading{gap:12px;padding-bottom:22px}.login-welcome-icon{width:44px;height:44px;border-radius:9px}.login-welcome-icon :deep(.feature-icon){width:44px!important;height:44px!important}.login-welcome-icon>svg{width:23px}
 .login-form-wrap h2{font-size:25px}.login-form-description{font-size:12px;line-height:1.7;margin-top:6px}.login-form{margin-top:24px;gap:17px}
 .login-input{min-height:50px;padding:0 12px;gap:10px}.login-input input{font-size:14px;padding:14px 0}.login-submit{min-height:51px}
 .login-help{margin-top:23px;padding-top:15px;gap:10px}.login-help-icon{width:32px;height:32px}.login-help-icon :deep(.feature-icon){width:32px!important;height:32px!important}.login-help strong,.login-help p{font-size:12px}.login-copyright{font-size:10px;margin-top:24px}
}
@media(max-width:360px){
 .login-page{padding-left:12px;padding-right:12px}.login-form-side{padding-left:18px;padding-right:18px}
 .login-remember-row{gap:8px}.login-remember{font-size:12px}.login-remember-note{font-size:10px}
}
@media(prefers-reduced-motion:reduce){.login-input,.login-submit{transition:none}.login-spinner{animation:none}}
</style>
