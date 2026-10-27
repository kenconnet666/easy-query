package com.easy.query.pgsql;

import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.extension.dialect.DialectExpressions;
import com.easy.query.pgsql.config.PgSQLDialectMarker;
import com.easy.query.pgsql.proxy.PgSQLJsonb;

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
    public static PgSQLJsonb jsonb(PropTypeColumn<?> column) {
        DialectExpressions.require(column, PgSQLDialectMarker.class, "PgSQL.jsonb");
        return new PgSQLJsonb(column);
    }
}
