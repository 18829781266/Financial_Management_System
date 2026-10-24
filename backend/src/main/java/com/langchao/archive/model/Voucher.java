package com.langchao.archive.model;

import com.baomidou.mybatisplus.annotation.*;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Map;

/** Voucher 核心持久化实体，金额统一使用 BigDecimal。 */
@Data
@TableName(value="voucher", autoResultMap=true)
public class Voucher {
    @TableId(type=IdType.AUTO)
    private Long id;
    private String sourceSystem;
    private String externalId;
    private String voucherNo;
    private Integer voucherSequence;
    private String period;
    private String summary;
    private BigDecimal amount;
    private String supplierName;
    private String normalizedSupplierName;
    private LocalDate voucherDate;
    private String invoiceNo;
    private String contractNo;
    private String bankFlowNo;
    private String approvalNo;
    @TableField(typeHandler=JacksonTypeHandler.class)
    private Map<String,Object> customFields;
    private String imageUrl;
    private Integer expectedAttachmentCount;
    private String status;
    private String missingReason;
    private LocalDateTime createdAt;
}
