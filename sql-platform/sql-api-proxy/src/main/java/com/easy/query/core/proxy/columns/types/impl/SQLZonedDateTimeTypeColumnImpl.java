package com.easy.query.core.proxy.columns.types.impl;

import com.easy.query.core.expression.parser.core.available.TableAvailable;
import com.easy.query.core.proxy.columns.types.SQLZonedDateTimeTypeColumn;
import com.easy.query.core.proxy.core.EntitySQLContext;
import com.easy.query.core.proxy.impl.SQLColumnImpl;

import java.time.ZonedDateTime;

/**
 * fork：{@link SQLZonedDateTimeTypeColumn} 的实现，写法同 SQLLocalDateTimeTypeColumnImpl。
 */
public class SQLZonedDateTimeTypeColumnImpl<TProxy> extends SQLColumnImpl<TProxy, ZonedDateTime> implements SQLZonedDateTimeTypeColumn<TProxy> {
    public SQLZonedDateTimeTypeColumnImpl(EntitySQLContext entitySQLContext, TableAvailable table, String property) {
        super(entitySQLContext, table, property, ZonedDateTime.class);
    }

    @Override
    public TableAvailable getTableOrNull() {
        return table;
    }

    @Override
    public Class<ZonedDateTime> getEntityClass() {
        return ZonedDateTime.class;
    }

    @Override
    public SQLZonedDateTimeTypeColumn<TProxy> create(TableAvailable table, EntitySQLContext entitySQLContext) {
        return new SQLZonedDateTimeTypeColumnImpl<>(entitySQLContext, table, property);
    }
}
