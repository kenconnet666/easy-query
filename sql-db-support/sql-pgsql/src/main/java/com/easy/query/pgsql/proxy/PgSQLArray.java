package com.easy.query.pgsql.proxy;

import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.extension.dialect.DialectExpressions;
import com.easy.query.core.proxy.extension.functions.type.NumberTypeExpression;

/**
 * fork：一列 PostgreSQL 数组（{@code text[]}、{@code int[]} …）的条件，由 {@code PgSQL.array(col)} 得到。
 * 都写成 {@code ? = ANY(col)}：参数与元素类型不必完全一致（varchar 与 text、int8 与 int4 都能比），不用像 {@code @>} 那样给参数数组写类型。
 */
public final class PgSQLArray {
    private final PropTypeColumn<?> column;

    public PgSQLArray(PropTypeColumn<?> column) {
        this.column = column;
    }

    /** 含有 value：{@code ? = ANY(col)}。 */
    public void has(Object value) {
        DialectExpressions.predicate(column, "{0} = ANY({1})", value, column);
    }

    /** 这些值都有（相当于 {@code col @> ARRAY[…]}）。 */
    public void hasAll(Object... values) {
        DialectExpressions.predicate(column, anyOf(values.length, " AND "), args(values));
    }

    /** 至少有其中一个（相当于 {@code col && ARRAY[…]}）。 */
    public void hasAny(Object... values) {
        DialectExpressions.predicate(column, anyOf(values.length, " OR "), args(values));
    }

    /** 元素个数，NULL 数组为 NULL、空数组为 0：{@code cardinality(col)}。 */
    public NumberTypeExpression<Integer> length() {
        return DialectExpressions.number(column, Integer.class, "cardinality({0})", column);
    }

    /** ({1} = ANY({0}) AND {2} = ANY({0}) …)：{0} 是列，可以重复引用（列没有参数）。 */
    private static String anyOf(int count, String joiner) {
        if (count == 0) {
            throw new IllegalArgumentException("at least one value is required");
        }
        StringBuilder sql = new StringBuilder("(");
        for (int i = 1; i <= count; i++) {
            if (i > 1) {
                sql.append(joiner);
            }
            sql.append('{').append(i).append("} = ANY({0})");
        }
        return sql.append(')').toString();
    }

    private Object[] args(Object[] values) {
        Object[] args = new Object[values.length + 1];
        args[0] = column;
        System.arraycopy(values, 0, args, 1, values.length);
        return args;
    }
}
