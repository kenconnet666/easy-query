package com.easy.query.hana.config;

import com.easy.query.core.bootstrapper.DatabaseConfiguration;
import com.easy.query.core.configuration.dialect.SQLKeyword;
import com.easy.query.core.expression.sql.expression.factory.ExpressionFactory;
import com.easy.query.core.func.SQLFunc;
import com.easy.query.core.inject.ServiceCollection;
import com.easy.query.hana.expression.HanaExpressionFactory;
import com.easy.query.hana.func.HanaSQLFuncImpl;
import com.easy.query.hana.jdbc.HanaJdbcSQLExecutor;
import com.easy.query.hana.jdbc.HanaLocalDateTimeTypeHandler;
import com.easy.query.core.basic.jdbc.types.EasyJdbcTypeHandlerManager;
import com.easy.query.core.basic.jdbc.types.JdbcTypeHandlerManager;

import java.time.LocalDateTime;
import com.easy.query.core.sql.JdbcSQLExecutor;

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
        // ngdbc 不支持 getGeneratedKeys：回填自增主键改用 CURRENT_IDENTITY_VALUE()
        services.addService(JdbcSQLExecutor.class, HanaJdbcSQLExecutor.class);
        // LocalDateTime 在 UTC 日历下读写，不受 JVM 时区夏令时影响
        services.addServiceFactory(JdbcTypeHandlerManager.class, s -> {
            EasyJdbcTypeHandlerManager handlers = new EasyJdbcTypeHandlerManager();
            handlers.appendHandler(LocalDateTime.class, HanaLocalDateTimeTypeHandler.INSTANCE, true);
            return handlers;
        });
    }
}
