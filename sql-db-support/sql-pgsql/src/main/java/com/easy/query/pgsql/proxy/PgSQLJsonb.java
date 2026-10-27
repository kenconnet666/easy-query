package com.easy.query.pgsql.proxy;

import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.extension.dialect.DialectExpressions;

/**
 * fork：一列 jsonb 在 PostgreSQL 上的条件（由 {@code PgSQL.jsonb(col)} 得到）。方法都是加到当前 where 里的语句。
 * 键是否存在用 {@code jsonb_exists*} 函数而不是 {@code ?} 运算符：{@code ?} 会被 JDBC 当成参数占位符。
 */
public final class PgSQLJsonb {
    private final PropTypeColumn<?> column;

    public PgSQLJsonb(PropTypeColumn<?> column) {
        this.column = column;
    }

    /** 包含 document（JSON 文字）：{@code col::jsonb @> ?::jsonb}。 */
    public void contains(String document) {
        DialectExpressions.predicate(column, "({0})::jsonb @> ({1})::jsonb", column, document);
    }

    /** 被 document 包含：{@code col::jsonb <@ ?::jsonb}。 */
    public void containedBy(String document) {
        DialectExpressions.predicate(column, "({0})::jsonb <@ ({1})::jsonb", column, document);
    }

    /** 顶层有这个键（或数组里有这个文字元素）：{@code jsonb_exists(col::jsonb, ?)}。 */
    public void hasKey(String key) {
        DialectExpressions.predicate(column, "jsonb_exists(({0})::jsonb,{1})", column, key);
    }

    /** 顶层有其中任一个键：{@code jsonb_exists_any(col::jsonb, ARRAY[?, ...]::text[])}。 */
    public void hasAnyKey(String... keys) {
        DialectExpressions.predicate(column, "jsonb_exists_any(({0})::jsonb," + textArray(keys.length) + ")", args(keys));
    }

    /** 顶层这些键都有：{@code jsonb_exists_all(col::jsonb, ARRAY[?, ...]::text[])}。 */
    public void hasAllKeys(String... keys) {
        DialectExpressions.predicate(column, "jsonb_exists_all(({0})::jsonb," + textArray(keys.length) + ")", args(keys));
    }

    /** ARRAY[{1},{2},…]::text[]：参数从 {1} 起，{0} 是列。 */
    private static String textArray(int count) {
        if (count == 0) throw new IllegalArgumentException("at least one key is required");
        StringBuilder sql = new StringBuilder("ARRAY[");
        for (int i = 1; i <= count; i++) {
            if (i > 1) sql.append(',');
            sql.append('{').append(i).append('}');
        }
        return sql.append("]::text[]").toString();
    }

    private Object[] args(String[] keys) {
        Object[] args = new Object[keys.length + 1];
        args[0] = column;
        System.arraycopy(keys, 0, args, 1, keys.length);
        return args;
    }
}
