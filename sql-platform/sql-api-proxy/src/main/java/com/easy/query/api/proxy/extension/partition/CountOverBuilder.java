package com.easy.query.api.proxy.extension.partition;

import com.easy.query.core.func.SQLFunc;
import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.core.EntitySQLContext;

/**
 * COUNT(column) OVER (…)；fork：实现收进 {@link OverBuilder}，可用 over() 开全局窗口
 */
public class CountOverBuilder extends OverBuilder<Long> {
    public CountOverBuilder(PropTypeColumn<?> overColumn, EntitySQLContext entitySQLContext) {
        super(entitySQLContext, overColumn, SQLFunc::countOver, Long.class);
    }
}
