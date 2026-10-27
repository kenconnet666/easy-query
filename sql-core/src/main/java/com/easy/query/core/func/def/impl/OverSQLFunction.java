package com.easy.query.core.func.def.impl;

import com.easy.query.core.expression.parser.core.available.TableAvailable;
import com.easy.query.core.expression.segment.builder.SQLBuilderSegment;
import com.easy.query.core.expression.segment.impl.CaseWhenSQLSegment;
import com.easy.query.core.func.SQLFunction;
import com.easy.query.core.func.column.ColumnExpression;
import com.easy.query.core.func.column.impl.ColumSQLExpressionImpl;
import com.easy.query.core.func.column.impl.ColumnFunctionExpressionImpl;
import com.easy.query.core.func.def.AbstractExpressionSQLFunction;
import com.easy.query.core.func.def.PartitionBySQLFunction;
import com.easy.query.core.func.def.WindowFrame;
import com.easy.query.core.util.EasySQLSegmentUtil;

import java.util.List;

/**
 * fork：所有窗口函数共用的渲染，取代原来 ROW_NUMBER / RANK / SUM … 各一份的实现。
 * <p>
 * columnExpressions 的排列：先是函数自身的参数（{@code argumentCount} 个，例如 SUM 的列），再是 PARTITION BY 的列，
 * 之后由 {@link #addOrder} 追加 ORDER BY 的项。没有 PARTITION BY 列时是全局窗口（{@code OVER ()} / {@code OVER (ORDER BY …)}）。
 * <pre>
 * (SUM({0}) OVER (PARTITION BY {1} ORDER BY {2} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))
 * </pre>
 */
public class OverSQLFunction extends AbstractExpressionSQLFunction implements PartitionBySQLFunction {
    private final String function;
    private final int argumentCount;
    private final int partitionEnd;
    private final List<ColumnExpression> columnExpressions;
    private WindowFrame frame;

    /**
     * @param function      OVER 之前的部分，参数用 {0}…：{@code "SUM({0})"}、{@code "ROW_NUMBER()"}、{@code "NTILE(4)"}
     * @param argumentCount function 用到的参数个数（排在 columnExpressions 最前）
     */
    public OverSQLFunction(String function, int argumentCount, List<ColumnExpression> columnExpressions) {
        this.function = function;
        this.argumentCount = argumentCount;
        this.columnExpressions = columnExpressions;
        this.partitionEnd = columnExpressions.size();
    }

    @Override
    public String sqlSegment(TableAvailable defaultTable) {
        StringBuilder over = new StringBuilder();
        appendList(over, "PARTITION BY ", argumentCount, partitionEnd);
        appendList(over, "ORDER BY ", partitionEnd, columnExpressions.size());
        if (frame != null) {
            if (over.length() > 0) {
                over.append(' ');
            }
            over.append(frame.toSQL());
        }
        return "(" + function + " OVER (" + over + "))";
    }

    private void appendList(StringBuilder sql, String keyword, int from, int to) {
        if (from >= to) {
            return;
        }
        if (sql.length() > 0) {
            sql.append(' ');
        }
        sql.append(keyword);
        for (int i = from; i < to; i++) {
            if (i > from) {
                sql.append(", ");
            }
            sql.append('{').append(i).append('}');
        }
    }

    @Override
    public int paramMarks() {
        return columnExpressions.size();
    }

    @Override
    protected List<ColumnExpression> getColumnExpressions() {
        return columnExpressions;
    }

    @Override
    public PartitionBySQLFunction addOrder(SQLFunction sqlFunction) {
        columnExpressions.add(new ColumnFunctionExpressionImpl(null, sqlFunction));
        return this;
    }

    @Override
    public PartitionBySQLFunction addOrder(SQLBuilderSegment sqlSegment) {
        columnExpressions.add(new ColumSQLExpressionImpl(new CaseWhenSQLSegment(toSQLContext -> sqlSegment.toSQL(toSQLContext), visitor -> EasySQLSegmentUtil.tableVisit(sqlSegment, visitor))));
        return this;
    }

    @Override
    public PartitionBySQLFunction frame(WindowFrame frame) {
        this.frame = frame;
        return this;
    }
}
