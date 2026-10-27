package com.easy.query.api.proxy.extension.partition;

import com.easy.query.core.exception.EasyQueryInvalidOperationException;
import com.easy.query.core.expression.lambda.SQLActionExpression1;
import com.easy.query.core.expression.parser.core.available.TableAvailable;
import com.easy.query.core.func.SQLFunc;
import com.easy.query.core.func.column.ColumnFuncSelector;
import com.easy.query.core.func.def.PartitionBySQLFunction;
import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.core.EntitySQLContext;
import com.easy.query.core.proxy.extension.functions.type.PartitionByTypeExpression;
import com.easy.query.core.proxy.extension.functions.type.impl.PartitionByTypeExpressionImpl;
import com.easy.query.core.util.EasyArrayUtil;

import java.util.function.BiFunction;

/**
 * fork：窗口函数的构建入口，各个 {@code xxxOver} 共用。
 * <pre>{@code
 * expression.sumOver(o.amount()).partitionBy(o.userId()).orderBy(o.id())   // 分区窗口
 * expression.rowNumberOver().over().orderBy(o.createTime())                // 全局窗口：OVER (ORDER BY …)
 * expression.ntileOver(4).over().orderBy(o.amount())                        // 四分位
 * }</pre>
 *
 * @param <TResult> 结果类型
 */
public class OverBuilder<TResult> {
    private final EntitySQLContext entitySQLContext;
    private final PropTypeColumn<?> argument;
    private final BiFunction<SQLFunc, SQLActionExpression1<ColumnFuncSelector>, PartitionBySQLFunction> function;
    private final Class<?> resultType;

    /**
     * @param argument 函数自身的列（SUM / COUNT … 的参数）；ROW_NUMBER 这类没有参数的为 null
     * @param function 由列选择器生成窗口函数，例如 {@code SQLFunc::sumOver}
     */
    public OverBuilder(EntitySQLContext entitySQLContext, PropTypeColumn<?> argument,
                       BiFunction<SQLFunc, SQLActionExpression1<ColumnFuncSelector>, PartitionBySQLFunction> function, Class<?> resultType) {
        this.entitySQLContext = entitySQLContext;
        this.argument = argument;
        this.function = function;
        this.resultType = resultType;
    }

    /** OVER (PARTITION BY columns …)；整表一个窗口时用 {@link #over()} */
    public PartitionByTypeExpression<TResult> partitionBy(PropTypeColumn<?>... columns) {
        if (EasyArrayUtil.isEmpty(columns)) {
            throw new EasyQueryInvalidOperationException("partition by needs at least one column; use over() for a window over all rows");
        }
        return window(columns);
    }

    /** 不分区的全局窗口：OVER () 或 OVER (ORDER BY …) */
    public PartitionByTypeExpression<TResult> over() {
        return window(new PropTypeColumn<?>[0]);
    }

    private PartitionByTypeExpression<TResult> window(PropTypeColumn<?>[] partitionColumns) {
        TableAvailable table = partitionColumns.length > 0 ? partitionColumns[0].getTable() : argument == null ? null : argument.getTable();
        return new PartitionByTypeExpressionImpl<>(entitySQLContext, table, null, f -> function.apply(f, x -> {
            if (argument != null) {
                PropTypeColumn.columnFuncSelector(x, argument);
            }
            for (PropTypeColumn<?> column : partitionColumns) {
                PropTypeColumn.columnFuncSelector(x, column);
            }
        }), resultType);
    }
}
