package com.easy.query.hana.expression;

import com.easy.query.core.basic.jdbc.parameter.DefaultToSQLContext;
import com.easy.query.core.basic.jdbc.parameter.ToSQLContext;
import com.easy.query.core.expression.sql.expression.impl.EntitySQLExpressionMetadata;
import com.easy.query.core.expression.sql.expression.impl.QuerySQLExpressionImpl;

/**
 * fork：HANA 的查询。HANA 不允许关联子查询里有 TOP / LIMIT / ORDER BY（错误 309）。easy-query 给隐式子查询生成的
 * {@code EXISTS(SELECT 1 … LIMIT 1)}（any / none / anyValue 等）里，LIMIT 1 对 EXISTS 没有意义，
 * 所以不是最外层、形如 {@code SELECT 1 … LIMIT 1} 的子查询去掉 LIMIT。最外层的 {@code queryable(..).any()} 不受影响。
 * <p>其余带 LIMIT 的关联子查询（如按顺序取第一个的标量子查询）HANA 本身不支持，会报 309。
 */
public class HanaQuerySQLExpression extends QuerySQLExpressionImpl {
    public HanaQuerySQLExpression(EntitySQLExpressionMetadata entitySQLExpressionMetadata) {
        super(entitySQLExpressionMetadata);
    }

    @Override
    public String toSQL(ToSQLContext toSQLContext) {
        if (!isExistsProbe(toSQLContext)) {
            return super.toSQL(toSQLContext);
        }
        long limit = this.rows;
        this.rows = 0;
        try {
            return super.toSQL(toSQLContext);
        } finally {
            this.rows = limit;
        }
    }

    /** 子查询（调用计数不为 0）、只取 1 行、不跳行、投影是常量 1 */
    private boolean isExistsProbe(ToSQLContext toSQLContext) {
        if (toSQLContext.currentInvokeCount() == 0 || this.rows != 1 || this.offset != 0) {
            return false;
        }
        // 用一次性的上下文渲染投影，免得把投影里的参数重复加进真正的上下文
        ToSQLContext scratch = new DefaultToSQLContext(entitySQLExpressionMetadata.getExpressionContext().getTableContext());
        return "1".equals(this.projects.toSQL(scratch).trim());
    }
}
