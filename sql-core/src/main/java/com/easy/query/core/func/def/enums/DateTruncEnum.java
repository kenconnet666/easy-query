package com.easy.query.core.func.def.enums;

/**
 * fork：日期截断的粒度（{@code dateTrunc}）。截到该粒度的起点，更小的部分清零；WEEK 以周一为一周的第一天（ISO）。
 */
public enum DateTruncEnum {
    YEAR,
    QUARTER,
    MONTH,
    WEEK,
    DAY,
    HOUR,
    MINUTE,
    SECOND
}
