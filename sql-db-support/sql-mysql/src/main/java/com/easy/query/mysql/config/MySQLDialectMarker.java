package com.easy.query.mysql.config;

/**
 * fork：MySQL 方言（及注册了它的兼容方言）的标记，注册在 {@link MySQLDatabaseConfiguration} 里。
 * {@code com.easy.query.mysql.MySQL} 的函数入口用它判断当前查询是不是 MySQL 系的方言，不是就明确报错。
 * 只是标记，不依赖代理 API，注册它不会让只用 client API 的项目加载代理相关的类。
 */
public final class MySQLDialectMarker {
    public static final MySQLDialectMarker INSTANCE = new MySQLDialectMarker();

    private MySQLDialectMarker() { }
}
