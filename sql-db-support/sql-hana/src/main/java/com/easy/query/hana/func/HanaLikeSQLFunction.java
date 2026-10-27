package com.easy.query.hana.func;

import com.easy.query.core.common.LikeFunctionTemplateGenerator;
import com.easy.query.core.enums.SQLLikeEnum;
import com.easy.query.core.expression.parser.core.available.TableAvailable;
import com.easy.query.core.func.column.ColumnExpression;
import com.easy.query.core.func.def.impl.AbstractLikeSQLFunction;

import java.util.List;

/**
 * fork：HANA 的 LIKE。模式用 {@code ||} 拼；值里有 % 或 _ 时用 {@code !} 转义（HANA 没有默认转义符，要写 ESCAPE）。
 */
public class HanaLikeSQLFunction extends AbstractLikeSQLFunction {
    private final List<ColumnExpression> columnExpressions;
    private final SQLLikeEnum sqlLikeEnum;

    public HanaLikeSQLFunction(List<ColumnExpression> columnExpressions, SQLLikeEnum sqlLikeEnum) {
        this.columnExpressions = columnExpressions;
        this.sqlLikeEnum = sqlLikeEnum;
    }

    @Override
    public String sqlSegment(TableAvailable defaultTable) {
        LikeFunctionTemplateGenerator generator = new LikeFunctionTemplateGenerator(columnExpressions, sqlLikeEnum, this::getColumnFuncValueExpression,
            "{0} LIKE ({1} || '%') ESCAPE '!'",
            "{0} LIKE ('%' || {1}) ESCAPE '!'",
            "{0} LIKE ('%' || {1} || '%') ESCAPE '!'",
            "{0} LIKE ({1} || '%')",
            "{0} LIKE ('%' || {1})",
            "{0} LIKE ('%' || {1} || '%')") {
            @Override
            protected String escape(String value) {
                return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
            }
        };
        return generator.sqlSegment(defaultTable);
    }

    @Override
    public int paramMarks() {
        return columnExpressions.size();
    }

    @Override
    protected List<ColumnExpression> getColumnExpressions() {
        return columnExpressions;
    }
}
