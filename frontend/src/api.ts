/** Java REST 客户端。App 当前使用本地演示 store；正式接入时以此替换数据源。 */
export interface EntryInput { accountCode:string; accountName:string; direction:'DEBIT'|'CREDIT'; amount:number }
export interface VoucherInput {
  externalId:string; voucherNo:string; period:string; summary:string; amount:number;
  voucherDate:string; supplierName:string; imageUrl:string; expectedAttachmentCount:number;
  invoiceNo?:string; contractNo?:string; bankFlowNo?:string; approvalNo?:string;
  customFields:Record<string,unknown>; entries:EntryInput[];
}
export interface ImportRequest { sourceSystem:string; batchId:string; vouchers:VoucherInput[] }
export interface SearchRequest {
  period?:string; voucherNo?:string; invoiceNo?:string; contractNo?:string;
  supplierName?:string; keyword?:string; minAmount?:number; maxAmount?:number; page?:number; size?:number;
}
export interface ServerArchive {id:number;period:string;startVoucherNo:string;endVoucherNo:string;pdfUrl:string;hashCode:string;status:string}
interface ResponseEnvelope<T> { code:number; message:string; data:T }
export class ApiError extends Error { constructor(message:string, public readonly status:number){super(message);} }
export function createApiClient(baseUrl='/api/v1') {
  async function request<T>(path:string,options:RequestInit={}):Promise<T> {
    const response=await fetch(baseUrl+path,{...options,headers:{...(!(options.body instanceof FormData)?{'Content-Type':'application/json'}:{}),...options.headers},credentials:'same-origin'});
    const result=await response.json() as ResponseEnvelope<T>;
    if(!response.ok||result.code!==0)throw new ApiError(result.message||'服务请求失败',response.status);
    return result.data;
  }
  const post=<T>(path:string,body:unknown)=>request<T>(path,{method:'POST',body:JSON.stringify(body)});
  function params(values:object){const q=new URLSearchParams();for(const [key,value]of Object.entries(values)){if(value!==undefined&&value!==null&&value!=='')q.set(key,String(value));}return q.toString();}
  return {
    importVouchers:(body:ImportRequest)=>post<unknown>('/vouchers/import',body),
    async uploadImage(file:File){const data=new FormData();data.set('file',file);return request<{imageUrl:string}>('/files',{method:'POST',body:data});},
    async recognizeDocument(file:File,period:string){const data=new FormData();data.set('file',file);data.set('period',period);return request<Record<string,unknown>>('/documents/ocr',{method:'POST',body:data});},
    autoMatch:(period:string)=>post<Record<string,unknown>>('/match/auto',{period}),
    exceptions:(period:string,page=1,size=20)=>request<Record<string,unknown>>('/match/exceptions?'+params({period,page,size})),
    recommendations:(voucherId:number)=>request<Record<string,unknown>>('/match/recommendations?'+params({voucherId})),
    manualMatch:(voucherId:number,documentIds:number[],reason:string)=>post<unknown>('/match/manual',{voucherId,documentIds,reason}),
    markMissing:(voucherId:number,reason:string)=>post<unknown>(`/vouchers/${voucherId}/missing`,{reason}),
    generateArchive:(period:string,startVoucherNo:string,endVoucherNo:string)=>post<ServerArchive>('/archive/generate',{period,startVoucherNo,endVoucherNo}),
    search:(filters:SearchRequest)=>request<Record<string,unknown>>('/archive/search?'+params(filters)),
    evidenceChain:(relationId:string)=>request<Record<string,unknown>>(`/relations/${encodeURIComponent(relationId)}/chain`),
    rules:()=>request<Record<string,unknown>[]>('/rules'),
    updateRule:(id:string,body:{threshold:number;conditions:Record<string,unknown>;enabled:boolean;version:number})=>request<unknown>(`/rules/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(body)}),
    async downloadArchive(id:number){const response=await fetch(`${baseUrl}/archive/${id}/pdf`,{credentials:'same-origin'});if(!response.ok){const error=await response.json();throw new ApiError(error.message||'下载档案失败',response.status);}return response.blob();},
  };
}
