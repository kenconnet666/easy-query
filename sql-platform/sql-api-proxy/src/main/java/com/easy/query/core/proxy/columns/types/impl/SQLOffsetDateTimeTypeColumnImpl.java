package com.easy.query.core.proxy.columns.types.impl;

import com.easy.query.core.expression.parser.core.available.TableAvailable;
import com.easy.query.core.proxy.columns.types.SQLOffsetDateTimeTypeColumn;
import com.easy.query.core.proxy.core.EntitySQLContext;
import com.easy.query.core.proxy.impl.SQLColumnImpl;

import java.time.OffsetDateTime;

/**
 * fork：{@link SQLOffsetDateTimeTypeColumn} 的实现，写法同 SQLLocalDateTimeTypeColumnImpl。
 */
public class SQLOffsetDateTimeTypeColumnImpl<TProxy> extends SQLColumnImpl<TProxy, OffsetDateTime> implements SQLOffsetDateTimeTypeColumn<TProxy> {
    public SQLOffsetDateTimeTypeColumnImpl(EntitySQLContext entitySQLContext, TableAvailable table, String property) {
        super(entitySQLContext, table, property, OffsetDateTime.class);
    }

    @Override
    public TableAvailable getTableOrNull() {
        return table;
    }

    @Override
    public Class<OffsetDateTime> getEntityClass() {
        return OffsetDateTime.class;
    }

    @Override
    public SQLOffsetDateTimeTypeColumn<TProxy> create(TableAvailable table, EntitySQLContext entitySQLContext) {
        return new SQLOffsetDateTimeTypeColumnImpl<>(entitySQLContext, table, property);
    }
}
