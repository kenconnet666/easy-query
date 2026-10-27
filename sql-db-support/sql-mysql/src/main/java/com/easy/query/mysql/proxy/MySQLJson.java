package com.easy.query.mysql.proxy;

import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.extension.dialect.DialectExpressions;
import com.easy.query.core.proxy.extension.functions.type.AnyTypeExpression;

import java.util.function.Consumer;

/**
 * fork：一列 JSON 在 MySQL 上的函数（由 {@code MySQL.json(col)} 得到）。
 * <ul>
 *     <li>条件（contains、overlaps、hasMember、containsPath…）是加到当前 where 里的语句；</li>
 *     <li>修改用 {@link #edit}：返回与列同类型的表达式，用在 update 里写回这一列。</li>
 * </ul>
 * 候选值是 JSON 文字（如 {@code "\"vip\""}、{@code "{\"a\":1}"}），由 MySQL 解析，写错时数据库报错。path 形如 {@code "$.a.b"}、{@code "$.tags[0]"}。
 *
 * @param <T> 列的属性类型
 */
public final class MySQLJson<T> {
    private final PropTypeColumn<T> column;

    public MySQLJson(PropTypeColumn<T> column) {
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

    /** 至少有一个 path 存在（例如有某个键）：{@code JSON_CONTAINS_PATH(col, 'one', ?, …)}。 */
    public void containsPath(String... paths) {
        DialectExpressions.predicate(column, pathTemplate("one", paths.length), withColumn(paths));
    }

    /** 所有 path 都存在：{@code JSON_CONTAINS_PATH(col, 'all', ?, …)}。 */
    public void containsAllPaths(String... paths) {
        DialectExpressions.predicate(column, pathTemplate("all", paths.length), withColumn(paths));
    }

    /**
     * 修改这一列的 JSON，结果与列同类型，用在 update 里写回：
     * {@code .setColumns(u -> u.attrs().set(MySQL.json(u.attrs()).edit(e -> e.set("$.level", 3).remove("$.old"))))}
     */
    public AnyTypeExpression<T> edit(Consumer<MySQLJsonEdit> changes) {
        MySQLJsonEdit edit = new MySQLJsonEdit(column);
        changes.accept(edit);
        if (edit.args().length == 1) {
            throw new IllegalArgumentException("MySQL.json(..).edit made no change");
        }
        return DialectExpressions.sameType(column, edit.template(), edit.args());
    }

    private static String pathTemplate(String mode, int count) {
        if (count == 0) {
            throw new IllegalArgumentException("MySQL.json(..).containsPath needs at least one path");
        }
        StringBuilder template = new StringBuilder("JSON_CONTAINS_PATH({0},'" + mode + "'");
        for (int i = 1; i <= count; i++) {
            template.append(",{").append(i).append('}');
        }
        return template.append(')').toString();
    }

    private Object[] withColumn(String[] paths) {
        Object[] args = new Object[paths.length + 1];
        args[0] = column;
        System.arraycopy(paths, 0, args, 1, paths.length);
        return args;
    }
}
