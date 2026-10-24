export interface ImportOrderMetadata {importedAt?:string;importSequence?:number}

/** 只有有效提交序号可参与排序；旧数据与无效字段统一走兼容路径。 */
export function validImportSequence(value:unknown):number {
 return typeof value==='number'&&Number.isSafeInteger(value)&&value>0?value:0;
}

/**
 * 最新导入记录优先，与会计业务日期、凭证号无关。
 * 新版本以提交序号为准，避免同毫秒批量导入或系统时钟回拨打乱顺序。
 * 旧版本没有导入元数据：凭证原来追加在尾，单据原来插入在头，按各自方向兼容。
 * 返回新数组，保持原始业务数组与已有响应式对象不变。
 */
export function latestImported<T extends object>(records:readonly T[],legacyOrder:'append'|'prepend'):T[]{
 const timestamp=(value:unknown)=>{
  const time=typeof value==='string'?Date.parse(value):NaN;
  return Number.isFinite(time)?time:0;
 };
 return records.map((record,index)=>{
  const metadata=record as ImportOrderMetadata;
  return {record,index,sequence:validImportSequence(metadata.importSequence),time:timestamp(metadata.importedAt)};
 }).sort((left,right)=>{
  if(left.sequence!==right.sequence)return right.sequence-left.sequence;
  const time=right.time-left.time;
  return time||(legacyOrder==='append'?right.index-left.index:left.index-right.index);
 }).map(item=>item.record);
}
