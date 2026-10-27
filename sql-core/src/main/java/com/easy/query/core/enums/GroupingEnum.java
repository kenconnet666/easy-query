package com.easy.query.core.enums;

/**
 * fork：GROUP BY 的汇总方式。ROLLUP 按键从右往左逐级小计并带总计；CUBE 对键的所有组合小计。
 * 小计行里被汇总掉的键为 NULL，用 {@code GROUPING(key)} 区分（1 表示该键被汇总）。
 */
public enum GroupingEnum {
    PLAIN,
    ROLLUP,
    CUBE
}
