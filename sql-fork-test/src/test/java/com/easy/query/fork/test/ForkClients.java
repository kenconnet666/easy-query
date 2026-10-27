package com.easy.query.fork.test;

import com.easy.query.api.proxy.client.DefaultEasyEntityQuery;
import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.api.client.EasyQueryClient;
import com.easy.query.core.bootstrapper.DatabaseConfiguration;
import com.easy.query.core.bootstrapper.EasyQueryBootstrapper;
import com.easy.query.test.common.EmptyDataSource;

/** 只生成 SQL、不连库的客户端：断言 toSQL 的文本用。 */
public final class ForkClients {
    private ForkClients() { }

    public static EasyEntityQuery sqlOnly(DatabaseConfiguration dialect) {
        EasyQueryClient client = EasyQueryBootstrapper.defaultBuilderConfiguration()
            .setDefaultDataSource(new EmptyDataSource())
            .optionConfigure(op -> op.setDeleteThrowError(false))
            .useDatabaseConfigure(dialect)
            .build();
        return new DefaultEasyEntityQuery(client);
    }
}
