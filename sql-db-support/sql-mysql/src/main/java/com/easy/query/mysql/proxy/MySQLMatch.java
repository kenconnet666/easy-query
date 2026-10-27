package com.easy.query.mysql.proxy;

import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.extension.dialect.DialectExpressions;
import com.easy.query.core.proxy.extension.functions.type.NumberTypeExpression;

/**
 * fork：MySQL 全文检索 {@code MATCH(cols) AGAINST(? mode)}（由 {@code MySQL.match(cols...)} 得到）。
 * {@link #against} 是加到 where 里的条件；{@link #score} 是相关度，放在 select 或 orderBy 里。
 */
public final class MySQLMatch {
    /** AGAINST 的检索方式。 */
    public enum Mode {
        /** 自然语言（默认）。 */
        NATURAL_LANGUAGE(" IN NATURAL LANGUAGE MODE"),
        /** 布尔检索：{@code +easy -slow "exact phrase"}。 */
        BOOLEAN(" IN BOOLEAN MODE"),
        /** 自然语言 + 查询扩展。 */
        QUERY_EXPANSION(" WITH QUERY EXPANSION");

        private final String sql;

        Mode(String sql) { this.sql = sql; }
    }

    private final PropTypeColumn<?>[] columns;

    public MySQLMatch(PropTypeColumn<?>[] columns) {
        this.columns = columns.clone();
    }

    /** 自然语言检索的条件。 */
    public void against(String words) {
        against(words, Mode.NATURAL_LANGUAGE);
    }

    public void against(String words, Mode mode) {
        DialectExpressions.predicate(columns[0], template(mode), args(words));
    }

    /** 相关度（0 表示不相关），自然语言检索。 */
    public NumberTypeExpression<Double> score(String words) {
        return score(words, Mode.NATURAL_LANGUAGE);
    }

    public NumberTypeExpression<Double> score(String words, Mode mode) {
        return DialectExpressions.number(columns[0], Double.class, template(mode), args(words));
    }

    /** MATCH({0},{1},…) AGAINST({n} mode)：前 n 个参数是列，最后一个是检索词。 */
    private String template(Mode mode) {
        StringBuilder sql = new StringBuilder("MATCH(");
        for (int i = 0; i < columns.length; i++) {
            if (i > 0) sql.append(',');
            sql.append('{').append(i).append('}');
        }
        return sql.append(") AGAINST({").append(columns.length).append('}').append(mode.sql).append(')').toString();
    }

    private Object[] args(String words) {
        Object[] args = new Object[columns.length + 1];
        System.arraycopy(columns, 0, args, 0, columns.length);
        args[columns.length] = words;
        return args;
    }
}
