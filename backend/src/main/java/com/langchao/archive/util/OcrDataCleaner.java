package com.langchao.archive.util;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.Normalizer;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.Locale;
import java.util.regex.Pattern;

/** OCR 字段清洗。遇到歧义金额和无效日期拒绝入库，避免“清洗”产生另一笔金额。 */
public final class OcrDataCleaner {
    private static final Pattern MONEY = Pattern.compile("[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?");
    private static final Pattern LEGAL_SUFFIX = Pattern.compile("(?:股份有限公司|集团有限公司|有限责任公司|股份公司|有限公司|集团|股份|公司)$");
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("uuuu-M-d", Locale.ROOT)
        .withResolverStyle(ResolverStyle.STRICT);

    private OcrDataCleaner() { }

    public static BigDecimal amount(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("金额不能为空");
        }
        String value = Normalizer.normalize(raw, Normalizer.Form.NFKC).trim()
            .replaceAll("(?i)(?:人民币|RMB|CNY|[¥￥元圆])", "").replaceAll("\\s+", "");
        boolean parenthesized = value.startsWith("(") && value.endsWith(")");
        if (parenthesized) {
            value = value.substring(1, value.length() - 1);
            if (value.startsWith("-") || value.startsWith("+")) {
                throw new IllegalArgumentException("金额的正负号有歧义");
            }
        }
        // 只接受一个完整数字；不可把“100.00 / 200.00”简单删除非数字字符后拼成新金额。
        if (!MONEY.matcher(value).matches()) {
            throw new IllegalArgumentException("金额格式无效或含有多个金额: " + raw);
        }
        BigDecimal result = new BigDecimal(value.replace(",", ""));
        if (result.precision() - result.scale() > 16) {
            throw new IllegalArgumentException("金额超出 DECIMAL(18,2) 范围");
        }
        return (parenthesized ? result.negate() : result).setScale(2, RoundingMode.UNNECESSARY);
    }

    public static LocalDate date(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("日期不能为空");
        }
        String value = Normalizer.normalize(raw, Normalizer.Form.NFKC).trim()
            .replace("年", "-").replace("月", "-").replace("日", "")
            .replace('/', '-').replace('.', '-');
        try {
            if (value.matches("\\d{8}")) {
                return LocalDate.parse(value, DateTimeFormatter.BASIC_ISO_DATE);
            }
            return LocalDate.parse(value, DATE);
        } catch (DateTimeParseException exception) {
            throw new IllegalArgumentException("日期无效，要求真实的年月日: " + raw, exception);
        }
    }

    public static String normalizeName(String raw) {
        if (raw == null || raw.isBlank()) {
            return "";
        }
        String result = Normalizer.normalize(raw, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT)
            .replaceAll("[\\s\\p{Punct}，。、《》【】·]+", "");
        // 仅移除末尾法律组织形式，不删除名称中间的“集团/股份”，防止不同主体误归一。
        String previous;
        do {
            previous = result;
            result = LEGAL_SUFFIX.matcher(result).replaceFirst("");
        } while (!previous.equals(result));
        return result;
    }
}
