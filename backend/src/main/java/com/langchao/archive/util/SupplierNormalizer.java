package com.langchao.archive.util;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/** Redis 标准客商名称映射：HSET ocr:supplier:aliases 阿里云计算 阿里云。 */
@Component
public class SupplierNormalizer {
    public static final String ALIAS_KEY = "ocr:supplier:aliases";
    private final StringRedisTemplate redis;

    public SupplierNormalizer(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public String normalize(String value) {
        String normalized = OcrDataCleaner.normalizeName(value);
        if (normalized.isEmpty()) {
            return normalized;
        }
        // 由经审核的映射库处理“阿里云计算”这类业务别名，不以随意截断名称代替实体识别。
        Object alias = redis.opsForHash().get(ALIAS_KEY, normalized);
        return alias == null ? normalized : OcrDataCleaner.normalizeName(alias.toString());
    }
}
