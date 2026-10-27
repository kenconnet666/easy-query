package com.easy.query.pgsql.config;

/**
 * fork：PostgreSQL 方言的标记，注册在 {@link PgSQLDatabaseConfiguration} 里。
 * {@code com.easy.query.pgsql.PgSQL} 的函数入口用它判断当前查询是不是 PostgreSQL，不是就明确报错。
 * 只是标记，不依赖代理 API。
 */
public final class PgSQLDialectMarker {
    public static final PgSQLDialectMarker INSTANCE = new PgSQLDialectMarker();

    private PgSQLDialectMarker() { }
}
