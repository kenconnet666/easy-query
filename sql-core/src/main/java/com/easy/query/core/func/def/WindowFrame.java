package com.easy.query.core.func.def;

import com.easy.query.core.exception.EasyQueryInvalidOperationException;

/**
 * fork：窗口的 frame 子句（{@code ROWS BETWEEN … AND …} / {@code RANGE BETWEEN … AND …}）。
 * <pre>{@code
 * // 累计和：从分区第一行到当前行
 * expression.sumOver(o.amount()).partitionBy(o.userId()).orderBy(o.id()).rows(WindowFrame.Bound.unboundedPreceding(), WindowFrame.Bound.currentRow())
 * // 移动平均：前两行到当前行
 * expression.avgOver(o.amount()).over().orderBy(o.id()).rows(WindowFrame.Bound.preceding(2), WindowFrame.Bound.currentRow())
 * }</pre>
 * 偏移量只接受非负整数，直接写进 SQL（不是参数）。RANGE 带偏移量时各库对 ORDER BY 列类型的要求不同，由数据库校验。
 */
public final class WindowFrame {
    private final String unit;
    private final Bound start;
    private final Bound end;

    private WindowFrame(String unit, Bound start, Bound end) {
        this.unit = unit;
        this.start = start;
        this.end = end;
    }

    public static WindowFrame rows(Bound start, Bound end) {
        return new WindowFrame("ROWS", start, end);
    }

    public static WindowFrame range(Bound start, Bound end) {
        return new WindowFrame("RANGE", start, end);
    }

    public String toSQL() {
        return unit + " BETWEEN " + start.sql + " AND " + end.sql;
    }

    /** frame 的一端 */
    public static final class Bound {
        private static final Bound UNBOUNDED_PRECEDING = new Bound("UNBOUNDED PRECEDING");
        private static final Bound CURRENT_ROW = new Bound("CURRENT ROW");
        private static final Bound UNBOUNDED_FOLLOWING = new Bound("UNBOUNDED FOLLOWING");

        private final String sql;

        private Bound(String sql) {
            this.sql = sql;
        }

        public static Bound unboundedPreceding() {
            return UNBOUNDED_PRECEDING;
        }

        public static Bound preceding(int offset) {
            return new Bound(offset(offset) + " PRECEDING");
        }

        public static Bound currentRow() {
            return CURRENT_ROW;
        }

        public static Bound following(int offset) {
            return new Bound(offset(offset) + " FOLLOWING");
        }

        public static Bound unboundedFollowing() {
            return UNBOUNDED_FOLLOWING;
        }

        private static int offset(int offset) {
            if (offset < 0) {
                throw new EasyQueryInvalidOperationException("window frame offset must be >= 0, got " + offset);
            }
            return offset;
        }
    }
}
