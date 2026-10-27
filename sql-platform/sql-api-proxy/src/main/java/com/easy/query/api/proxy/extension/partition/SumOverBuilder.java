package com.easy.query.api.proxy.extension.partition;

import com.easy.query.core.func.SQLFunc;
import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.core.EntitySQLContext;

/**
 * SUM(column) OVER (…)，结果类型同列；fork：实现收进 {@link OverBuilder}，可用 over() 开全局窗口
 */
public class SumOverBuilder<TProperty> extends OverBuilder<TProperty> {
    public SumOverBuilder(PropTypeColumn<TProperty> overColumn, EntitySQLContext entitySQLContext) {
        super(entitySQLContext, overColumn, SQLFunc::sumOver, overColumn.getPropertyType());
    }
}
