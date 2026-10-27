package com.easy.query.pgsql;

import com.easy.query.api.proxy.entity.delete.ExpressionDeletable;
import com.easy.query.api.proxy.entity.update.ExpressionUpdatable;
import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.extension.dialect.DialectExpressions;
import com.easy.query.core.util.EasyObjectUtil;
import com.easy.query.pgsql.config.PgSQLDialectMarker;
import com.easy.query.pgsql.proxy.PgSQLArray;
import com.easy.query.pgsql.proxy.PgSQLFullText;
import com.easy.query.pgsql.proxy.PgSQLJsonb;
import com.easy.query.pgsql.proxy.PgSQLReturning;

/**
 * fork：PostgreSQL 专属函数的入口（代理 API）。按列包装，视图上的条件方法与 {@code u.name().eq(..)} 一样是语句：
 * <pre>{@code
 * easyEntityQuery.queryable(User.class)
 *     .where(u -> PgSQL.jsonb(u.attrs()).contains("{\"vip\":true}"))   // attrs::jsonb @> ?::jsonb
 *     .toList();
 * }</pre>
 * 能用在隐式子查询里；用到别的方言上时构造表达式就报错。读 JSON 里的值用已有的 {@code asJSONObject()}。
 */
public final class PgSQL {
    private PgSQL() { }

    /** 把列当作 jsonb（jsonb、json 或存 JSON 文字的列，都先转成 jsonb）。 */
    public static <T> PgSQLJsonb<T> jsonb(PropTypeColumn<T> column) {
        DialectExpressions.require(column, PgSQLDialectMarker.class, "PgSQL.jsonb");
        return new PgSQLJsonb<>(column);
    }

    /** fork：数组列（{@code text[]}、{@code int[]} …）的条件：{@code PgSQL.array(u.tags()).has("vip")} */
    public static PgSQLArray array(PropTypeColumn<?> column) {
        DialectExpressions.require(column, PgSQLDialectMarker.class, "PgSQL.array");
        return new PgSQLArray(column);
    }

    /** fork：全文检索：{@code PgSQL.fulltext(p.body()).matches("easy -jdbc")}，相关度 {@code .rank(..)} */
    public static PgSQLFullText fulltext(PropTypeColumn<?> column) {
        DialectExpressions.require(column, PgSQLDialectMarker.class, "PgSQL.fulltext");
        return new PgSQLFullText(column);
    }

    /**
     * fork：DELETE … RETURNING *，删掉的行一次读回：
     * <pre>{@code
     * List<Job> taken = PgSQL.returning(db.deletable(Job.class).where(j -> j.status().eq("done"))).toList();
     * }</pre>
     */
    public static <T> PgSQLReturning<T> returning(ExpressionDeletable<?, T> deletable) {
        DialectExpressions.require(deletable.getExpressionContext().getRuntimeContext(), PgSQLDialectMarker.class, "PgSQL.returning");
        Class<T> entityClass = EasyObjectUtil.typeCastNullable(deletable.getDeleteExpressionBuilder().getTable(0).getEntityClass());
        return new PgSQLReturning<>(deletable.getExpressionContext(), deletable::toSQL, entityClass);
    }

    /**
     * fork：UPDATE … RETURNING *，返回更新后的行：
     * <pre>{@code
     * List<Account> after = PgSQL.returning(db.updatable(Account.class).setColumns(a -> a.balance().increment(10)).where(a -> a.id().eq(id))).toList();
     * }</pre>
     */
    public static <T> PgSQLReturning<T> returning(ExpressionUpdatable<?, T> updatable) {
        DialectExpressions.require(updatable.getExpressionContext().getRuntimeContext(), PgSQLDialectMarker.class, "PgSQL.returning");
        Class<T> entityClass = EasyObjectUtil.typeCastNullable(updatable.getProxy().getEntityClass());
        return new PgSQLReturning<>(updatable.getExpressionContext(), updatable::toSQL, entityClass);
    }
}
