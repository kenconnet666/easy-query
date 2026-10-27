package com.easy.query.core.proxy.predicate;

import com.easy.query.core.expression.lambda.SQLActionExpression1;
import com.easy.query.core.func.SQLFunction;
import com.easy.query.core.func.column.ColumnFuncSelector;
import com.easy.query.core.proxy.TablePropColumn;
import com.easy.query.core.proxy.core.EntitySQLContext;
import com.easy.query.core.expression.parser.core.base.scec.core.SQLNativeChainExpressionContextImpl;

/**
 * fork：把 {@link com.easy.query.core.func.SQLFunc#nullSafeEquals} 作为条件加到当前的 where / having / on 里。
 */
final class NullSafePredicates {
    private NullSafePredicates() { }

    static void accept(TablePropColumn left, EntitySQLContext context, SQLActionExpression1<ColumnFuncSelector> right) {
        SQLFunction function = context.getRuntimeContext().fx().nullSafeEquals(s -> s.column(left.getTable(), left.getValue()), right);
        context._executeNativeSql(function.sqlSegment(left.getTable()), c ->
            function.consume(new SQLNativeChainExpressionContextImpl(left.getTable(), c.getSQLNativeExpressionContext())));
    }
}
