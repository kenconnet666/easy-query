package com.easy.query.api.proxy.extension.partition;

import com.easy.query.core.func.SQLFunc;
import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.core.EntitySQLContext;

import java.math.BigDecimal;

/**
 * AVG(column) OVER (…)；fork：实现收进 {@link OverBuilder}，可用 over() 开全局窗口
 */
public class AvgOverBuilder extends OverBuilder<BigDecimal> {
    public AvgOverBuilder(PropTypeColumn<?> overColumn, EntitySQLContext entitySQLContext) {
        super(entitySQLContext, overColumn, SQLFunc::avgOver, BigDecimal.class);
    }
}
