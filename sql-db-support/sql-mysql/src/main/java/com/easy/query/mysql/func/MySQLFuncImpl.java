package com.easy.query.mysql.func;

import com.easy.query.core.enums.SQLLikeEnum;
import com.easy.query.core.enums.GroupingEnum;
import com.easy.query.core.expression.lambda.SQLActionExpression1;
import com.easy.query.core.func.SQLFuncImpl;
import com.easy.query.core.func.SQLFunction;
import com.easy.query.core.func.column.ColumnFuncSelector;
import com.easy.query.core.func.def.enums.DateTruncEnum;
import com.easy.query.core.func.def.impl.LikeSQLFunction;

/**
 * create time 2023/12/21 10:03
 * 文件说明
 *
 * @author xuejiaming
 */
public class MySQLFuncImpl extends SQLFuncImpl {
    @Override
    public SQLFunction stringCompareTo(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        return new MySQLStringCompareToSQLFunction(getColumnExpressions(sqlExpression));
    }
    @Override
    public SQLFunction maxColumns(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        return new MySQLMaxMinColumnsSQLFunction(true,getColumnExpressions(sqlExpression));
    }
    @Override
    public SQLFunction minColumns(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        return new MySQLMaxMinColumnsSQLFunction(false,getColumnExpressions(sqlExpression));
    }
    @Override
    public SQLFunction like(SQLActionExpression1<ColumnFuncSelector> sqlExpression, boolean like, SQLLikeEnum sqlLike) {
        MySQLLikeSQLFunction likeSQLFunction = new MySQLLikeSQLFunction(getColumnExpressions(sqlExpression), sqlLike);
        if (!like) {
            return not(x -> x.sqlFunc(likeSQLFunction));
        }
        return likeSQLFunction;
    }

    /** fork：null 安全相等用 MySQL 的 <=>，两边各渲染一次 */
    @Override
    public SQLFunction nullSafeEquals(SQLActionExpression1<ColumnFuncSelector> left, SQLActionExpression1<ColumnFuncSelector> right) {
        return anySQLFunction("({0} <=> {1})", s -> {
            left.apply(s);
            right.apply(s);
        });
    }

    /**
     * fork：MySQL 没有 DATE_TRUNC，用 DATE_FORMAT 把更小的部分清零再转回 DATETIME；季度、周再减去月 / 天的偏移（WEEKDAY 周一为 0）
     */
    @Override
    public SQLFunction dateTrunc(SQLActionExpression1<ColumnFuncSelector> sqlExpression, DateTruncEnum unit) {
        switch (unit) {
            case YEAR: return anySQLFunction("CAST(DATE_FORMAT({0},'%Y-01-01 00:00:00') AS DATETIME)", sqlExpression);
            case QUARTER: return anySQLFunction("DATE_SUB(CAST(DATE_FORMAT({0},'%Y-%m-01 00:00:00') AS DATETIME), INTERVAL ((MONTH({1}) - 1) % 3) MONTH)", twice(sqlExpression));
            case MONTH: return anySQLFunction("CAST(DATE_FORMAT({0},'%Y-%m-01 00:00:00') AS DATETIME)", sqlExpression);
            case WEEK: return anySQLFunction("DATE_SUB(CAST(DATE_FORMAT({0},'%Y-%m-%d 00:00:00') AS DATETIME), INTERVAL WEEKDAY({1}) DAY)", twice(sqlExpression));
            case DAY: return anySQLFunction("CAST(DATE_FORMAT({0},'%Y-%m-%d 00:00:00') AS DATETIME)", sqlExpression);
            case HOUR: return anySQLFunction("CAST(DATE_FORMAT({0},'%Y-%m-%d %H:00:00') AS DATETIME)", sqlExpression);
            case MINUTE: return anySQLFunction("CAST(DATE_FORMAT({0},'%Y-%m-%d %H:%i:00') AS DATETIME)", sqlExpression);
            case SECOND: return anySQLFunction("CAST(DATE_FORMAT({0},'%Y-%m-%d %H:%i:%s') AS DATETIME)", sqlExpression);
            default: throw new UnsupportedOperationException("MySQL dateTrunc does not support " + unit);
        }
    }

    /** 模板里同一个参数要出现两次时选两次（占位符不能重复，参数按选择的顺序绑定） */
    private static SQLActionExpression1<ColumnFuncSelector> twice(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        return s -> {
            sqlExpression.apply(s);
            sqlExpression.apply(s);
        };
    }

    /** fork：MySQL 只有 GROUP BY a, b WITH ROLLUP 一种写法（8.0.12 起可与 ORDER BY 同用），没有 CUBE */
    @Override
    public String groupBy(GroupingEnum grouping, String columns) {
        switch (grouping) {
            case ROLLUP: return columns + " WITH ROLLUP";
            case CUBE: throw new UnsupportedOperationException("MySQL does not support GROUP BY CUBE");
            default: return columns;
        }
    }
}
