<script setup lang="ts">
import {defineAsyncComponent,onBeforeUnmount,onMounted} from 'vue';
import {authState,initializeAuth,refreshAuth} from './auth';
import LoginPage from './components/LoginPage.vue';

// 会话核验通过后才载入业务工作区，登录页不读取或展示本地财务记录。
const ArchiveWorkspace=defineAsyncComponent(()=>import('./App.vue'));
let sessionTimer:ReturnType<typeof setInterval>|undefined;
const checkSession=()=>{if(document.visibilityState==='visible'&&authState.user)void refreshAuth();};
onMounted(()=>{void initializeAuth();sessionTimer=setInterval(checkSession,60_000);window.addEventListener('focus',checkSession);document.addEventListener('visibilitychange',checkSession);});
onBeforeUnmount(()=>{clearInterval(sessionTimer);window.removeEventListener('focus',checkSession);document.removeEventListener('visibilitychange',checkSession);});
</script>

<template>
 <div v-if="authState.loading" class="auth-loading" role="status" aria-live="polite"><img src="/huitong-cloud.svg" width="58" height="58" alt=""/><strong>汇通云</strong><span>正在验证登录状态…</span></div>
 <ArchiveWorkspace v-else-if="authState.user" :key="authState.user.id"/>
 <LoginPage v-else/>
</template>

<style scoped>
.auth-loading{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:radial-gradient(ellipse at 50% 35%,#e7f1ff,#f7f9fc 65%);color:#7387a1;font-size:14px}.auth-loading strong{font-size:27px;color:#24426a;letter-spacing:2px}.auth-loading img{filter:drop-shadow(0 6px 12px #2669d52a)}
</style>
