package com.easy.query.pgsql.proxy;

import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.extension.dialect.DialectExpressions;
import com.easy.query.core.proxy.extension.functions.type.NumberTypeExpression;

/**
 * fork：PostgreSQL 全文检索，由 {@code PgSQL.fulltext(col)} 得到。查询串用 {@code websearch_to_tsquery} 解析，
 * 支持搜索引擎式写法：{@code easy query}（都要有）、{@code "easy query"}（短语）、{@code easy or query}、{@code -jdbc}（排除）。
 * <p>
 * 不传 config 时用 {@code 'simple'}（只按空白与标点分词、不做词干）；英文可传 {@code "english"}。中文要装 zhparser 等扩展并传它的配置名。
 * 列上建 {@code GIN (to_tsvector('simple', col))} 表达式索引，且查询里的 config 与索引一致时才走索引。
 */
public final class PgSQLFullText {
    private static final String DEFAULT_CONFIG = "simple";

    private final PropTypeColumn<?> column;

    public PgSQLFullText(PropTypeColumn<?> column) {
        this.column = column;
    }

    /** 匹配 query：{@code to_tsvector('simple', col) @@ websearch_to_tsquery('simple', ?)}。 */
    public void matches(String query) {
        matches(DEFAULT_CONFIG, query);
    }

    /** 用指定的文本搜索配置（如 {@code "english"}）。 */
    public void matches(String config, String query) {
        DialectExpressions.predicate(column, "to_tsvector(" + config(config) + ",{0}) @@ websearch_to_tsquery(" + config(config) + ",{1})", column, query);
    }

    /** 相关度，越大越相关，select / orderBy 用：{@code ts_rank(to_tsvector(..), websearch_to_tsquery(..))}。 */
    public NumberTypeExpression<Double> rank(String query) {
        return rank(DEFAULT_CONFIG, query);
    }

    public NumberTypeExpression<Double> rank(String config, String query) {
        return DialectExpressions.number(column, Double.class,
            "ts_rank(to_tsvector(" + config(config) + ",{0}),websearch_to_tsquery(" + config(config) + ",{1}))", column, query);
    }

    /** 配置名直接写进 SQL（要与表达式索引逐字一致才能走索引），所以只接受标识符 */
    private static String config(String config) {
        if (config == null || !config.matches("[A-Za-z_][A-Za-z0-9_]*")) {
            throw new IllegalArgumentException("text search config must be an identifier, got " + config);
        }
        return "'" + config + "'";
    }
}
