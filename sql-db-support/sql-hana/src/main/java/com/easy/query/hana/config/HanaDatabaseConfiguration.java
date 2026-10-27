package com.easy.query.hana.config;

import com.easy.query.core.bootstrapper.DatabaseConfiguration;
import com.easy.query.core.configuration.dialect.SQLKeyword;
import com.easy.query.core.expression.sql.expression.factory.ExpressionFactory;
import com.easy.query.core.func.SQLFunc;
import com.easy.query.core.inject.ServiceCollection;
import com.easy.query.hana.expression.HanaExpressionFactory;
import com.easy.query.hana.func.HanaSQLFuncImpl;

/**
 * fork：SAP HANA 方言。
 * <pre>{@code
 * EasyQueryBootstrapper.defaultBuilderConfiguration()
 *     .setDefaultDataSource(dataSource)
 *     .useDatabaseConfigure(new HanaDatabaseConfiguration())
 *     .build();
 * }</pre>
 */
public class HanaDatabaseConfiguration implements DatabaseConfiguration {
    @Override
    public void configure(ServiceCollection services) {
        services.addService(SQLKeyword.class, HanaSQLKeyword.class);
        services.addService(ExpressionFactory.class, HanaExpressionFactory.class);
        services.addService(SQLFunc.class, HanaSQLFuncImpl.class);
        services.addService(HanaDialectMarker.class, HanaDialectMarker.INSTANCE);
    }
}
