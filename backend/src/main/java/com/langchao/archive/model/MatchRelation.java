package com.langchao.archive.model;

import com.baomidou.mybatisplus.annotation.*;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Map;

/** MatchRelation 核心持久化实体，金额统一使用 BigDecimal。 */
@Data
@TableName(value="match_relation", autoResultMap=true)
public class MatchRelation {
    @TableId(type=IdType.AUTO)
    private Long id;
    private String relationId;
    private Long voucherId;
    private Long docId;
    private BigDecimal allocatedAmount;
    private String matchType;
    private String ruleId;
    private BigDecimal confidenceScore;
    private String creator;
    private String reason;
    @TableField(typeHandler=JacksonTypeHandler.class)
    private Map<String,Object> explanation;
    private LocalDateTime createdAt;
}
