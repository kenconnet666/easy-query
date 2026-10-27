package com.easy.query.api.proxy.extension.partition;

import com.easy.query.core.func.SQLFunc;
import com.easy.query.core.proxy.core.EntitySQLContext;

/**
 * DENSE_RANK() OVER (…)；fork：实现收进 {@link OverBuilder}，可用 over() 开全局窗口
 */
public class DenseRankOverBuilder extends OverBuilder<Long> {
    public DenseRankOverBuilder(EntitySQLContext entitySQLContext) {
        super(entitySQLContext, null, SQLFunc::denseRankNumberOver, Long.class);
    }
}
