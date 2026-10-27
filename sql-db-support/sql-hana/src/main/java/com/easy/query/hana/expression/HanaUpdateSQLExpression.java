package com.easy.query.hana.expression;

import com.easy.query.core.basic.jdbc.parameter.ToSQLContext;
import com.easy.query.core.exception.EasyQueryInvalidOperationException;
import com.easy.query.core.expression.segment.InsertUpdateSetColumnSQLSegment;
import com.easy.query.core.expression.segment.SQLSegment;
import com.easy.query.core.expression.segment.condition.PredicateSegment;
import com.easy.query.core.expression.sql.expression.EntityTableSQLExpression;
import com.easy.query.core.expression.sql.expression.impl.EntitySQLExpressionMetadata;
import com.easy.query.core.expression.sql.expression.impl.UpdateSQLExpressionImpl;
import com.easy.query.core.metadata.EntityMetadata;
import com.easy.query.core.util.EasyClassUtil;
import com.easy.query.core.util.EasySQLExpressionUtil;
import com.easy.query.core.util.EasySQLSegmentUtil;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/**
 * fork：HANA 的更新。单表照核心写法；带关联表的更新（如 where 里用了导航属性）写成按主键对应的 MERGE：
 * <pre>
 * MERGE INTO "t" t USING (SELECT t."id" AS "eq_key_0", &lt;新值&gt; AS "eq_value_0" FROM "t" t LEFT JOIN … WHERE …) eq_src
 *   ON (t."id" = eq_src."eq_key_0") WHEN MATCHED THEN UPDATE SET t."c" = eq_src."eq_value_0"
 * </pre>
 * 不用 HANA 的 {@code UPDATE … FROM}：关联出多行时它会多次赋值、结果取决于顺序；MERGE 遇到重复的源行直接报错并整条回滚。
 * 因此带关联的更新要求实体有主键。
 */
public class HanaUpdateSQLExpression extends UpdateSQLExpressionImpl {
    private static final String SOURCE = "eq_src";

    public HanaUpdateSQLExpression(EntitySQLExpressionMetadata entitySQLExpressionMetadata, EntityTableSQLExpression entityTableSQLExpression) {
        super(entitySQLExpressionMetadata, entityTableSQLExpression);
    }

    @Override
    public String toSQL(ToSQLContext toSQLContext) {
        if (tables.size() == 1 || EasySQLSegmentUtil.isEmpty(setColumns)) {
            return super.toSQL(toSQLContext);
        }
        EasySQLExpressionUtil.expressionInvokeRoot(toSQLContext);
        EntityTableSQLExpression root = tables.get(0);
        EntityMetadata metadata = root.getEntityMetadata();
        Collection<String> keys = metadata.getKeyProperties();
        if (keys.isEmpty()) {
            throw new EasyQueryInvalidOperationException("HANA UPDATE with joined tables needs a primary key on "
                + EasyClassUtil.getSimpleName(metadata.getEntityClass()) + " to match the rows to update");
        }
        String target = root.toSQL(toSQLContext);
        String alias = toSQLContext.getAlias(root.getEntityTable());
        List<String> projection = new ArrayList<>();
        List<String> match = new ArrayList<>();
        int index = 0;
        for (String key : keys) {
            String column = alias + "." + quote(metadata.getColumnNotNull(key).getName());
            String keyAlias = quote("eq_key_" + index++);
            projection.add(column + " AS " + keyAlias);
            match.add(column + " = " + SOURCE + "." + keyAlias);
        }
        List<String> assignments = new ArrayList<>();
        index = 0;
        for (SQLSegment segment : setColumns.getSQLSegments()) {
            if (!(segment instanceof InsertUpdateSetColumnSQLSegment)) {
                throw new EasyQueryInvalidOperationException("HANA joined UPDATE does not support set segment " + EasyClassUtil.getSimpleName(segment.getClass()));
            }
            InsertUpdateSetColumnSQLSegment column = (InsertUpdateSetColumnSQLSegment) segment;
            String valueAlias = quote("eq_value_" + index++);
            projection.add(column.toSQL(toSQLContext) + " AS " + valueAlias);
            // 多表时列名已带上目标表的别名
            assignments.add(column.getColumnNameWithOwner(toSQLContext) + " = " + SOURCE + "." + valueAlias);
        }
        StringBuilder sql = new StringBuilder("MERGE INTO ").append(target)
            .append(" USING (SELECT ").append(String.join(",", projection)).append(" FROM ").append(target);
        appendJoins(sql, toSQLContext);
        sql.append(" WHERE ").append(where.toSQL(toSQLContext)).append(") ").append(SOURCE)
            .append(" ON (").append(String.join(" AND ", match)).append(") WHEN MATCHED THEN UPDATE SET ").append(String.join(",", assignments));
        return sql.toString();
    }

    private void appendJoins(StringBuilder sql, ToSQLContext toSQLContext) {
        for (int i = 1; i < tables.size(); i++) {
            EntityTableSQLExpression table = tables.get(i);
            sql.append(table.toSQL(toSQLContext));
            PredicateSegment on = table.getOn();
            if (on != null && on.isNotEmpty()) {
                sql.append(" ON ").append(on.toSQL(toSQLContext));
            }
        }
    }

    private String quote(String name) {
        return EasySQLExpressionUtil.getQuoteName(getRuntimeContext(), name);
    }
}
