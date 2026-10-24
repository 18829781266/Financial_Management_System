package com.langchao.archive.util;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.math.BigDecimal;
import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class OcrDataCleanerTest {
    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "¥1,234.56|1234.56", "人民币 88.01 元|88.01", "￥１２３．４５|123.45",
        "RMB 0.01|0.01", "(¥20.10)|-20.10", "-18.01|-18.01", "0|0.00"
    })
    void cleanCurrencyWithoutLosingCents(String input, String expected) {
        assertEquals(new BigDecimal(expected), OcrDataCleaner.amount(input));
    }

    @Test
    void rejectAmbiguousOrMalformedAmounts() {
        for (String input : new String[]{"100.00 / 200.00", "1,23.00", "1.001", "1e3", "(-20)", "", "abc"}) {
            assertThrows(IllegalArgumentException.class, () -> OcrDataCleaner.amount(input), input);
        }
        assertThrows(IllegalArgumentException.class, () -> OcrDataCleaner.amount(null));
    }

    @ParameterizedTest
    @CsvSource({"2026年10月2日,2026-10-02", "2026/10/02,2026-10-02", "20261002,2026-10-02", "2026.10.2,2026-10-02"})
    void normalizeDates(String input, String expected) {
        assertEquals(LocalDate.parse(expected), OcrDataCleaner.date(input));
    }

    @Test
    void rejectImpossibleDates() {
        assertThrows(IllegalArgumentException.class, () -> OcrDataCleaner.date("2026-02-29"));
        assertThrows(IllegalArgumentException.class, () -> OcrDataCleaner.date("2026-13-01"));
    }

    @Test
    void removeLegalSuffixOnly() {
        assertEquals("阿里云", OcrDataCleaner.normalizeName("阿里云有限公司"));
        assertEquals("华北", OcrDataCleaner.normalizeName(" 华北集团股份有限公司 "));
        assertEquals("集团研究院", OcrDataCleaner.normalizeName("集团研究院有限公司"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void normalizeApprovedAliasFromRedis() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        HashOperations<String, Object, Object> hash = mock(HashOperations.class);
        when(redis.opsForHash()).thenReturn(hash);
        when(hash.get(SupplierNormalizer.ALIAS_KEY, "阿里云计算")).thenReturn("阿里云");
        assertEquals("阿里云", new SupplierNormalizer(redis).normalize("阿里云计算有限公司"));
        verify(hash).get(SupplierNormalizer.ALIAS_KEY, "阿里云计算");
    }
}
