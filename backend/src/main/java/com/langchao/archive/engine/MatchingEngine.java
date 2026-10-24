package com.langchao.archive.engine;

import com.langchao.archive.model.MatchRule;
import com.langchao.archive.model.SourceDocument;
import com.langchao.archive.model.Voucher;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;

/**
 * 可配置规则引擎：策略负责候选计算；责任链按优先级消费资源。
 * 此类只计算建议，不替代数据库事务、行锁和 Redis 分布式锁。
 */
@Component
public class MatchingEngine {
    public record Proposal(List<Long> voucherIds, List<Long> documentIds, String ruleId,
                           BigDecimal confidenceScore, Map<String, Object> explanation) { }

    private interface Strategy {
        List<Proposal> propose(Context context, MatchRule rule, Options options);
    }

    private final Map<String, Strategy> strategies = Map.of(
        "R01", new ExactStrategy(Voucher::getInvoiceNo, SourceDocument::getInvoiceNo),
        "R02", new ExactStrategy(Voucher::getContractNo, SourceDocument::getContractNo),
        "R03", new ExactStrategy(Voucher::getBankFlowNo, SourceDocument::getBankFlowNo),
        "R04", new ExactStrategy(Voucher::getApprovalNo, SourceDocument::getApprovalNo),
        "R05", new CompositeStrategy(true),
        "R06", new CompositeStrategy(false),
        "R07", new SummaryStrategy());

    public List<Proposal> match(List<Voucher> vouchers, List<SourceDocument> documents, List<MatchRule> rules) {
        Objects.requireNonNull(vouchers, "vouchers");
        Objects.requireNonNull(documents, "documents");
        Objects.requireNonNull(rules, "rules");
        Context context = new Context(vouchers, documents);
        List<MatchRule> ordered = rules.stream().filter(rule -> Boolean.TRUE.equals(rule.getEnabled()))
            .sorted(Comparator.comparing(MatchRule::getPriority, Comparator.nullsLast(Integer::compareTo))
                .thenComparing(MatchRule::getRuleId)).toList();
        RuleNode head = null;
        // 反向组链；运行时 R01..R07 的实际先后由经过审核的 priority 控制。
        for (int index = ordered.size() - 1; index >= 0; index--) {
            MatchRule rule = ordered.get(index);
            Strategy strategy = strategies.get(rule.getRuleId());
            if (strategy == null) {
                throw new IllegalArgumentException("不支持的规则: " + rule.getRuleId());
            }
            head = new RuleNode(rule, strategy, head);
        }
        if (head != null) {
            head.execute(context);
        }
        return List.copyOf(context.accepted);
    }

    private record RuleNode(MatchRule rule, Strategy strategy, RuleNode next) {
        private void execute(Context context) {
            Options options = new Options(rule);
            List<Proposal> raw = strategy.propose(context, rule, options).stream()
                .filter(proposal -> proposal.confidenceScore().compareTo(options.threshold) >= 0).toList();
            // 同轮多个凭证争用同一单据时，所有冲突候选留在异常池，禁止按查询顺序“先到先得”。
            Map<Long, Integer> voucherUses = new HashMap<>();
            Map<Long, Integer> documentUses = new HashMap<>();
            for (Proposal proposal : raw) {
                proposal.voucherIds().forEach(id -> voucherUses.merge(id, 1, Integer::sum));
                proposal.documentIds().forEach(id -> documentUses.merge(id, 1, Integer::sum));
            }
            for (Proposal proposal : raw) {
                boolean conflict = proposal.voucherIds().stream().anyMatch(id -> voucherUses.get(id) > 1)
                    || proposal.documentIds().stream().anyMatch(id -> documentUses.get(id) > 1);
                if (conflict) {
                    context.blockedVouchers.addAll(proposal.voucherIds());
                    context.blockedDocuments.addAll(proposal.documentIds());
                }
            }
            for (Proposal proposal : raw) {
                if (proposal.voucherIds().stream().noneMatch(context.blockedVouchers::contains)
                    && proposal.documentIds().stream().noneMatch(context.blockedDocuments::contains)) {
                    context.accepted.add(proposal);
                    context.usedVouchers.addAll(proposal.voucherIds());
                    context.usedDocuments.addAll(proposal.documentIds());
                }
            }
            if (next != null) {
                next.execute(context);
            }
        }
    }

