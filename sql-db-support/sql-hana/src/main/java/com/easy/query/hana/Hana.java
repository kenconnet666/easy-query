package com.easy.query.hana;

import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.extension.dialect.DialectExpressions;
import com.easy.query.hana.config.HanaDialectMarker;
import com.easy.query.hana.proxy.HanaText;

/**
 * fork：SAP HANA 专属函数的入口（代理 API）。按列包装，条件方法与 {@code u.name().eq(..)} 一样是语句：
 * <pre>{@code
 * easyEntityQuery.queryable(Doc.class)
 *     .where(d -> Hana.text(d.title(), d.body()).fuzzy("easy qurey", 0.8))     // CONTAINS((title, body), ?, FUZZY(0.8))
 *     .orderBy(d -> Hana.text(d.title(), d.body()).score().desc())
 *     .toList();
 * }</pre>
 * 能用在隐式子查询里；用到别的方言上时构造表达式就报错。
 */
public final class Hana {
    private Hana() { }

    /** 在这些列上做文本检索（CONTAINS）；多列时任一列匹配即可 */
    public static HanaText text(PropTypeColumn<?>... columns) {
        if (columns == null || columns.length == 0) {
            throw new IllegalArgumentException("Hana.text needs at least one column");
        }
        DialectExpressions.require(columns[0], HanaDialectMarker.class, "Hana.text");
        return new HanaText(columns);
    }
}
