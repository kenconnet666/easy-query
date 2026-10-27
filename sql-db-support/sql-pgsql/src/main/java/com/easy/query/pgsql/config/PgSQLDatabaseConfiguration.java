package com.easy.query.pgsql.config;

import com.easy.query.core.basic.jdbc.types.EasyJdbcTypeHandlerManager;
import com.easy.query.core.basic.jdbc.types.JdbcTypeHandlerManager;
import com.easy.query.core.bootstrapper.DatabaseConfiguration;
import com.easy.query.core.configuration.dialect.SQLKeyword;
import com.easy.query.core.expression.sql.expression.factory.ExpressionFactory;
import com.easy.query.core.func.SQLFunc;
import com.easy.query.core.inject.ServiceCollection;
import com.easy.query.core.migration.DatabaseMigrationProvider;
import com.easy.query.core.migration.MigrationEntityParser;
import com.easy.query.pgsql.expression.PostgresSQLExpressionFactory;
import com.easy.query.pgsql.func.PgSQLFuncImpl;
import com.easy.query.pgsql.migration.PgSQLDatabaseMigrationProvider;
import com.easy.query.pgsql.migration.PgSQLMigrationEntityParser;
import com.easy.query.pgsql.types.PgSQLUUIDTypeHandler;

import java.util.UUID;

/**
 * create time 2023/5/10 13:40
 * 文件说明
 *
 * @author xuejiaming
 */
public class PgSQLDatabaseConfiguration implements DatabaseConfiguration {
    @Override
    public void configure(ServiceCollection services) {
        services.addService(SQLKeyword.class, PgSQLSQLKeyword.class);
        services.addService(ExpressionFactory.class, PostgresSQLExpressionFactory.class);
        services.addService(SQLFunc.class, PgSQLFuncImpl.class);
        services.addService(DatabaseMigrationProvider.class, PgSQLDatabaseMigrationProvider.class);
        services.addService(MigrationEntityParser.class, PgSQLMigrationEntityParser.class);
        // fork：方言专属函数入口（com.easy.query.pgsql.PgSQL）据此确认当前是 PostgreSQL 方言
        services.addService(PgSQLDialectMarker.class, PgSQLDialectMarker.INSTANCE);
        services.addServiceFactory(JdbcTypeHandlerManager.class,s->{
            EasyJdbcTypeHandlerManager easyJdbcTypeHandlerManager = new EasyJdbcTypeHandlerManager();
            easyJdbcTypeHandlerManager.appendHandler(UUID.class, PgSQLUUIDTypeHandler.INSTANCE,true);
            return easyJdbcTypeHandlerManager;
        });
    }
}