    private static final class Context {
        private final List<Voucher> vouchers;
        private final List<SourceDocument> documents;
        private final Set<Long> usedVouchers = new HashSet<>();
        private final Set<Long> usedDocuments = new HashSet<>();
        private final Set<Long> blockedVouchers = new HashSet<>();
        private final Set<Long> blockedDocuments = new HashSet<>();
        private final List<Proposal> accepted = new ArrayList<>();

        private Context(List<Voucher> vouchers, List<SourceDocument> documents) {
            if (vouchers.stream().anyMatch(value -> value.getId() == null)
                || vouchers.stream().map(Voucher::getId).distinct().count() != vouchers.size()
                || documents.stream().anyMatch(value -> value.getId() == null)
                || documents.stream().map(SourceDocument::getId).distinct().count() != documents.size()) {
                throw new IllegalArgumentException("匹配输入必须有唯一且非空的数据库主键");
            }
            this.vouchers = List.copyOf(vouchers);
            this.documents = List.copyOf(documents);
        }

        private List<Voucher> vouchers() {
            return vouchers.stream().filter(voucher -> pending(voucher.getStatus()))
                .filter(voucher -> !usedVouchers.contains(voucher.getId()) && !blockedVouchers.contains(voucher.getId())).toList();
        }

        private List<SourceDocument> documents() {
            return documents.stream().filter(document -> pending(document.getStatus()))
                .filter(document -> !usedDocuments.contains(document.getId()) && !blockedDocuments.contains(document.getId())).toList();
        }

        private static boolean pending(String status) {
            return status == null || "PENDING".equals(status);
        }

        private void ambiguous(Voucher voucher, List<SourceDocument> candidates) {
            blockedVouchers.add(voucher.getId());
            candidates.forEach(document -> blockedDocuments.add(document.getId()));
        }
    }

    private static final class Options {
        private final BigDecimal absolute;
        private final BigDecimal relative;
        private final double nameThreshold;
        private final int dateWindowDays;
        private final int maxCandidates;
        private final int maxNodes;
        private final BigDecimal threshold;

        private Options(MatchRule rule) {
            Map<String, Object> values = rule.getConditions() == null ? Map.of() : rule.getConditions();
            absolute = decimal(values, "absTolerance", "0.05");
            relative = decimal(values, "relativeTolerance", "0");
            nameThreshold = decimal(values, "nameThreshold", "0.85").doubleValue();
            dateWindowDays = decimal(values, "dateWindowDays", "7").intValueExact();
            // 配置必须实际约束搜索成本。预算用尽时不能据此宣称已找到唯一组合。
            maxCandidates = decimal(values, "maxCandidates", "20").intValueExact();
            maxNodes = decimal(values, "maxNodes", "100000").intValueExact();
            threshold = rule.getThreshold() == null ? new BigDecimal("0.85") : rule.getThreshold();
            if (absolute.signum() < 0 || relative.signum() < 0 || relative.compareTo(BigDecimal.ONE) > 0
                || nameThreshold < 0 || nameThreshold > 1 || dateWindowDays < 0 || dateWindowDays > 366
                || maxCandidates < 2 || maxCandidates > 20 || maxNodes < 1 || maxNodes > 100_000
                || threshold.signum() < 0 || threshold.compareTo(BigDecimal.ONE) > 0) {
                throw new IllegalArgumentException("规则阈值、日期窗口或金额容差超出允许范围");
            }
        }

        private static BigDecimal decimal(Map<String, Object> values, String key, String fallback) {
            Object value = values.get(key);
            return new BigDecimal(value == null ? fallback : value.toString());
        }

        private boolean amount(BigDecimal expected, BigDecimal actual) {
            return MoneyTolerance.within(expected, actual, absolute, relative);
        }

        private boolean date(LocalDate first, LocalDate second) {
            return first != null && second != null && Math.abs(ChronoUnit.DAYS.between(first, second)) <= dateWindowDays;
        }
    }

