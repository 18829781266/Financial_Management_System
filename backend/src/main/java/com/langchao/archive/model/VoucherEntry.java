package com.langchao.archive.model;

import com.baomidou.mybatisplus.annotation.*;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Map;

/** VoucherEntry 核心持久化实体，金额统一使用 BigDecimal。 */
@Data
@TableName(value="voucher_entry", autoResultMap=true)
public class VoucherEntry {
    @TableId(type=IdType.AUTO)
    private Long id;
    private Long voucherId;
    private Integer lineNo;
    private String accountCode;
    private String accountName;
    private String direction;
    private BigDecimal amount;
}
