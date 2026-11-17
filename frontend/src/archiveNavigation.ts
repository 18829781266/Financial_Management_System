import type {ArchiveBook,Voucher} from './types';

/** Locate an existing book without treating a matching voucher number as current membership. */
export function findVoucherArchive(archives:readonly ArchiveBook[],voucher:Voucher):ArchiveBook|undefined {
 const books=archives.filter(archive=>archive.status==='locked'&&archive.period===voucher.period);
 // Explicit IDs remain authoritative, including an intentionally empty member list.
 const byId=books.find(archive=>archive.voucherIds!==undefined
  ?archive.voucherIds?.includes(voucher.id)
  :archive.records?.some(record=>record.kind==='voucher'&&record.recordId===voucher.id));
 if(byId)return byId;
 const byFile=books.find(archive=>archive.voucherIds===undefined&&!!voucher.fileId&&archive.records?.some(record=>
  record.kind==='voucher'&&!record.recordId&&record.fileId===voucher.fileId));
 if(byFile)return byFile;
 // Old books predate immutable member/file metadata. Reuse their existing lock-range
 // convention only when exactly one book qualifies; overlapping ranges are ambiguous.
 const legacy=books.filter(archive=>archive.voucherIds===undefined
  &&!archive.records?.some(record=>record.recordId||record.fileId)
  &&voucher.no.localeCompare(archive.startVoucherNo,'zh-CN',{numeric:true})>=0
  &&voucher.no.localeCompare(archive.endVoucherNo,'zh-CN',{numeric:true})<=0);
 return legacy.length===1?legacy[0]:undefined;
}