    private record ExactStrategy(Function<Voucher, String> voucherKey,
                                 Function<SourceDocument, String> documentKey) implements Strategy {
        @Override
        public List<Proposal> propose(Context context, MatchRule rule, Options options) {
            List<Proposal> result = new ArrayList<>();
            for (Voucher voucher : context.vouchers()) {
                String key = voucherKey.apply(voucher);
                if (key == null || key.isBlank()) {
                    continue;
                }
                List<SourceDocument> candidates = context.documents().stream()
                    .filter(document -> samePeriod(voucher, document))
                    // 精确标识符严格 String.equals；保留前导零，不做数字化或模糊比较。
                    .filter(document -> key.equals(documentKey.apply(document)))
                    // 标识符相同仍必须核对金额，不能因 OCR 号串碰撞而绕过金额校验。
                    .filter(document -> options.amount(voucher.getAmount(), document.getAmount())).toList();
                if (candidates.size() == 1) {
                    SourceDocument document = candidates.get(0);
                    result.add(proposal(List.of(voucher.getId()), List.of(document.getId()), rule,
                        new BigDecimal("0.99"), voucher.getAmount(), document.getAmount(), "EXACT_IDENTIFIER"));
                } else if (candidates.size() > 1) {
                    context.ambiguous(voucher, candidates);
                }
            }
            return result;
        }
    }

    private record CompositeStrategy(boolean exactName) implements Strategy {
        @Override
        public List<Proposal> propose(Context context, MatchRule rule, Options options) {
            List<Proposal> result = new ArrayList<>();
            for (Voucher voucher : context.vouchers()) {
                List<SourceDocument> candidates = context.documents().stream()
                    .filter(document -> samePeriod(voucher, document))
                    .filter(document -> options.amount(voucher.getAmount(), document.getAmount()))
                    .filter(document -> options.date(voucher.getVoucherDate(), document.getDocumentDate()))
                    .filter(document -> {
                        double nameScore = nameScore(voucher, document);
                        return exactName ? nameScore == 1 : nameScore >= options.nameThreshold;
                    }).toList();
                if (candidates.size() == 1) {
                    SourceDocument document = candidates.get(0);
                    // 金额、名称、日期先过硬门槛再计分；允许范围内的尾差与日期偏移降低置信度。
                    BigDecimal allowed = options.absolute.max(voucher.getAmount().abs().multiply(options.relative));
                    double amountQuality = allowed.signum() == 0 ? 1 : 1 - 0.1 * voucher.getAmount()
                        .subtract(document.getAmount()).abs().divide(allowed, 8, RoundingMode.HALF_UP).doubleValue();
                    long dayDelta = Math.abs(ChronoUnit.DAYS.between(voucher.getVoucherDate(), document.getDocumentDate()));
                    double dateQuality = 1 - 0.1 * dayDelta / (options.dateWindowDays + 1.0);
                    BigDecimal score = BigDecimal.valueOf(0.45 * amountQuality + 0.35 * nameScore(voucher, document) + 0.2 * dateQuality)
                        .setScale(4, RoundingMode.HALF_UP);
                    result.add(proposal(List.of(voucher.getId()), List.of(document.getId()), rule, score,
                        voucher.getAmount(), document.getAmount(), exactName ? "AMOUNT_NAME_DATE" : "FUZZY_NAME_DATE"));
                } else if (candidates.size() > 1) {
                    context.ambiguous(voucher, candidates);
                }
            }
            return result;
        }
    }

