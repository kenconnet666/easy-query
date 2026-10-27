package com.easy.query.mysql;

import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.extension.dialect.DialectExpressions;
import com.easy.query.mysql.config.MySQLDialectMarker;
import com.easy.query.mysql.proxy.MySQLJson;
import com.easy.query.mysql.proxy.MySQLMatch;

/**
 * fork：MySQL 专属函数的入口（代理 API）。按列包装，返回这一列的 MySQL 视图，视图上的条件方法与 {@code u.name().eq(..)} 一样是语句：
 * <pre>{@code
 * easyEntityQuery.queryable(User.class)
 *     .where(u -> {
 *         MySQL.json(u.attrs()).contains("\"vip\"", "$.tags");      // JSON_CONTAINS(attrs, ?, ?)
 *         MySQL.match(u.title(), u.body()).against("easy query");   // MATCH(title, body) AGAINST(? IN NATURAL LANGUAGE MODE)
 *     })
 *     .toList();
 * }</pre>
 * 都能用在隐式子查询里（{@code u.posts().any(p -> MySQL.json(p.tags()).hasMember("java"))}）。
 * 函数按 MySQL 8.0.18 可用的来选（生产 PolarDB 的内核版本），用到别的方言上时构造表达式就报错。
 * 读 JSON 里的值不在这里：用已有的 {@code u.attrs().asJSONObject().getString("name")}。
 */
public final class MySQL {
    private MySQL() { }

    /** 把列当作 JSON 文档（JSON 类型或存 JSON 文字的列）。 */
    public static MySQLJson json(PropTypeColumn<?> column) {
        DialectExpressions.require(column, MySQLDialectMarker.class, "MySQL.json");
        return new MySQLJson(column);
    }

    /** 全文检索：列要在同一张表上并有覆盖它们的 FULLTEXT 索引。 */
    public static MySQLMatch match(PropTypeColumn<?>... columns) {
        if (columns == null || columns.length == 0) throw new IllegalArgumentException("MySQL.match needs at least one column");
        DialectExpressions.require(columns[0], MySQLDialectMarker.class, "MySQL.match");
        return new MySQLMatch(columns);
    }
}
