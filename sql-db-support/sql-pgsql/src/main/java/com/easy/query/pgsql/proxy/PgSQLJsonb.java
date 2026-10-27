package com.easy.query.pgsql.proxy;

import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.extension.dialect.DialectExpressions;
import com.easy.query.core.proxy.extension.functions.type.AnyTypeExpression;

import java.util.function.Consumer;

/**
 * fork：一列 jsonb 在 PostgreSQL 上的函数（由 {@code PgSQL.jsonb(col)} 得到）。
 * 条件方法是加到当前 where 里的语句；局部修改用 {@link #edit}。
 * 键是否存在用 {@code jsonb_exists*} 函数而不是 {@code ?} 运算符：{@code ?} 会被 JDBC 当成参数占位符。
 *
 * @param <T> 列的属性类型
 */
public final class PgSQLJsonb<T> {
    private final PropTypeColumn<T> column;

    public PgSQLJsonb(PropTypeColumn<T> column) {
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

    /**
     * 局部修改这一列（按调用顺序作用在 {@code col::jsonb} 上），结果与列同类型，update 里写回：
     * {@code .setColumns(u -> u.attrs().set(PgSQL.jsonb(u.attrs()).edit(e -> e.set("level", "3").remove("old"))))}
     */
    public AnyTypeExpression<T> edit(Consumer<PgSQLJsonbEdit> changes) {
        PgSQLJsonbEdit edit = new PgSQLJsonbEdit(column);
        changes.accept(edit);
        if (edit.args().length == 1) {
            throw new IllegalArgumentException("PgSQL.jsonb(..).edit made no change");
        }
        return DialectExpressions.sameType(column, edit.template(), edit.args());
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
