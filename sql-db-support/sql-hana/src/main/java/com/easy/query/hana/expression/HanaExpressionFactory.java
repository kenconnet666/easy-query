package com.easy.query.hana.expression;

import com.easy.query.core.context.QueryRuntimeContext;
import com.easy.query.core.enums.MultiTableTypeEnum;
import com.easy.query.core.enums.SQLUnionEnum;
import com.easy.query.core.expression.parser.core.available.TableAvailable;
import com.easy.query.core.expression.sql.expression.AnonymousEntityQuerySQLExpression;
import com.easy.query.core.expression.sql.expression.EntityDeleteSQLExpression;
import com.easy.query.core.expression.sql.expression.EntityInsertSQLExpression;
import com.easy.query.core.expression.sql.expression.EntityQuerySQLExpression;
import com.easy.query.core.expression.sql.expression.EntityTableSQLExpression;
import com.easy.query.core.expression.sql.expression.EntityUpdateSQLExpression;
import com.easy.query.core.expression.sql.expression.factory.ExpressionFactory;
import com.easy.query.core.expression.sql.expression.impl.AnonymousEntityQuerySQLExpressionImpl;
import com.easy.query.core.expression.sql.expression.impl.AnonymousEntityTableSQLExpressionImpl;
import com.easy.query.core.expression.sql.expression.impl.AnonymousTreeCTEQuerySQLExpressionImpl;
import com.easy.query.core.expression.sql.expression.impl.AnonymousUnionQuerySQLExpressionImpl;
import com.easy.query.core.expression.sql.expression.impl.EntitySQLExpressionMetadata;
import com.easy.query.core.expression.sql.expression.impl.TableSQLExpressionImpl;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/**
 * fork：HANA 的 SQL 表达式。查询基本沿用核心实现（HANA 的分页同样是 {@code LIMIT n OFFSET m}，也支持 {@code FOR UPDATE}），
 * 只去掉 EXISTS 子查询里的 LIMIT（见 {@link HanaQuerySQLExpression}）；
 * 插入或更新、关联更新、关联删除各有 HANA 的写法。
 */
public class HanaExpressionFactory implements ExpressionFactory {
    @Override
    public EntityQuerySQLExpression createEasyQuerySQLExpression(EntitySQLExpressionMetadata entitySQLExpressionMetadata) {
        return new HanaQuerySQLExpression(entitySQLExpressionMetadata);
    }

    @Override
    public EntityInsertSQLExpression createEasyInsertSQLExpression(EntitySQLExpressionMetadata entitySQLExpressionMetadata, EntityTableSQLExpression entityTableSQLExpression) {
        return new HanaInsertSQLExpression(entitySQLExpressionMetadata, entityTableSQLExpression);
    }

    @Override
    public EntityUpdateSQLExpression createEasyUpdateSQLExpression(EntitySQLExpressionMetadata entitySQLExpressionMetadata, EntityTableSQLExpression entityTableSQLExpression) {
        return new HanaUpdateSQLExpression(entitySQLExpressionMetadata, entityTableSQLExpression);
    }

    @Override
    public EntityDeleteSQLExpression createEasyDeleteSQLExpression(EntitySQLExpressionMetadata entitySQLExpressionMetadata, EntityTableSQLExpression entityTableSQLExpression) {
        return new HanaDeleteSQLExpression(entitySQLExpressionMetadata, entityTableSQLExpression);
    }

    @Override
    public EntityTableSQLExpression createEntityTableSQLExpression(TableAvailable entityTable, MultiTableTypeEnum multiTableType, QueryRuntimeContext runtimeContext) {
        return new TableSQLExpressionImpl(entityTable, multiTableType, runtimeContext);
    }

    @Override
    public EntityTableSQLExpression createAnonymousEntityTableSQLExpression(TableAvailable entityTable, MultiTableTypeEnum multiTableType, EntityQuerySQLExpression entityQuerySQLExpression, QueryRuntimeContext runtimeContext) {
        return new AnonymousEntityTableSQLExpressionImpl(entityTable, multiTableType, entityQuerySQLExpression, runtimeContext);
    }

    @Override
    public AnonymousEntityQuerySQLExpression createEasyAnonymousQuerySQLExpression(EntitySQLExpressionMetadata entitySQLExpressionMetadata, String sql, Collection<Object> sqlParams) {
        return new AnonymousEntityQuerySQLExpressionImpl(entitySQLExpressionMetadata, sql, sqlParams);
    }

    @Override
    public AnonymousEntityQuerySQLExpression createEasyAnonymousUnionQuerySQLExpression(EntitySQLExpressionMetadata entitySQLExpressionMetadata, List<EntityQuerySQLExpression> entityQuerySQLExpressions, SQLUnionEnum sqlUnion) {
        return new AnonymousUnionQuerySQLExpressionImpl(entitySQLExpressionMetadata, new ArrayList<>(entityQuerySQLExpressions), sqlUnion);
    }

    @Override
    public AnonymousEntityQuerySQLExpression createEasyAnonymousCTEQuerySQLExpression(String cteTableName, List<String> columnNames, EntitySQLExpressionMetadata entitySQLExpressionMetadata, EntityQuerySQLExpression querySQLExpression) {
        return new AnonymousTreeCTEQuerySQLExpressionImpl(cteTableName, entitySQLExpressionMetadata, querySQLExpression);
    }
}
