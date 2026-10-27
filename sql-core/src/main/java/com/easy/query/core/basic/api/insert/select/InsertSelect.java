package com.easy.query.core.basic.api.insert.select;

import com.easy.query.core.basic.extension.tablemapping.TableNameMapping;
import com.easy.query.core.basic.jdbc.executor.ExecutorContext;
import com.easy.query.core.basic.jdbc.parameter.DefaultToSQLContext;
import com.easy.query.core.basic.jdbc.parameter.EasyConstSQLParameter;
import com.easy.query.core.basic.jdbc.parameter.SQLParameter;
import com.easy.query.core.basic.jdbc.parameter.ToSQLContext;
import com.easy.query.core.basic.api.select.Query;
import com.easy.query.core.configuration.dialect.SQLKeyword;
import com.easy.query.core.context.QueryRuntimeContext;
import com.easy.query.core.enums.ContextTypeEnum;
import com.easy.query.core.enums.ExecuteMethodEnum;
import com.easy.query.core.expression.sql.builder.EasyExpressionContext;
import com.easy.query.core.metadata.ColumnMetadata;
import com.easy.query.core.metadata.EntityMetadata;
import com.easy.query.core.util.EasyToSQLUtil;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * fork：用查询结果插入，{@code INSERT INTO 目标 (列…) SELECT eq_src.列…, ? FROM (源查询) eq_src}。
 * 列清单来自实体的元数据（源查询默认会选出的列，顺序相同），不用读数据库的列信息，也不用拼 SQL：
 * <pre>{@code
 * long moved = InsertSelect.from(db.queryable(WorkItemEntity.class).where(w -> w.instanceId().in(ids)))
 *     .into("flow_work_item_archive")       // 目标表，默认是实体自己的表
 *     .column("archived_at", now)          // 只在目标表上有的列，写成参数
 *     .executeRows();
 * }</pre>
 * 源查询的条件、参数（含值转换）照它自己生成；源查询不能自己 select 别的列（要的是实体默认的整行）。
 */
public final class InsertSelect {
    private static final String SOURCE = "eq_src";

    private final Query<?> source;
    private String targetTable;
    private final Map<String, Object> extraColumns = new LinkedHashMap<>();

    private InsertSelect(Query<?> source) {
        this.source = Objects.requireNonNull(source, "source");
    }

    /** 以源查询的实体为列清单 */
    public static InsertSelect from(Query<?> source) {
        return new InsertSelect(source);
    }

    /** 插到这张表（不加引号的表名）；不写时是实体的表（受 TableNameMapping 作用域影响） */
    public InsertSelect into(String tableName) {
        if (tableName == null || tableName.trim().isEmpty()) {
            throw new IllegalArgumentException("target table is empty");
        }
        this.targetTable = tableName;
        return this;
    }

    /** 目标表上额外的一列（实体里没有，如归档时间），每行都写同一个值 */
    public InsertSelect column(String columnName, Object value) {
        if (columnName == null || columnName.trim().isEmpty()) {
            throw new IllegalArgumentException("column name is empty");
        }
        extraColumns.put(columnName, value);
        return this;
    }

    /** 生成的 SQL（调试用） */
    public String toSQL() {
        return build().sql;
    }

    /** 执行，返回插入的行数 */
    public long executeRows() {
        Statement statement = build();
        QueryRuntimeContext runtimeContext = source.getRuntimeContext();
        ExecutorContext executorContext = ExecutorContext.create(new EasyExpressionContext(runtimeContext, ContextTypeEnum.EXECUTE), false, ExecuteMethodEnum.UNKNOWN);
        return runtimeContext.getEntityExpressionPrepareExecutor().executeSQLRows(executorContext, statement.sql, statement.parameters);
    }

    private Statement build() {
        QueryRuntimeContext runtimeContext = source.getRuntimeContext();
        EntityMetadata entityMetadata = runtimeContext.getEntityMetadataManager().getEntityMetadata(source.queryClass());
        SQLKeyword keyword = runtimeContext.getQueryConfiguration().getDialect();
        List<String> columns = new ArrayList<>();
        List<String> values = new ArrayList<>();
        for (ColumnMetadata column : entityMetadata.getColumns()) {
            // 与默认投影一致：不自动选出的列（大字段等）源查询里没有
            if (!column.isAutoSelect()) {
                continue;
            }
            String name = keyword.getQuoteName(column.getName());
            columns.add(name);
            values.add(SOURCE + "." + name);
        }
        if (columns.isEmpty()) {
            throw new IllegalStateException(entityMetadata.getEntityClass().getName() + " has no column to copy");
        }
        ToSQLContext context = DefaultToSQLContext.defaultToSQLContext(source.getSQLEntityExpressionBuilder().getExpressionContext().getTableContext());
        String sourceSQL = source.toSQL(context);
        // 参数按 ? 在 SQL 里出现的顺序：额外列的 ? 在外层 SELECT 列表里，排在源查询的参数前面
        List<SQLParameter> parameters = new ArrayList<>();
        for (Map.Entry<String, Object> extra : extraColumns.entrySet()) {
            columns.add(keyword.getQuoteName(extra.getKey()));
            values.add("?");
            parameters.add(new EasyConstSQLParameter(null, null, extra.getValue()));
        }
        parameters.addAll(context.getParameters());
        String sql = "INSERT INTO " + target(entityMetadata, keyword, runtimeContext) + " (" + String.join(",", columns) + ") SELECT "
            + String.join(",", values) + " FROM (" + sourceSQL + ") " + SOURCE;
        return new Statement(sql, parameters);
    }

    private String target(EntityMetadata entityMetadata, SQLKeyword keyword, QueryRuntimeContext runtimeContext) {
        String table = targetTable;
        if (table == null) {
            String mapped = TableNameMapping.currentTableName(entityMetadata.getEntityClass());
            table = mapped != null ? mapped : entityMetadata.getTableName();
        }
        String schema = runtimeContext.getRuntimeSchemaProvider().getSchema(entityMetadata);
        return EasyToSQLUtil.getSchemaTableName(keyword, schema, table, null, null);
    }

    private static final class Statement {
        final String sql;
        final List<SQLParameter> parameters;

        Statement(String sql, List<SQLParameter> parameters) {
            this.sql = sql;
            this.parameters = parameters;
        }
    }
}
