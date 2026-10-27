package com.easy.query.pgsql.proxy;

import com.easy.query.core.basic.jdbc.parameter.DefaultToSQLContext;
import com.easy.query.core.basic.jdbc.parameter.ToSQLContext;
import com.easy.query.core.context.QueryRuntimeContext;
import com.easy.query.core.expression.sql.builder.ExpressionContext;

import java.util.List;
import java.util.function.Function;

/**
 * fork：带 {@code RETURNING *} 的 UPDATE / DELETE，执行后把受影响的行读回成实体（见 {@code PgSQL.returning}）。
 * 语句与参数沿用 updatable / deletable 自己生成的（拦截器、逻辑删除都照常生效），只在末尾追加 RETURNING。
 *
 * @param <T> 实体类型
 */
public final class PgSQLReturning<T> {
    private final ExpressionContext expressionContext;
    private final Function<ToSQLContext, String> statement;
    private final Class<T> entityClass;

    public PgSQLReturning(ExpressionContext expressionContext, Function<ToSQLContext, String> statement, Class<T> entityClass) {
        this.expressionContext = expressionContext;
        this.statement = statement;
        this.entityClass = entityClass;
    }

    /** 生成的 SQL（不执行） */
    public String toSQL() {
        return statement.apply(context()) + " RETURNING *";
    }

    /** 执行，返回被更新 / 删除的行（更新后的值） */
    public List<T> toList() {
        ToSQLContext context = context();
        String sql = statement.apply(context) + " RETURNING *";
        QueryRuntimeContext runtime = expressionContext.getRuntimeContext();
        return runtime.getSQLClientApiFactory().createJdbcExecutor(runtime).sqlQuery(sql, entityClass, context.getParameters());
    }

    private ToSQLContext context() {
        return DefaultToSQLContext.defaultToSQLContext(expressionContext.getTableContext());
    }
}
