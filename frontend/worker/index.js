import {handleAuth} from './auth.js';

export default {
 async fetch(request,env){
  const url=new URL(request.url);
  try{
   if(url.pathname.startsWith('/api/')){
    const response=await handleAuth(request,env);
    return response||Response.json({message:'接口不存在'},{status:404,headers:{'Cache-Control':'no-store'}});
   }
   return await env.ASSETS.fetch(request);
  }catch(error){
   // 服务端异常不把数据库信息、凭据或堆栈返回给浏览器。
   console.error('Request failed',error instanceof Error?error.name:'UnknownError');
   return Response.json({message:'服务暂时不可用，请稍后重试'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
 }
};
