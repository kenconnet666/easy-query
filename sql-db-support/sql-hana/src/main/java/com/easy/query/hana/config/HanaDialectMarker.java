package com.easy.query.hana.config;

/**
 * fork：HANA 方言的标记，注册在 {@link HanaDatabaseConfiguration} 里，供 HANA 专属函数入口判断当前方言（见 docs/fork/decisions/0001）。
 */
public final class HanaDialectMarker {
    public static final HanaDialectMarker INSTANCE = new HanaDialectMarker();

    private HanaDialectMarker() { }
}