    private static final class SummaryStrategy implements Strategy {
        @Override
        public List<Proposal> propose(Context context, MatchRule rule, Options options) {
            List<Proposal> result = new ArrayList<>();
            for (Voucher voucher : context.vouchers()) {
                List<SourceDocument> candidates = context.documents().stream()
                    .filter(document -> eligible(voucher, document, options))
                    .filter(document -> document.getAmount() != null && document.getAmount().signum() > 0).toList();
                List<Long> ids = subset(candidates, SourceDocument::getId, SourceDocument::getAmount, voucher.getAmount(), options);
                if (!ids.isEmpty()) {
                    BigDecimal sum = candidates.stream().filter(document -> ids.contains(document.getId()))
                        .map(SourceDocument::getAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
                    result.add(proposal(List.of(voucher.getId()), ids, rule, new BigDecimal("0.96"),
                        voucher.getAmount(), sum, "ONE_VOUCHER_MANY_DOCUMENTS"));
                }
            }
            for (SourceDocument document : context.documents()) {
                List<Voucher> candidates = context.vouchers().stream()
                    .filter(voucher -> eligible(voucher, document, options))
                    .filter(voucher -> voucher.getAmount() != null && voucher.getAmount().signum() > 0).toList();
                List<Long> ids = subset(candidates, Voucher::getId, Voucher::getAmount, document.getAmount(), options);
                if (!ids.isEmpty()) {
                    BigDecimal sum = candidates.stream().filter(voucher -> ids.contains(voucher.getId()))
                        .map(Voucher::getAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
                    result.add(proposal(ids, List.of(document.getId()), rule, new BigDecimal("0.96"),
                        sum, document.getAmount(), "MANY_VOUCHERS_ONE_DOCUMENT"));
                }
            }
            return result;
        }

        private static boolean eligible(Voucher voucher, SourceDocument document, Options options) {
            return samePeriod(voucher, document) && options.date(voucher.getVoucherDate(), document.getDocumentDate())
                && nameScore(voucher, document) >= options.nameThreshold;
        }

        private static <T> List<Long> subset(List<T> items, Function<T, Long> id,
                                             Function<T, BigDecimal> amount, BigDecimal target, Options options) {
            if (target == null || target.signum() <= 0 || items.size() < 2 || items.size() > options.maxCandidates) {
                return List.of();
            }
            SubsetSearch<T> search = new SubsetSearch<>(items, id, amount, target, options);
            search.visit(0, BigDecimal.ZERO, new ArrayList<>());
            // 预算耗尽不能宣称“唯一解”；存在两个可行组合时同样转人工，避免任意选一组。
            return !search.exhausted && search.solutions.size() == 1 ? search.solutions.get(0) : List.of();
        }

        private static final class SubsetSearch<T> {
            private final List<T> items;
            private final Function<T, Long> id;
            private final Function<T, BigDecimal> amount;
            private final BigDecimal target;
            private final Options options;
            private final List<List<Long>> solutions = new ArrayList<>();
            private int nodes;
            private boolean exhausted;

            private SubsetSearch(List<T> items, Function<T, Long> id, Function<T, BigDecimal> amount,
                                 BigDecimal target, Options options) {
                this.items = items;
                this.id = id;
                this.amount = amount;
                this.target = target;
                this.options = options;
            }

            private void visit(int index, BigDecimal sum, List<Long> selected) {
                if (++nodes > options.maxNodes) {
                    exhausted = true;
                    return;
                }
                if (solutions.size() >= 2 || exhausted) {
                    return;
                }
                if (index == items.size()) {
                    if (selected.size() >= 2 && options.amount(target, sum)) {
                        solutions.add(List.copyOf(selected));
                    }
                    return;
                }
                BigDecimal allowed = options.absolute.max(target.abs().multiply(options.relative));
                if (sum.compareTo(target.add(allowed)) > 0) {
                    return;
                }
                T item = items.get(index);
                selected.add(id.apply(item));
                visit(index + 1, sum.add(amount.apply(item)), selected);
                selected.remove(selected.size() - 1);
                visit(index + 1, sum, selected);
            }
        }
    }

    private static boolean samePeriod(Voucher voucher, SourceDocument document) {
        return voucher.getPeriod() != null && !voucher.getPeriod().isBlank()
            && voucher.getPeriod().equals(document.getPeriod());
    }

    private static double nameScore(Voucher voucher, SourceDocument document) {
        String first = voucher.getNormalizedSupplierName();
        String second = document.getNormalizedSupplierName();
        return NameSimilarity.similarity(first == null || first.isBlank() ? voucher.getSupplierName() : first,
            second == null || second.isBlank() ? document.getSupplierName() : second);
    }

    private static Proposal proposal(List<Long> vouchers, List<Long> documents, MatchRule rule,
                                     BigDecimal confidence, BigDecimal expected, BigDecimal actual, String kind) {
        Map<String, Object> explanation = new LinkedHashMap<>();
        explanation.put("algorithm", kind);
        explanation.put("expectedAmount", expected.toPlainString());
        explanation.put("actualAmount", actual.toPlainString());
        explanation.put("amountDelta", expected.subtract(actual).abs().toPlainString());
        explanation.put("ruleVersion", rule.getVersion() == null ? 1 : rule.getVersion());
        return new Proposal(List.copyOf(vouchers), List.copyOf(documents), rule.getRuleId(), confidence, explanation);
    }
}
