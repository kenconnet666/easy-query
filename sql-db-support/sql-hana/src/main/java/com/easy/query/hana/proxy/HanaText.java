package com.easy.query.hana.proxy;

import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.extension.dialect.DialectExpressions;
import com.easy.query.core.proxy.extension.functions.type.NumberTypeExpression;

/**
 * fork：HANA 的 {@code CONTAINS} 文本检索，由 {@code Hana.text(cols...)} 得到。
 * <ul>
 *     <li>{@link #contains}：EXACT 模式，按词匹配，支持 {@code "短语"}、{@code OR}、{@code -排除}、{@code *} 通配；</li>
 *     <li>{@link #fuzzy}：容错匹配（拼写错误、近似词），threshold 0–1，越大越严格（常用 0.7–0.8）；</li>
 *     <li>{@link #score}：同一条查询里 CONTAINS 的相关度，select / orderBy 用。</li>
 * </ul>
 * 要先给列建全文索引，否则 CONTAINS 按整列值匹配（只有 {@code *} 通配能用）、FUZZY 也几乎匹配不到：
 * {@code CREATE FULLTEXT INDEX ft_doc_title ON doc(title) FUZZY SEARCH INDEX ON SYNC}；多列检索时每列都要有。
 */
public final class HanaText {
    private final PropTypeColumn<?>[] columns;

    public HanaText(PropTypeColumn<?>[] columns) {
        this.columns = columns;
    }

    /** {@code CONTAINS(col, ?)} / {@code CONTAINS((col1, col2), ?)} */
    public void contains(String query) {
        DialectExpressions.predicate(columns[0], "CONTAINS(" + columnList() + "," + param() + ")", args(query));
    }

    /** {@code CONTAINS(cols, ?, FUZZY(threshold))}；threshold 写进 SQL，只接受 0–1 */
    public void fuzzy(String query, double threshold) {
        if (!(threshold >= 0 && threshold <= 1)) {
            throw new IllegalArgumentException("fuzzy threshold must be between 0 and 1, got " + threshold);
        }
        DialectExpressions.predicate(columns[0], "CONTAINS(" + columnList() + "," + param() + ",FUZZY(" + threshold + "))", args(query));
    }

    /** {@code SCORE()}：本查询里 CONTAINS 的相关度（0–1） */
    public NumberTypeExpression<Double> score() {
        return DialectExpressions.number(columns[0], Double.class, "SCORE()");
    }

    /** {0}…{n-1} 是列，多列时加括号 */
    private String columnList() {
        StringBuilder sql = new StringBuilder();
        for (int i = 0; i < columns.length; i++) {
            sql.append(i == 0 ? "" : ",").append('{').append(i).append('}');
        }
        return columns.length == 1 ? sql.toString() : "(" + sql + ")";
    }

    private String param() {
        return "{" + columns.length + "}";
    }

    private Object[] args(String query) {
        Object[] args = new Object[columns.length + 1];
        System.arraycopy(columns, 0, args, 0, columns.length);
        args[columns.length] = query;
        return args;
    }
}
