package com.easy.query.hana.expression;

import com.easy.query.core.basic.jdbc.parameter.ToSQLContext;
import com.easy.query.core.expression.segment.condition.PredicateSegment;
import com.easy.query.core.expression.sql.expression.EntityTableSQLExpression;
import com.easy.query.core.expression.sql.expression.impl.DeleteSQLExpressionImpl;
import com.easy.query.core.expression.sql.expression.impl.EntitySQLExpressionMetadata;
import com.easy.query.core.util.EasySQLExpressionUtil;

/**
 * fork：HANA 的删除。单表照核心写法；带关联表的删除写成
 * {@code DELETE FROM "t" t WHERE EXISTS (SELECT 1 FROM DUMMY eq_seed LEFT JOIN … WHERE eq_seed."DUMMY" IS NOT NULL AND (…))}：
 * 一行 DUMMY 代表外层正在判断的那一行，LEFT JOIN 的关联照常生效，也不要求目标表有主键。
 */
public class HanaDeleteSQLExpression extends DeleteSQLExpressionImpl {
    public HanaDeleteSQLExpression(EntitySQLExpressionMetadata entitySQLExpressionMetadata, EntityTableSQLExpression table) {
        super(entitySQLExpressionMetadata, table);
    }

    @Override
    public String toSQL(ToSQLContext toSQLContext) {
        if (tables.size() == 1) {
            return super.toSQL(toSQLContext);
        }
        EasySQLExpressionUtil.expressionInvokeRoot(toSQLContext);
        StringBuilder sql = new StringBuilder("DELETE FROM ").append(tables.get(0).toSQL(toSQLContext))
            .append(" WHERE EXISTS (SELECT 1 FROM DUMMY eq_seed");
        for (int i = 1; i < tables.size(); i++) {
            EntityTableSQLExpression table = tables.get(i);
            sql.append(table.toSQL(toSQLContext));
            PredicateSegment on = table.getOn();
            if (on != null && on.isNotEmpty()) {
                sql.append(" ON ").append(on.toSQL(toSQLContext));
            }
        }
        // RIGHT / FULL JOIN 补出来的空行不能触发删除
        sql.append(" WHERE eq_seed.\"DUMMY\" IS NOT NULL AND (").append(where.toSQL(toSQLContext)).append("))");
        return sql.toString();
    }
}
