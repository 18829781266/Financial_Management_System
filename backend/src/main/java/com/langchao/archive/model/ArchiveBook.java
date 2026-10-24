package com.langchao.archive.model;

import com.baomidou.mybatisplus.annotation.*;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Map;

/** ArchiveBook 核心持久化实体，金额统一使用 BigDecimal。 */
@Data
@TableName(value="archive_book", autoResultMap=true)
public class ArchiveBook {
    @TableId(type=IdType.AUTO)
    private Long id;
    private String period;
    private String startVoucherNo;
    private String endVoucherNo;
    private Integer startVoucherSequence;
    private Integer endVoucherSequence;
    private String pdfUrl;
    private String hashCode;
    private String status;
    private Integer voucherCount;
    private Integer documentCount;
    private String creator;
    private LocalDateTime createdAt;
}
