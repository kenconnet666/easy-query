package com.easy.query.core.expression.segment.builder;

import com.easy.query.core.basic.jdbc.parameter.ToSQLContext;
import com.easy.query.core.enums.GroupingEnum;
import com.easy.query.core.func.SQLFunc;

/**
 * fork：带 ROLLUP / CUBE 的 GROUP BY 段。生成 SQL 表达式时才包上（{@code QueryExpressionBuilder.toExpression}），
 * 构建期仍是普通的分组键列表，所以 select 里按键取列等逻辑不受影响；写法由方言的 {@link SQLFunc#groupBy} 决定。
 */
public class GroupingSQLBuilderSegment extends GroupBySQLBuilderSegmentImpl {
    private final GroupingEnum grouping;
    private final SQLFunc fx;

    public GroupingSQLBuilderSegment(GroupingEnum grouping, SQLFunc fx) {
        this.grouping = grouping;
        this.fx = fx;
    }

    @Override
    public String toSQL(ToSQLContext toSQLContext) {
        return fx.groupBy(grouping, super.toSQL(toSQLContext));
    }

    @Override
    public SQLBuilderSegment cloneSQLBuilder() {
        GroupingSQLBuilderSegment clone = new GroupingSQLBuilderSegment(grouping, fx);
        copyTo(clone);
        return clone;
    }
}
