package com.langchao.archive.engine;

import com.langchao.archive.util.OcrDataCleaner;

/** Levenshtein 编辑距离，滚动数组将空间复杂度降至 O(min(m,n))。 */
public final class NameSimilarity {
    private NameSimilarity() { }

    public static double similarity(String first, String second) {
        String left = OcrDataCleaner.normalizeName(first);
        String right = OcrDataCleaner.normalizeName(second);
        // 空值之间不能获得 100% 相似度，否则缺失客商的单据会被大规模错误匹配。
        if (left.isEmpty() || right.isEmpty()) {
            return 0;
        }
        if (left.equals(right)) {
            return 1;
        }
        int[] a = left.codePoints().toArray();
        int[] b = right.codePoints().toArray();
        if (a.length < b.length) {
            int[] temporary = a;
            a = b;
            b = temporary;
        }
        int[] previous = new int[b.length + 1];
        for (int index = 0; index <= b.length; index++) {
            previous[index] = index;
        }
        for (int row = 1; row <= a.length; row++) {
            int[] current = new int[b.length + 1];
            current[0] = row;
            for (int column = 1; column <= b.length; column++) {
                current[column] = Math.min(Math.min(current[column - 1] + 1, previous[column] + 1),
                    previous[column - 1] + (a[row - 1] == b[column - 1] ? 0 : 1));
            }
            previous = current;
        }
        return 1.0 - (double) previous[b.length] / Math.max(a.length, b.length);
    }
}
