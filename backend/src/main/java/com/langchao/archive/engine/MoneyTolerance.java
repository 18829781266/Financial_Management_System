package com.langchao.archive.engine;

import java.math.BigDecimal;

/** 使用 BigDecimal，禁止以 double 比较会计金额。 */
public final class MoneyTolerance {
    private MoneyTolerance() { }

    public static boolean within(BigDecimal expected, BigDecimal actual,
                                 BigDecimal absolute, BigDecimal relative) {
        if (expected == null || actual == null || absolute == null || relative == null) {
            return false;
        }
        if (absolute.signum() < 0 || relative.signum() < 0) {
            throw new IllegalArgumentException("金额容差不得为负");
        }
        // 两种容差任选满足一个即接受。相对容差以凭证期望金额绝对值为基数；零金额只能用绝对容差。
        BigDecimal allowed = absolute.max(expected.abs().multiply(relative));
        return expected.subtract(actual).abs().compareTo(allowed) <= 0;
    }
}
