package com.langchao.archive.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.langchao.archive.api.*;
import com.langchao.archive.api.ApiModels.*;
import com.langchao.archive.mapper.*;
import com.langchao.archive.model.*;
import com.langchao.archive.ocr.OcrGateway;
import com.langchao.archive.storage.FileStorage;
import com.langchao.archive.util.OcrDataCleaner;
import com.langchao.archive.util.SupplierNormalizer;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.util.*;
import java.util.regex.Pattern;

@Service
public class DataService {
    private final VoucherMapper vouchers;
    private final VoucherEntryMapper entries;
    private final SourceDocumentMapper documents;
    private final TransactionTemplate tx;
    private final SupplierNormalizer names;
    private final AuditService audit;
    private final StringRedisTemplate redis;
    private final FileStorage files;
    private final OcrGateway ocr;
    public DataService(VoucherMapper vouchers,VoucherEntryMapper entries,SourceDocumentMapper documents,
        TransactionTemplate tx,SupplierNormalizer names,AuditService audit,StringRedisTemplate redis,FileStorage files,OcrGateway ocr) {
        this.vouchers=vouchers;this.entries=entries;this.documents=documents;this.tx=tx;this.names=names;this.audit=audit;this.redis=redis;this.files=files;this.ocr=ocr;
    }
    public Map<String,Object> importVouchers(ImportRequest request,String actor) {
        List<Voucher> imported=tx.execute(status->{
            List<Voucher> rows=new ArrayList<>();
            Set<String> keys=new HashSet<>();
            for(VoucherInput input:request.vouchers()) {
                if(!keys.add(input.externalId())) throw new ApiException(400,"同一批次存在重复externalId");
                if(!input.voucherDate().toString().startsWith(input.period())) throw new ApiException(400,"凭证日期与期间不一致");
                if(vouchers.selectCount(new QueryWrapper<Voucher>().eq("source_system",request.sourceSystem()).eq("external_id",input.externalId()))>0) {
                    throw new ApiException(409,"ERP凭证已导入："+input.externalId());
                }
                BigDecimal debit=input.entries().stream().filter(e->"DEBIT".equals(e.direction())).map(Entry::amount).reduce(BigDecimal.ZERO,BigDecimal::add);
                BigDecimal credit=input.entries().stream().filter(e->"CREDIT".equals(e.direction())).map(Entry::amount).reduce(BigDecimal.ZERO,BigDecimal::add);
                if(debit.compareTo(credit)!=0||debit.compareTo(input.amount())!=0) throw new ApiException(422,"分录借贷不平或凭证金额与借方合计不一致："+input.voucherNo());
                files.resource(input.imageUrl()); // 只接受受管存储中的文件，避免任意路径/SSRF。
                Voucher row=new Voucher();row.setSourceSystem(request.sourceSystem());row.setExternalId(input.externalId());row.setVoucherNo(input.voucherNo());
                row.setVoucherSequence(sequence(input.voucherNo()));row.setPeriod(input.period());row.setSummary(input.summary());row.setAmount(input.amount());
                row.setVoucherDate(input.voucherDate());row.setSupplierName(input.supplierName());row.setNormalizedSupplierName(names.normalize(input.supplierName()));
                row.setInvoiceNo(field(input.invoiceNo(),input.customFields(),"invoiceNo"));row.setContractNo(field(input.contractNo(),input.customFields(),"contractNo"));
                row.setBankFlowNo(field(input.bankFlowNo(),input.customFields(),"bankFlowNo"));row.setApprovalNo(field(input.approvalNo(),input.customFields(),"approvalNo"));
                row.setCustomFields(input.customFields());row.setImageUrl(input.imageUrl());row.setExpectedAttachmentCount(input.expectedAttachmentCount());row.setStatus("PENDING");row.setCreatedAt(LocalDateTime.now());
                vouchers.insert(row);
                for(int i=0;i<input.entries().size();i++) {Entry item=input.entries().get(i);VoucherEntry line=new VoucherEntry();line.setVoucherId(row.getId());line.setLineNo(i+1);line.setAccountCode(item.accountCode());line.setAccountName(item.accountName());line.setDirection(item.direction());line.setAmount(item.amount());entries.insert(line);}
                rows.add(row);
            }
            audit.log("VOUCHER_IMPORT","BATCH",request.batchId(),"导入"+rows.size()+"张凭证",actor);return rows;
        });
        // Redis是派生缓存；数据库提交后写缓存失败也不撤销已成功的ERP导入，下轮匹配会重建。
        for(Voucher row:imported) cacheAdd("voucher",row.getPeriod(),row.getId());
        return Map.of("imported",imported.size(),"voucherIds",imported.stream().map(Voucher::getId).toList());
    }
    public SourceDocument recognize(MultipartFile file,String period,String actor) {
        String imageUrl=files.store(file);
        try {
            OcrGateway.Result result=ocr.recognize(files.resolve(imageUrl));
            SourceDocument doc=new SourceDocument();doc.setPeriod(period);doc.setFileName(Optional.ofNullable(file.getOriginalFilename()).orElse("document"));
            doc.setImageUrl(imageUrl);doc.setContentHash(hash(files.resolve(imageUrl)));doc.setDocType(result.docType());
            if(!Set.of("INVOICE","BANK_RECEIPT","CONTRACT","APPROVAL","OTHER").contains(doc.getDocType())) throw new ApiException(422,"OCR返回未知单据类型");
            doc.setAmount(OcrDataCleaner.amount(result.amount()));if(doc.getAmount().signum()<=0) throw new ApiException(422,"单据金额必须大于0");
            doc.setDocumentDate(OcrDataCleaner.date(result.date()));doc.setSupplierName(result.supplierName());doc.setNormalizedSupplierName(names.normalize(result.supplierName()));
            doc.setInvoiceNo(result.invoiceNo());doc.setContractNo(result.contractNo());doc.setBankFlowNo(result.bankFlowNo());doc.setApprovalNo(result.approvalNo());
            doc.setSealPresent(result.sealPresent());doc.setExtractedFields(result.rawFields());doc.setOcrConfidence(result.confidence());doc.setStatus("PENDING");doc.setCreatedAt(LocalDateTime.now());
            tx.execute(status->{documents.insert(doc);audit.log("DOCUMENT_OCR","DOCUMENT",doc.getId(),"OCR完成，待匹配",actor);return null;});
            cacheAdd("document",period,doc.getId());return doc;
        } catch(RuntimeException e) { files.delete(imageUrl);throw e; }
    }
    public Page<Voucher> listVouchers(String period,String keyword,String status,long page,long size) {
        QueryWrapper<Voucher> q=new QueryWrapper<>();q.eq(period!=null&&!period.isBlank(),"period",period).eq(status!=null&&!status.isBlank(),"status",status);
        if(keyword!=null&&!keyword.isBlank()) q.and(w->w.like("voucher_no",keyword).or().like("supplier_name",keyword).or().like("invoice_no",keyword).or().like("contract_no",keyword));
        return vouchers.selectPage(new Page<>(page,size),q.orderByDesc("period").orderByAsc("voucher_sequence"));
    }
    public Page<SourceDocument> listDocuments(String period,String keyword,String status,long page,long size) {
        QueryWrapper<SourceDocument> q=new QueryWrapper<>();q.eq(period!=null&&!period.isBlank(),"period",period).eq(status!=null&&!status.isBlank(),"status",status);
        if(keyword!=null&&!keyword.isBlank()) q.and(w->w.like("file_name",keyword).or().like("supplier_name",keyword).or().like("invoice_no",keyword).or().like("contract_no",keyword));
        return documents.selectPage(new Page<>(page,size),q.orderByDesc("id"));
    }
    private void cacheAdd(String type,String period,Long id) {try{redis.opsForSet().add("archive:pending:"+type+":"+period,String.valueOf(id));}catch(RuntimeException ignored){/* 自动匹配前从数据库重建。 */}}
    private String field(String explicit,Map<String,Object> custom,String key) {return explicit!=null?explicit:custom==null?null:Objects.toString(custom.get(key),null);}
    public static int sequence(String voucherNo) {
        var matcher=Pattern.compile("(\\d+)$").matcher(voucherNo);
        if(!matcher.find()) throw new ApiException(400,"凭证号必须以数字序号结尾");
        try{return Integer.parseInt(matcher.group(1));}catch(NumberFormatException e){throw new ApiException(400,"凭证号序号过大");}
    }
    private String hash(java.nio.file.Path path) {
        try(var stream=Files.newInputStream(path)){MessageDigest digest=MessageDigest.getInstance("SHA-256");byte[] block=new byte[8192];for(int n;(n=stream.read(block))!=-1;)digest.update(block,0,n);return HexFormat.of().formatHex(digest.digest());}
        catch(Exception e){throw new ApiException(500,"文件摘要计算失败");}
    }
}
