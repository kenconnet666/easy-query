package com.easy.query.hana.expression;

import com.easy.query.core.basic.jdbc.parameter.ToSQLContext;
import com.easy.query.core.context.QueryRuntimeContext;
import com.easy.query.core.enums.EasyBehaviorEnum;
import com.easy.query.core.exception.EasyQueryInvalidOperationException;
import com.easy.query.core.expression.parser.core.available.TableAvailable;
import com.easy.query.core.expression.segment.InsertUpdateSetColumnSQLSegment;
import com.easy.query.core.expression.segment.SQLSegment;
import com.easy.query.core.expression.sql.builder.ExpressionContext;
import com.easy.query.core.expression.sql.expression.EntityTableSQLExpression;
import com.easy.query.core.expression.sql.expression.impl.EntitySQLExpressionMetadata;
import com.easy.query.core.expression.sql.expression.impl.InsertSQLExpressionImpl;
import com.easy.query.core.metadata.EntityMetadata;
import com.easy.query.core.util.EasyClassUtil;
import com.easy.query.core.util.EasyCollectionUtil;
import com.easy.query.core.util.EasySQLExpressionUtil;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * fork：HANA 的插入。插入或更新 / 插入或忽略（{@code onConflictThen}）写成
 * {@code MERGE INTO t t1 USING (SELECT ? AS "c", … FROM DUMMY) t2 ON (…) WHEN MATCHED THEN UPDATE SET … WHEN NOT MATCHED THEN INSERT …}：
 * 值只在 USING 里出现一次，UPDATE 与 INSERT 都引用 t2 的列。HANA 没有 REPLACE，也没有 ON DUPLICATE KEY。写法同 Oracle 方言（DUAL 换成 DUMMY）。
 * <p>HANA 不接受任何"零列插入"（DEFAULT VALUES、VALUES() 都报错），没有可插入的列时直接报错。
 */
public class HanaInsertSQLExpression extends InsertSQLExpressionImpl {
    public HanaInsertSQLExpression(EntitySQLExpressionMetadata entitySQLExpressionMetadata, EntityTableSQLExpression table) {
        super(entitySQLExpressionMetadata, table);
    }

    @Override
    public String toSQL(ToSQLContext toSQLContext) {
        if (columns.isEmpty()) {
            throw new EasyQueryInvalidOperationException("HANA does not support an INSERT without columns; give the entity at least one value to insert");
        }
        ExpressionContext expressionContext = entitySQLExpressionMetadata.getExpressionContext();
        boolean insertOrIgnore = expressionContext.getBehavior().hasBehavior(EasyBehaviorEnum.ON_DUPLICATE_KEY_IGNORE);
        boolean insertOrUpdate = expressionContext.getBehavior().hasBehavior(EasyBehaviorEnum.ON_DUPLICATE_KEY_UPDATE);
        if (!insertOrIgnore && !insertOrUpdate) {
            return super.toSQL(toSQLContext);
        }
        EasySQLExpressionUtil.expressionInvokeRoot(toSQLContext);
        QueryRuntimeContext runtimeContext = expressionContext.getRuntimeContext();
        EntityTableSQLExpression tableExpression = tables.get(0);
        EntityMetadata entityMetadata = tableExpression.getEntityMetadata();
        TableAvailable entityTable = tableExpression.getEntityTable();
        Collection<String> keyProperties = entityMetadata.getKeyProperties();
        Collection<String> constraintProperties = constraintProperties(entityMetadata, keyProperties);
        Set<String> insertedProperties = getColumnsSet(columns);

        StringBuilder sql = new StringBuilder("MERGE INTO ").append(tableExpression.toSQL(toSQLContext)).append(" t1 USING (SELECT ");
        List<String> columnNames = new ArrayList<>(columns.getSQLSegments().size());
        for (SQLSegment sqlSegment : columns.getSQLSegments()) {
            InsertUpdateSetColumnSQLSegment column = setColumn(sqlSegment);
            String columnName = getColumnNameWithOwner(column, toSQLContext);
            if (!columnNames.isEmpty()) {
                sql.append(",");
            }
            columnNames.add(columnName);
            sql.append(column.toSQL(toSQLContext)).append(" AS ").append(columnName);
        }
        sql.append(" FROM DUMMY) t2 ON (");
        sql.append(constraintProperties.stream()
            .map(property -> {
                String name = EasySQLExpressionUtil.getQuoteName(runtimeContext, entityTable.getColumnName(property));
                return "t1." + name + " = t2." + name;
            })
            .collect(Collectors.joining(" AND ")));
        sql.append(") ");
        if (insertOrUpdate) {
            List<String> assignments = new ArrayList<>();
            for (SQLSegment sqlSegment : getRealDuplicateKeyUpdateColumns().getSQLSegments()) {
                InsertUpdateSetColumnSQLSegment column = setColumn(sqlSegment);
                String property = column.getPropertyName();
                if (constraintProperties.contains(property) || keyProperties.contains(property) || !insertedProperties.contains(property)) {
                    continue;
                }
                String name = column.getColumnNameWithOwner(toSQLContext);
                assignments.add("t1." + name + " = t2." + name);
            }
            if (!assignments.isEmpty()) {
                sql.append("WHEN MATCHED THEN UPDATE SET ").append(String.join(",", assignments)).append(" ");
            }
        }
        sql.append("WHEN NOT MATCHED THEN INSERT (").append(String.join(",", columnNames)).append(") VALUES (")
            .append(columnNames.stream().map(name -> "t2." + name).collect(Collectors.joining(","))).append(")");
        return sql.toString();
    }

    private static InsertUpdateSetColumnSQLSegment setColumn(SQLSegment sqlSegment) {
        if (!(sqlSegment instanceof InsertUpdateSetColumnSQLSegment)) {
            throw new EasyQueryInvalidOperationException("HANA MERGE does not support column type " + EasyClassUtil.getSimpleName(sqlSegment.getClass()));
        }
        return (InsertUpdateSetColumnSQLSegment) sqlSegment;
    }

    /** 冲突判断用的列：onConflictThen 指定的，否则主键；自增列不能当冲突键（插入时没有它的值） */
    private Collection<String> constraintProperties(EntityMetadata entityMetadata, Collection<String> keyProperties) {
        Collection<String> candidates = EasyCollectionUtil.isEmpty(duplicateKeys) ? keyProperties : duplicateKeys;
        Set<String> constraints = candidates.stream().filter(o -> !entityMetadata.getColumnNotNull(o).isGeneratedKey()).collect(Collectors.toSet());
        if (constraints.isEmpty()) {
            throw new EasyQueryInvalidOperationException(EasyClassUtil.getSimpleName(entityMetadata.getEntityClass())
                + " has no conflict column for MERGE; specify one in onConflictThen or give the entity a non-generated key");
        }
        return constraints;
    }
}
