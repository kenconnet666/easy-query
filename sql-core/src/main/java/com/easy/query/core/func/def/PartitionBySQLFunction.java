package com.easy.query.core.func.def;

import com.easy.query.core.expression.segment.builder.SQLBuilderSegment;
import com.easy.query.core.func.SQLFunction;

/**
 * create time 2024/8/4 15:40
 * 窗口函数：OVER 里的 ORDER BY 与 frame 在构造之后追加
 *
 * @author xuejiaming
 */
public interface PartitionBySQLFunction extends SQLFunction{
    PartitionBySQLFunction addOrder(SQLFunction sqlFunction);
    PartitionBySQLFunction addOrder(SQLBuilderSegment sqlSegment);

    /**
     * fork：设置 frame 子句（ROWS / RANGE BETWEEN …）；再次调用覆盖前一次
     */
    default PartitionBySQLFunction frame(WindowFrame frame) {
        throw new UnsupportedOperationException(getClass().getSimpleName() + " does not support window frames");
    }
}
