<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { ArrowRight, Check, Eye, EyeOff, FileCheck2, Files, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, UserRound } from 'lucide-vue-next';
import { authState, initializeAuth, login } from '../auth';

const emit = defineEmits<{ 'logged-in': [] }>();
const username = ref('');
const password = ref('');
const passwordVisible = ref(false);
const busy = ref(false);
const error = ref('');
const errorElement = ref<HTMLElement>();
const visibleError = computed(() => error.value || authState.error);

async function submit() {
  if (busy.value) return;
  error.value = '';
  if (!username.value.trim()) error.value = '请输入账号';
  else if (!password.value) error.value = '请输入密码';
  if (error.value) { await nextTick(); errorElement.value?.focus(); return; }
  busy.value = true;
  try {
    await login(username.value, password.value);
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
          <div class="login-paper front-paper"><div class="paper-top"><span class="paper-icon"><Files :size="26"/></span><span class="paper-status"><span></span>已匹配归档</span></div><strong>电子会计凭证</strong><span class="paper-caption">完整记录 · 有序归集</span><div class="paper-lines"><i></i><i></i><i></i></div><div class="paper-bottom"><span><ShieldCheck :size="15"/>安全留存</span><Check :size="19"/></div></div>
          <div class="login-floating"><FileCheck2 :size="20"/><span>每一次查阅，都有迹可循</span></div>
        </div>
        <div class="login-story-footer"><ShieldCheck :size="17"/><span>统一账号管理，专注每一笔财务记录</span></div>
      </section>
      <section class="login-form-side" aria-labelledby="login-title">
        <div class="login-form-wrap">
          <div class="login-form-heading">
            <span class="login-welcome-icon"><KeyRound :size="27"/></span>
            <div><h2 id="login-title">欢迎登录</h2><p class="login-form-description">汇通云 · 电子会计档案工作空间</p></div>
          </div>
          <form class="login-form" novalidate @submit.prevent="submit" :aria-busy="busy">
            <div v-if="visibleError" ref="errorElement" class="login-error" role="alert" tabindex="-1"><ShieldCheck :size="18"/><span>{{visibleError}}</span></div>
            <div class="login-field"><label for="login-username">账号</label><div class="login-input"><UserRound :size="19"/><input id="login-username" v-model="username" name="username" autocomplete="username" autocapitalize="none" :spellcheck="false" maxlength="32" placeholder="请输入账号" :disabled="busy" :aria-invalid="!!error" required/></div></div>
            <div class="login-field"><label for="login-password">密码</label><div class="login-input"><LockKeyhole :size="19"/><input id="login-password" v-model="password" name="password" :type="passwordVisible?'text':'password'" autocomplete="current-password" maxlength="128" placeholder="请输入密码" :disabled="busy" :aria-invalid="!!error" required/><button type="button" class="login-password-toggle" :aria-label="passwordVisible?'隐藏密码':'显示密码'" :aria-pressed="passwordVisible" :disabled="busy" @click="passwordVisible=!passwordVisible"><EyeOff v-if="passwordVisible" :size="19"/><Eye v-else :size="19"/></button></div></div>
            <button class="login-submit" type="submit" :disabled="busy"><LoaderCircle v-if="busy" :size="19" class="login-spinner"/><span>{{busy?'正在登录…':'登录工作空间'}}</span><ArrowRight v-if="!busy" :size="19"/></button>
            <button v-if="authState.error" class="login-retry" type="button" :disabled="busy||authState.loading" @click="initializeAuth">重新连接账号服务</button>
          </form>
          <div class="login-help"><span class="login-help-icon"><ShieldCheck :size="21"/></span><div><strong>账号由管理员统一管理</strong><p>如需开通账号，请联系超级管理员。</p></div></div>
        </div>
        <div class="login-copyright">汇通云 · 电子凭证自动匹配与归档系统</div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.login-page{min-height:100svh;max-width:none;padding:34px;display:grid;place-items:center;background:radial-gradient(ellipse at 6% 0,#dceaff 0,transparent 44%),radial-gradient(ellipse at 100% 95%,#e2eefc,transparent 48%),#f2f6fb;color:#213b5b;font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif}
.login-shell{width:min(1190px,100%);min-height:695px;display:grid;grid-template-columns:1.08fr 1fr;border-radius:28px;border:1px solid #e0e9f4;background:#fff;box-shadow:0 24px 80px #254b7b13;overflow:hidden}
.login-story{position:relative;isolation:isolate;overflow:hidden;padding:43px 44px 30px;background:radial-gradient(ellipse at 100% 90%,#207a9c65,transparent 54%),linear-gradient(145deg,#163455,#184d88 70%,#235f9a);color:#fff;display:flex;flex-direction:column}.login-story:before{content:"";position:absolute;z-index:-1;width:440px;height:440px;border:1px solid #d5eaff0a;border-radius:50%;left:-255px;top:100px}
.login-brand{display:flex;align-items:center;gap:13px;font-size:30px;font-weight:750;letter-spacing:1.5px}.login-brand img{display:block;flex-shrink:0;filter:drop-shadow(0 4px 8px #061d3540)}.login-brand small{display:block;font-size:9px;letter-spacing:3.1px;color:#a7c8e7;font-weight:600;margin-top:7px}.login-intro{margin-top:55px}.login-kicker{font-size:12px;letter-spacing:1.8px;color:#a5cbe9}.login-intro h1{font-size:39px;line-height:1.5;font-weight:650;letter-spacing:1.5px;margin:14px 0 13px;color:#fff}.login-intro p{font-size:14px;line-height:1.9;color:#b3cee6}
.login-illustration{position:relative;flex:1;min-height:252px;margin:14px 0 8px}.login-orbit{position:absolute;border:1px solid #c2e8ff13;border-radius:50%;width:340px;height:150px;transform:rotate(-18deg);left:40px;top:75px}.orbit-two{width:300px;height:200px;left:55px;top:45px;transform:rotate(22deg)}.login-paper{position:absolute;width:224px;height:205px;border-radius:14px;border:1px solid #d9ebfa;box-shadow:0 17px 35px #092a5233}.back-paper{top:18px;left:80px;transform:rotate(-11deg);background:#bcd9f0;padding:28px 24px}.back-paper>div{height:7px;background:#90badd70;border-radius:3px;margin-bottom:15px}.back-paper>div:nth-child(2){width:70%}.front-paper{top:33px;left:114px;transform:rotate(6deg);background:linear-gradient(130deg,#fff,#eef7ff);padding:18px 20px;color:#2c5a8b}.paper-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px}.paper-icon{width:42px;height:42px;border-radius:12px;background:#e6f1ff;color:#347be0;display:grid;place-items:center}.paper-status{display:flex;align-items:center;gap:5px;background:#e5f5ef;border:1px solid #d2ece2;color:#438d76;border-radius:5px;padding:4px 6px;font-size:8px}.paper-status>span{width:4px;height:4px;border-radius:50%;background:#63ae93}.front-paper>strong{font-size:17px;font-weight:650;letter-spacing:1px}.paper-caption{display:block;font-size:9px;color:#8ca7c3;letter-spacing:.5px;margin-top:7px}.paper-lines{margin-top:16px;display:grid;gap:7px}.paper-lines i{height:4px;background:#dbe7f3;border-radius:3px}.paper-lines i:nth-child(2){width:78%}.paper-lines i:nth-child(3){width:89%}.paper-bottom{display:flex;align-items:center;justify-content:space-between;border-top:1px solid #e3edf5;margin-top:14px;padding-top:10px;color:#5b9c86}.paper-bottom>span{display:flex;gap:5px;align-items:center;font-size:9px}.login-floating{position:absolute;top:199px;left:42px;display:flex;gap:9px;align-items:center;font-size:10px;padding:10px 14px;background:#fff;border:1px solid #d9ebfa;border-radius:10px;color:#5d7f9d;box-shadow:0 8px 25px #10375d1f}.login-floating>svg{color:#35a39a}.login-story-footer{display:flex;align-items:center;gap:8px;font-size:11px;color:#94b9d9;margin-top:18px;line-height:1.8}
.login-form-side{display:flex;flex-direction:column;justify-content:center;position:relative;padding:48px 48px 30px;background:radial-gradient(ellipse at 100% 0,#edf8ff 0,transparent 55%),#fff}
.login-form-wrap{width:100%;max-width:400px;margin:auto}
.login-form-heading{display:flex;align-items:center;gap:16px;padding-bottom:27px;border-bottom:1px solid #e7eef6}
.login-welcome-icon{display:grid;place-items:center;flex-shrink:0;width:56px;height:56px;border:1px solid #d5e9f9;background:linear-gradient(140deg,#e5f6ff,#edf3ff);box-shadow:0 4px 12px #2d77be08;color:#347ed6;border-radius:17px}
.login-form-heading>div{min-width:0}.login-form-wrap h2{font-size:30px;font-weight:700;letter-spacing:.7px;color:#243d5e;line-height:1.35}
.login-form-description{font-size:13px;color:#8195ad;line-height:1.7;margin-top:7px}
.login-form{margin-top:29px;display:grid;gap:22px}
.login-field{min-width:0}.login-field label{display:block;font-size:14px;font-weight:600;color:#405e80;margin-bottom:10px;line-height:1.5}
.login-input{display:flex;align-items:center;gap:12px;min-height:54px;border:1px solid #d9e4ef;border-radius:11px;padding:0 15px;background:#f8fbfe;color:#88a2be;box-shadow:0 1px 2px #19456c03;transition:border-color .18s,box-shadow .18s,background .18s}
.login-input:hover{border-color:#b6cde5}.login-input:focus-within{border-color:#6a9edb;box-shadow:0 0 0 4px #e8f2ff;background:#fff;color:#397fca}.login-input>svg{flex-shrink:0}
.login-input input{width:100%;min-width:0;font:inherit;font-size:15px;background:transparent;border:0;padding:16px 0;outline:none;color:#2d4b6d;box-shadow:none}.login-input input::placeholder{color:#9daec1}
.login-password-toggle{display:grid;place-items:center;flex-shrink:0;width:32px;height:34px;background:transparent;border:0;color:#87a0bb;border-radius:7px;padding:0;cursor:pointer}.login-password-toggle:hover{color:#337bd0;background:#e8f2ff}
.login-submit{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;min-height:54px;margin-top:5px;border:1px solid #2966d3;border-radius:11px;background:linear-gradient(110deg,#287be3,#285fcf);box-shadow:0 7px 17px #2d6ddb25;color:#fff;font-size:15px;font-weight:650;letter-spacing:.3px;cursor:pointer;transition:background .18s,box-shadow .18s,transform .18s}
.login-submit>svg:last-child{transition:transform .18s}.login-submit:hover:not(:disabled){background:linear-gradient(110deg,#226ed4,#2253bd);color:#fff;box-shadow:0 9px 22px #2d6ddb36;transform:translateY(-1px)}.login-submit:hover:not(:disabled)>svg:last-child{transform:translateX(3px)}.login-submit:active:not(:disabled){transform:translateY(1px)}.login-submit:disabled{opacity:.65;cursor:wait}
.login-error{display:flex;gap:9px;align-items:flex-start;padding:12px 13px;border:1px solid #f0d5d8;border-radius:9px;background:#fff4f5;color:#a64755;font-size:13px;line-height:1.7;outline-offset:3px}.login-error>svg{flex-shrink:0;margin-top:2px}
.login-retry{display:block;justify-self:center;color:#3379d1;font-size:13px;padding:4px 6px;background:none;border:0;border-radius:4px;cursor:pointer}.login-retry:hover{text-decoration:underline}
.login-help{display:flex;gap:12px;align-items:center;margin-top:28px;padding:16px;border:1px solid #e1edf5;background:linear-gradient(105deg,#f4f9fd,#f8fbfe);border-radius:12px}
.login-help-icon{display:grid;place-items:center;flex-shrink:0;width:36px;height:36px;border:1px solid #deebf6;background:#fff;border-radius:10px;color:#6197be}.login-help>div{min-width:0}.login-help strong{display:block;font-size:12px;font-weight:600;color:#607e9c;line-height:1.7}.login-help p{font-size:12px;line-height:1.8;color:#8a9eb3;margin-top:3px}
.login-copyright{font-size:10px;color:#a2b1c3;line-height:1.8;text-align:center;margin-top:28px;letter-spacing:.2px}.login-spinner{animation:login-spin .85s linear infinite}@keyframes login-spin{to{transform:rotate(360deg)}}
@media(max-width:1000px){.login-page{padding:24px}.login-shell{min-height:650px;grid-template-columns:1fr 1fr}.login-story{padding:35px 29px 28px}.login-intro{margin-top:43px}.login-intro h1{font-size:32px}.login-illustration{margin-left:-35px;transform:scale(.9);transform-origin:center center}.login-form-side{padding:42px 30px 28px}.login-form-heading{gap:13px}.login-form-wrap h2{font-size:28px}.login-form-description{font-size:12px}.login-brand{font-size:27px}}
@media(max-width:720px){.login-page{padding:21px 16px;align-items:start}.login-shell{display:block;min-height:0;max-width:450px;border-radius:20px}.login-story{padding:25px 26px 27px}.login-brand{font-size:25px;gap:10px}.login-brand img{width:40px;height:40px}.login-brand small{font-size:8px;margin-top:5px;letter-spacing:2.3px}.login-intro{margin-top:26px}.login-kicker{font-size:10px;letter-spacing:1px}.login-intro h1{font-size:25px;line-height:1.5;margin:10px 0 0}.login-intro h1 br{display:none}.login-intro p,.login-illustration,.login-story-footer{display:none}.login-form-side{padding:28px 22px 22px}.login-form-heading{gap:12px;padding-bottom:22px}.login-welcome-icon{width:46px;height:46px;border-radius:14px}.login-welcome-icon>svg{width:24px}.login-form-wrap h2{font-size:25px}.login-form-description{font-size:12px;line-height:1.7;margin-top:6px}.login-form{margin-top:24px;gap:20px}.login-field label{font-size:13px;margin-bottom:9px}.login-input{min-height:50px;padding:0 12px;gap:10px}.login-input input{font-size:14px;padding:14px 0}.login-submit{margin-top:3px;min-height:51px}.login-help{margin-top:24px;padding:13px 12px;gap:10px}.login-help-icon{width:32px;height:32px;border-radius:9px}.login-help strong{font-size:12px}.login-help p{font-size:12px}.login-copyright{font-size:10px;margin-top:24px}}
@media(prefers-reduced-motion:reduce){.login-input,.login-submit,.login-submit>svg:last-child{transition:none}.login-submit:hover:not(:disabled),.login-submit:active:not(:disabled),.login-submit:hover:not(:disabled)>svg:last-child{transform:none}.login-spinner{animation:none}}
</style>
