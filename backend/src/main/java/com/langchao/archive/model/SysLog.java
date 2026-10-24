package com.langchao.archive.model;

import com.baomidou.mybatisplus.annotation.*;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Map;

/** SysLog 核心持久化实体，金额统一使用 BigDecimal。 */
@Data
@TableName(value="sys_log", autoResultMap=true)
public class SysLog {
    @TableId(type=IdType.AUTO)
    private Long id;
    private String action;
    private String targetType;
    private String targetId;
    private String detail;
    private String operator;
    private LocalDateTime createdAt;
}
