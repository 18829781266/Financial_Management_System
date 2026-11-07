package com.langchao.archive.model;

import com.baomidou.mybatisplus.annotation.*;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Map;

/** MatchRule 核心持久化实体，金额统一使用 BigDecimal。 */
@Data
@TableName(value="match_rule", autoResultMap=true)
public class MatchRule {
    @TableId(type=IdType.AUTO)
    private Long id;
    private String ruleId;
    private String ruleName;
    private Integer priority;
    private String matchType;
    private BigDecimal threshold;
    @TableField(typeHandler=JacksonTypeHandler.class)
    private Map<String,Object> conditions;
    private Boolean enabled;
    private Integer version;
}
