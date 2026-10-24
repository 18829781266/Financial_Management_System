// 同一批凭证会多次比较同一企业；缓存只保存字符串，限制条数以免长期使用积累内存。
const normalizedNames=new Map<string,string>();
const NAME_CACHE_LIMIT=2048;
/** 客商名归一化：清除常见企业后缀并应用明确的演示标准名称映射。 */
export function normalizeSupplier(value:string):string {
 const cached=normalizedNames.get(value);if(cached!==undefined)return cached;
 const cleaned=value.normalize('NFKC').replace(/\s|[（()）·,，.。]/g,'').replace(/股份有限公司|有限责任公司|股份公司|有限公司|集团|股份/g,'').toLowerCase();
 const result=({'阿里云计算':'阿里云','腾讯科技':'腾讯','腾讯云计算':'腾讯'} as Record<string,string>)[cleaned]??cleaned;
 if(normalizedNames.size>=NAME_CACHE_LIMIT)normalizedNames.clear();
 normalizedNames.set(value,result);return result;
}
/** Levenshtein 名称相似度，返回百分制；只保留两行距离，空间复杂度 O(n)。 */
export function supplierSimilarity(left:string,right:string):number {
 const normalizedLeft=normalizeSupplier(left),normalizedRight=normalizeSupplier(right);
 if(!normalizedLeft||!normalizedRight)return 0;
 // 归一后相同的非空企业名本来就是100分，无需重复运行距离矩阵；空名称仍不能匹配。
 if(normalizedLeft===normalizedRight)return 100;
 const a=Array.from(normalizedLeft),b=Array.from(normalizedRight);
 let previous=[0,...b.map((_,index)=>index+1)];
 for(let i=1;i<=a.length;i++){
  const current=[i];
  for(let j=1;j<=b.length;j++)current[j]=Math.min(current[j-1]!+1,previous[j]!+1,previous[j-1]!+(a[i-1]===b[j-1]?0:1));
  previous=current;
 }
 return (1-previous[b.length]!/Math.max(a.length,b.length))*100;
}
