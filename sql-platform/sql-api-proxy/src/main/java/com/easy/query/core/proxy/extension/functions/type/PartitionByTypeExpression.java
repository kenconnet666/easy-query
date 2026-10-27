package com.easy.query.core.proxy.extension.functions.type;

import com.easy.query.core.func.def.WindowFrame;
import com.easy.query.core.proxy.PropTypeColumn;

/**
 * create time 2024/8/4 15:29
 * 文件说明
 *
 * @author xuejiaming
 */
public interface PartitionByTypeExpression<T> extends AnyTypeExpression<T> {
    /**
     * 排序列 ASC
     * @param propTypeColumn
     * @return
     * @param <TProperty>
     */
    default <TProperty> PartitionByTypeExpression<T> orderBy(PropTypeColumn<TProperty> propTypeColumn) {
        return orderBy(true, propTypeColumn);
    }

    /**
     * 排序列 ASC
     * @param condition 是否生效
     * @param propTypeColumn
     * @return
     * @param <TProperty>
     */
    <TProperty> PartitionByTypeExpression<T> orderBy(boolean condition, PropTypeColumn<TProperty> propTypeColumn);
    /**
     * 排序列 DESC
     * @param propTypeColumn
     * @return
     * @param <TProperty>
     */
    default <TProperty> PartitionByTypeExpression<T> orderByDescending(PropTypeColumn<TProperty> propTypeColumn) {
        return orderByDescending(true, propTypeColumn);
    }

    /**
     * 排序列 DESC
     * @param condition 是否生效
     * @param propTypeColumn
     * @return
     * @param <TProperty>
     */
    <TProperty> PartitionByTypeExpression<T> orderByDescending(boolean condition, PropTypeColumn<TProperty> propTypeColumn);

    /**
     * fork：ROWS BETWEEN start AND end，按物理行数取窗口，例如累计和 {@code rows(Bound.unboundedPreceding(), Bound.currentRow())}
     */
    default PartitionByTypeExpression<T> rows(WindowFrame.Bound start, WindowFrame.Bound end) {
        return frame(WindowFrame.rows(start, end));
    }

    /**
     * fork：RANGE BETWEEN start AND end，按 ORDER BY 的值取窗口（值相同的行同进同出）
     */
    default PartitionByTypeExpression<T> range(WindowFrame.Bound start, WindowFrame.Bound end) {
        return frame(WindowFrame.range(start, end));
    }

    /**
     * fork：设置 frame 子句；frame 要放在 orderBy 之后（SQL 里 frame 跟在 ORDER BY 后面）
     */
    PartitionByTypeExpression<T> frame(WindowFrame frame);
}
