package com.easy.query.hana.jdbc;

import com.easy.query.core.basic.extension.listener.JdbcExecuteAfterArg;
import com.easy.query.core.basic.extension.listener.JdbcExecuteBeforeArg;
import com.easy.query.core.basic.extension.listener.JdbcExecutorListener;
import com.easy.query.core.basic.jdbc.conn.EasyConnection;
import com.easy.query.core.basic.jdbc.executor.ExecutorContext;
import com.easy.query.core.basic.jdbc.executor.internal.merge.result.impl.EasyStreamResultSet;
import com.easy.query.core.basic.jdbc.executor.internal.props.BasicJdbcProperty;
import com.easy.query.core.basic.jdbc.parameter.SQLParameter;
import com.easy.query.core.basic.jdbc.types.JdbcTypeHandlerManager;
import com.easy.query.core.context.QueryRuntimeContext;
import com.easy.query.core.enums.EasyBehaviorEnum;
import com.easy.query.core.exception.EasyQueryInvalidOperationException;
import com.easy.query.core.exception.EasyQuerySQLStatementException;
import com.easy.query.core.metadata.ColumnMetadata;
import com.easy.query.core.metadata.EntityMetadata;
import com.easy.query.core.sql.DefaultJdbcSQLExecutor;
import com.easy.query.core.util.EasyClassUtil;
import com.easy.query.core.util.EasyJdbcExecutorUtil;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/**
 * fork：HANA 的 JDBC 执行。HANA 的驱动（ngdbc）不支持 {@code prepareStatement(sql, 列名[])} 与 {@code getGeneratedKeys}，
 * 所以要回填自增主键（{@code executeRows(true)}）时逐行插入，每行之后在同一连接上取 {@code SELECT CURRENT_IDENTITY_VALUE() FROM DUMMY}。
 * 不回填时照核心实现（可以批量）。
 * <p>CURRENT_IDENTITY_VALUE 是本会话最近一次生成的值：表上的 INSERT 触发器若又往别的 IDENTITY 表插了行，取到的会是那个值。
 */
public class HanaJdbcSQLExecutor extends DefaultJdbcSQLExecutor {
    private static final String CURRENT_IDENTITY = "SELECT CURRENT_IDENTITY_VALUE() FROM DUMMY";

    @Override
    public <T> int insert(ExecutorContext executorContext, EasyConnection easyConnection, String sql, List<T> entities, List<SQLParameter> sqlParameters,
                          boolean fillAutoIncrement, boolean shardingPrint, boolean replicaPrint) throws SQLException {
        if (!fillAutoIncrement) {
            return super.insert(executorContext, easyConnection, sql, entities, sqlParameters, false, shardingPrint, replicaPrint);
        }
        QueryRuntimeContext runtimeContext = executorContext.getRuntimeContext();
        EntityMetadata entityMetadata = runtimeContext.getEntityMetadataManager().getEntityMetadata(entities.get(0).getClass());
        ColumnMetadata keyColumn = generatedKeyColumn(entityMetadata);
        JdbcExecutorListener listener = runtimeContext.getJdbcExecutorListener();
        boolean listen = listener.enable() && executorContext.getExpressionContext().getBehavior().hasBehavior(EasyBehaviorEnum.JDBC_LISTEN);
        boolean printSql = EasyJdbcExecutorUtil.isPrintSQL(executorContext);
        EasyJdbcExecutorUtil.logSQL(printSql, sql, easyConnection, shardingPrint, replicaPrint);
        JdbcTypeHandlerManager typeHandlers = runtimeContext.getJdbcTypeHandlerManager();
        JdbcExecuteBeforeArg before = null;
        Exception exception = null;
        int rows = 0;
        Connection connection = easyConnection.getConnection();
        try (PreparedStatement insert = connection.prepareStatement(sql); Statement identity = connection.createStatement()) {
            if (listen) {
                String traceId = listener.createTraceId();
                executorContext.setJdbcListenerTraceId(traceId);
                before = new JdbcExecuteBeforeArg(traceId, sql, new ArrayList<>(entities.size()), executorContext.getExecuteMethod());
                listener.onExecuteBefore(before);
            }
            for (T entity : entities) {
                List<SQLParameter> parameters = EasyJdbcExecutorUtil.extractParameters(entity, sqlParameters, printSql,
                    runtimeContext.getSQLParameterPrintFormat(), easyConnection, shardingPrint, replicaPrint);
                if (listen) {
                    before.getSqlParameters().add(parameters);
                }
                EasyJdbcExecutorUtil.setPreparedStatement(insert, parameters, typeHandlers);
                rows += insert.executeUpdate();
                try (ResultSet keys = identity.executeQuery(CURRENT_IDENTITY);
                     EasyStreamResultSet stream = new EasyStreamResultSet(keys, null)) {
                    if (!keys.next()) {
                        throw new SQLException("HANA returned no CURRENT_IDENTITY_VALUE after the insert");
                    }
                    Object value = keyColumn.getJdbcTypeHandler().getValue(new BasicJdbcProperty(0, keyColumn.getPropertyType()), stream);
                    keyColumn.getSetterCaller().call(entity, value);
                }
            }
            EasyJdbcExecutorUtil.logResult(printSql, rows, easyConnection, shardingPrint, replicaPrint);
        } catch (SQLException e) {
            exception = e;
            throw new EasyQuerySQLStatementException(sql, e);
        } catch (RuntimeException e) {
            exception = e;
            throw e;
        } finally {
            if (listen) {
                listener.onExecuteAfter(new JdbcExecuteAfterArg(before, null, rows, exception));
            }
        }
        return rows;
    }

    /** 只支持一个数据库生成的列（HANA 一张表只能有一个 IDENTITY 列） */
    private static ColumnMetadata generatedKeyColumn(EntityMetadata entityMetadata) {
        List<String> columns = entityMetadata.getGeneratedKeyColumns();
        if (columns == null || columns.size() != 1) {
            throw new EasyQueryInvalidOperationException("HANA can fill back exactly one generated column, but "
                + EasyClassUtil.getSimpleName(entityMetadata.getEntityClass()) + " has " + (columns == null ? 0 : columns.size())
                + "; mark the IDENTITY column with @Column(generatedKey = true)");
        }
        return entityMetadata.getColumnNotNull(entityMetadata.getPropertyNameNotNull(columns.get(0)));
    }
}
