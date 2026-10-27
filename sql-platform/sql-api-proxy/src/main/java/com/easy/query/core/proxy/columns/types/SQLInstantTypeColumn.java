package com.easy.query.core.proxy.columns.types;

import com.easy.query.core.proxy.ProxyEntity;
import com.easy.query.core.proxy.columns.SQLDateTimeColumn;

import java.time.Instant;

/**
 * fork：{@link Instant} 属性的代理列，与 LocalDateTime 一样带日期时间函数（format、plus、duration、取年月日…）。
 * 生成的 SQL 与 LocalDateTime 列相同；值怎么绑定、读取由 JdbcTypeHandler 决定（未注册时走 setObject / getObject）。
 */
public interface SQLInstantTypeColumn<TProxy> extends SQLDateTimeColumn<TProxy, Instant>,
        ProxyEntity<SQLInstantTypeColumn<TProxy>, Instant> {
}
