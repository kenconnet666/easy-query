package com.easy.query.api.proxy.extension.partition;

import com.easy.query.core.func.SQLFunc;
import com.easy.query.core.proxy.core.EntitySQLContext;

/**
 * ROW_NUMBER() OVER (…)；fork：实现收进 {@link OverBuilder}，可用 over() 开全局窗口
 */
public class RowNumberOverBuilder extends OverBuilder<Long> {
    public RowNumberOverBuilder(EntitySQLContext entitySQLContext) {
        super(entitySQLContext, null, SQLFunc::rowNumberOver, Long.class);
    }
}
