package com.easy.query.core.proxy.columns.types.impl;

import com.easy.query.core.expression.parser.core.available.TableAvailable;
import com.easy.query.core.proxy.columns.types.SQLInstantTypeColumn;
import com.easy.query.core.proxy.core.EntitySQLContext;
import com.easy.query.core.proxy.impl.SQLColumnImpl;

import java.time.Instant;

/**
 * fork：{@link SQLInstantTypeColumn} 的实现，写法同 SQLLocalDateTimeTypeColumnImpl。
 */
public class SQLInstantTypeColumnImpl<TProxy> extends SQLColumnImpl<TProxy, Instant> implements SQLInstantTypeColumn<TProxy> {
    public SQLInstantTypeColumnImpl(EntitySQLContext entitySQLContext, TableAvailable table, String property) {
        super(entitySQLContext, table, property, Instant.class);
    }

    @Override
    public TableAvailable getTableOrNull() {
        return table;
    }

    @Override
    public Class<Instant> getEntityClass() {
        return Instant.class;
    }

    @Override
    public SQLInstantTypeColumn<TProxy> create(TableAvailable table, EntitySQLContext entitySQLContext) {
        return new SQLInstantTypeColumnImpl<>(entitySQLContext, table, property);
    }
}
