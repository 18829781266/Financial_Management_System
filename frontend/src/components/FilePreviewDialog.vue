<script setup lang="ts">
import { ref,watch,onBeforeUnmount } from 'vue';
import {loadFile} from '../fileStorage';
const props=defineProps<{modelValue:boolean;fileId?:string;name?:string;legacyUrl?:string}>();const emit=defineEmits<{'update:modelValue':[boolean]}>();
const url=ref(''),error=ref(''),loading=ref(false);const isImage=ref(false);let generation=0;
function release(){if(url.value)URL.revokeObjectURL(url.value);url.value='';}
watch(()=>[props.modelValue,props.fileId,props.legacyUrl],async()=>{
 const token=++generation;release();error.value='';if(!props.modelValue)return;loading.value=true;
 try{
  if(!props.fileId){throw new Error(props.legacyUrl?'旧版上传的临时文件未持久化，请重新上传原件。':'这是内置示例记录，没有实际原始文件；新上传的文件支持查看与下载。');}
  const file=await loadFile(props.fileId);if(token!==generation)return;
  if(!file)throw new Error('未找到本地原件，文件可能已被浏览器清理；请重新上传。');
  url.value=URL.createObjectURL(file);isImage.value=file.type.startsWith('image/')||/\.(png|jpe?g)$/i.test(props.name||'');
 }catch(e){if(token===generation)error.value=e instanceof Error?e.message:'读取原件失败';}finally{if(token===generation)loading.value=false;}
});
onBeforeUnmount(()=>{generation++;release();});
</script>
<template><el-dialog :model-value="modelValue" @close="emit('update:modelValue',false)" :title="name||'查看原始文件'" width="1000px" class="file-preview-dialog" destroy-on-close><div v-loading="loading" class="file-preview-body"><el-alert v-if="error" :title="error" type="info" :closable="false" show-icon/><img v-else-if="url&&isImage" :src="url" :alt="name"/><iframe v-else-if="url" :src="url" :title="name||'PDF 原件'"/></div><template #footer><button class="btn" @click="emit('update:modelValue',false)">关闭</button><a v-if="url" class="btn primary" :href="url" :download="name||'原始文件'">下载原件</a></template></el-dialog></template>
