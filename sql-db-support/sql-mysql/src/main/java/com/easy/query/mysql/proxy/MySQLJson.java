package com.easy.query.mysql.proxy;

import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.extension.dialect.DialectExpressions;

/**
 * fork：一列 JSON 在 MySQL 上的条件（由 {@code MySQL.json(col)} 得到）。方法都是加到当前 where 里的语句。
 * 候选值是 JSON 文字（如 {@code "\"vip\""}、{@code "{\"a\":1}"}），由 MySQL 解析，写错时数据库报错。
 */
public final class MySQLJson {
    private final PropTypeColumn<?> column;

    public MySQLJson(PropTypeColumn<?> column) {
        this.column = column;
    }

    /** 文档包含 candidate：{@code JSON_CONTAINS(col, ?)}。 */
    public void contains(String candidate) {
        DialectExpressions.predicate(column, "JSON_CONTAINS({0},{1})", column, candidate);
    }

    /** path 处的值包含 candidate：{@code JSON_CONTAINS(col, ?, ?)}，path 如 {@code "$.tags"}。 */
    public void contains(String candidate, String path) {
        DialectExpressions.predicate(column, "JSON_CONTAINS({0},{1},{2})", column, candidate, path);
    }

    /** 两个文档有共同的元素或键值对：{@code JSON_OVERLAPS(col, ?)}（MySQL 8.0.17+）。 */
    public void overlaps(String document) {
        DialectExpressions.predicate(column, "JSON_OVERLAPS({0},{1})", column, document);
    }

    /** 这一列是 JSON 数组且含有 value（文字、数）：{@code ? MEMBER OF(col)}（MySQL 8.0.17+）。 */
    public void hasMember(Object value) {
        DialectExpressions.predicate(column, "{0} MEMBER OF({1})", value, column);
    }

    /** path 处的数组含有 value：{@code ? MEMBER OF(JSON_EXTRACT(col, ?))}。 */
    public void hasMember(Object value, String path) {
        DialectExpressions.predicate(column, "{0} MEMBER OF(JSON_EXTRACT({1},{2}))", value, column, path);
    }
}
