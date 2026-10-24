package com.langchao.archive.model;

import com.baomidou.mybatisplus.annotation.*;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Map;

/** SourceDocument 核心持久化实体，金额统一使用 BigDecimal。 */
@Data
@TableName(value="source_document", autoResultMap=true)
public class SourceDocument {
    @TableId(type=IdType.AUTO)
    private Long id;
    private String period;
    private String docType;
    private String fileName;
    private String imageUrl;
    private String contentHash;
    private String invoiceNo;
    private String contractNo;
    private String bankFlowNo;
    private String approvalNo;
    private String supplierName;
    private String normalizedSupplierName;
    private BigDecimal amount;
    private LocalDate documentDate;
    private Boolean sealPresent;
    @TableField(typeHandler=JacksonTypeHandler.class)
    private Map<String,Object> extractedFields;
    private BigDecimal ocrConfidence;
    private String status;
    private LocalDateTime createdAt;
}
