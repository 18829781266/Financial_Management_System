package com.langchao.archive.engine;

import com.langchao.archive.model.MatchRule;
import com.langchao.archive.model.SourceDocument;
import com.langchao.archive.model.Voucher;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class MatchingEngineTest {
    private final MatchingEngine engine = new MatchingEngine();

    @Test
    void acceptOneCentTailDifferenceUsingBigDecimal() {
        Voucher voucher = voucher(1, "100.00", "阿里云");
        SourceDocument document = document(10, "100.01", "阿里云有限公司");
        List<MatchingEngine.Proposal> result = engine.match(List.of(voucher), List.of(document), List.of(rule("R06", 6)));
        assertEquals(1, result.size());
        assertEquals("0.01", result.get(0).explanation().get("amountDelta"));
        assertEquals(List.of(10L), result.get(0).documentIds());
    }

    @Test
    void nameSuffixMatchesAfterNormalization() {
        assertEquals(1, NameSimilarity.similarity("阿里云", "阿里云有限公司"));
        assertEquals(0, NameSimilarity.similarity("", ""));
        assertTrue(NameSimilarity.similarity("北京华新科技", "北京华新科枝") > 0.8);
    }

    @Test
    void approvedSemanticAliasMatches() {
        Voucher voucher = voucher(1, "100", "阿里云");
        SourceDocument document = document(10, "100", "阿里云计算有限公司");
        // 采集服务已通过 Redis 审核映射归一，保留原始 OCR 名称用于审计。
        document.setNormalizedSupplierName("阿里云");
        assertEquals(1, engine.match(List.of(voucher), List.of(document), List.of(rule("R06", 6))).size());
    }

    @Test
    void aggregateMultipleInvoicesIncludingOneCentTail() {
        Voucher voucher = voucher(1, "300.00", "华新科技");
        List<SourceDocument> documents = List.of(document(10, "100.00", "华新科技有限公司"),
            document(11, "200.01", "华新科技有限公司"));
        List<MatchingEngine.Proposal> result = engine.match(List.of(voucher), documents, List.of(rule("R07", 7)));
        assertEquals(1, result.size());
        assertEquals(List.of(10L, 11L), result.get(0).documentIds());
        assertEquals("ONE_VOUCHER_MANY_DOCUMENTS", result.get(0).explanation().get("algorithm"));
    }

    @Test
    void aggregateSeveralVouchersToOneSource() {
        List<Voucher> vouchers = List.of(voucher(1, "100.00", "华新"), voucher(2, "200.00", "华新"));
        List<MatchingEngine.Proposal> result = engine.match(vouchers, List.of(document(10, "300.00", "华新")), List.of(rule("R07", 7)));
        assertEquals(1, result.size());
        assertEquals(List.of(1L, 2L), result.get(0).voucherIds());
        assertEquals("MANY_VOUCHERS_ONE_DOCUMENT", result.get(0).explanation().get("algorithm"));
    }

    @Test
    void summaryRespectsConfiguredCandidateAndNodeBudgets() {
        Voucher voucher = voucher(1, "300", "华新");
        List<SourceDocument> documents = List.of(document(10, "100", "华新"),
            document(11, "200", "华新"), document(12, "500", "华新"));
        MatchRule summary = rule("R07", 7);
        assertEquals(1, engine.match(List.of(voucher), documents, List.of(summary)).size());
        summary.setConditions(Map.of("maxCandidates", 2));
        assertTrue(engine.match(List.of(voucher), documents, List.of(summary)).isEmpty());
        summary.setConditions(Map.of("maxCandidates", 3, "maxNodes", 1));
        assertTrue(engine.match(List.of(voucher), documents, List.of(summary)).isEmpty());
    }

    @Test
    void summaryRejectsInvalidSearchBudgetConfiguration() {
        MatchRule summary = rule("R07", 7);
        summary.setConditions(Map.of("maxNodes", 100001));
        assertThrows(IllegalArgumentException.class, () -> engine.match(List.of(), List.of(), List.of(summary)));
        summary.setConditions(Map.of("maxCandidates", 21));
        assertThrows(IllegalArgumentException.class, () -> engine.match(List.of(), List.of(), List.of(summary)));
    }

    @Test
    void rejectAmbiguousSummaryRatherThanTakeFirstSubset() {
        Voucher voucher = voucher(1, "300", "华新");
        List<SourceDocument> documents = List.of(document(10, "100", "华新"), document(11, "200", "华新"),
            document(12, "150", "华新"), document(13, "150", "华新"));
        assertTrue(engine.match(List.of(voucher), documents, List.of(rule("R07", 7))).isEmpty());
    }

    @Test
    void doNotReuseDocumentForTwoVouchers() {
        List<Voucher> vouchers = List.of(voucher(1, "100", "华新"), voucher(2, "100", "华新"));
        assertTrue(engine.match(vouchers, List.of(document(10, "100", "华新")), List.of(rule("R06", 6))).isEmpty());
    }

    @Test
    void exactIdentifierHasPriorityOverCompositeCandidate() {
        Voucher voucher = voucher(1, "100", "华新");
        voucher.setInvoiceNo("00123");
        SourceDocument exact = document(10, "100", "华新");
        exact.setInvoiceNo("00123");
        List<MatchingEngine.Proposal> result = engine.match(List.of(voucher), List.of(exact, document(11, "100", "华新")),
            List.of(rule("R06", 6), rule("R01", 1)));
        assertEquals(1, result.size());
        assertEquals("R01", result.get(0).ruleId());
        assertEquals(List.of(10L), result.get(0).documentIds());
    }

    @Test
    void rejectIdentifierMismatchAndAmountMismatch() {
        Voucher voucher = voucher(1, "100", "华新");
        voucher.setInvoiceNo("00123");
        SourceDocument document = document(10, "100", "华新");
        document.setInvoiceNo("123");
        assertTrue(engine.match(List.of(voucher), List.of(document), List.of(rule("R01", 1))).isEmpty());
        document.setInvoiceNo("00123");
        document.setAmount(new BigDecimal("101"));
        assertTrue(engine.match(List.of(voucher), List.of(document), List.of(rule("R01", 1))).isEmpty());
    }

    @Test
    void blankKeysAndMissingNamesNeverMatch() {
        Voucher voucher = voucher(1, "100", "");
        SourceDocument document = document(10, "100", "");
        assertTrue(engine.match(List.of(voucher), List.of(document), List.of(rule("R01", 1), rule("R06", 6))).isEmpty());
    }

    @Test
    void respectDatePeriodAndLockedStatus() {
        Voucher voucher = voucher(1, "100", "华新");
        SourceDocument document = document(10, "100", "华新");
        document.setDocumentDate(LocalDate.of(2026, 9, 1));
        assertTrue(engine.match(List.of(voucher), List.of(document), List.of(rule("R06", 6))).isEmpty());
        document.setDocumentDate(voucher.getVoucherDate());
        document.setPeriod("2026-09");
        assertTrue(engine.match(List.of(voucher), List.of(document), List.of(rule("R06", 6))).isEmpty());
        document.setPeriod(voucher.getPeriod());
        document.setStatus("LOCKED");
        assertTrue(engine.match(List.of(voucher), List.of(document), List.of(rule("R06", 6))).isEmpty());
    }

    @Test
    void relativeToleranceAndInclusiveBoundary() {
        assertTrue(MoneyTolerance.within(new BigDecimal("100"), new BigDecimal("100.05"), new BigDecimal("0.05"), BigDecimal.ZERO));
        assertFalse(MoneyTolerance.within(new BigDecimal("100"), new BigDecimal("100.06"), new BigDecimal("0.05"), BigDecimal.ZERO));
        assertTrue(MoneyTolerance.within(new BigDecimal("10000"), new BigDecimal("10001"), BigDecimal.ZERO, new BigDecimal("0.0001")));
        assertFalse(MoneyTolerance.within(BigDecimal.ZERO, new BigDecimal("0.01"), BigDecimal.ZERO, new BigDecimal("0.01")));
    }

    @Test
    void rejectedConfidenceAndDisabledRuleDoNotConsumeCandidates() {
        MatchRule disabled = rule("R06", 6);
        disabled.setEnabled(false);
        assertTrue(engine.match(List.of(voucher(1, "100", "华新")), List.of(document(10, "100", "华新")), List.of(disabled)).isEmpty());
        MatchRule exact = rule("R01", 1);
        exact.setThreshold(BigDecimal.ONE);
        Voucher voucher = voucher(1, "100", "华新");
        voucher.setInvoiceNo("123");
        SourceDocument document = document(10, "100", "华新");
        document.setInvoiceNo("123");
        List<MatchingEngine.Proposal> result = engine.match(List.of(voucher), List.of(document), List.of(exact, rule("R06", 6)));
        assertEquals("R06", result.get(0).ruleId());
    }

    @Test
    void rejectDuplicateInputIds() {
        assertThrows(IllegalArgumentException.class, () -> engine.match(List.of(voucher(1, "100", "华新"),
            voucher(1, "100", "华新")), List.of(), List.of(rule("R06", 6))));
    }

    private static MatchRule rule(String id, int priority) {
        MatchRule rule = new MatchRule();
        rule.setRuleId(id);
        rule.setPriority(priority);
        rule.setEnabled(true);
        rule.setThreshold(new BigDecimal("0.85"));
        rule.setConditions(Map.of("absTolerance", "0.05", "nameThreshold", "0.85", "dateWindowDays", 7));
        return rule;
    }

    private static Voucher voucher(long id, String amount, String supplier) {
        Voucher voucher = new Voucher();
        voucher.setId(id);
        voucher.setAmount(new BigDecimal(amount));
        voucher.setSupplierName(supplier);
        voucher.setPeriod("2026-10");
        voucher.setVoucherDate(LocalDate.of(2026, 10, 20));
        voucher.setStatus("PENDING");
        return voucher;
    }

    private static SourceDocument document(long id, String amount, String supplier) {
        SourceDocument document = new SourceDocument();
        document.setId(id);
        document.setAmount(new BigDecimal(amount));
        document.setSupplierName(supplier);
        document.setPeriod("2026-10");
        document.setDocumentDate(LocalDate.of(2026, 10, 20));
        document.setStatus("PENDING");
        return document;
    }
}
