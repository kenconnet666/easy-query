package com.easy.query.hana.config;

import com.easy.query.core.configuration.dialect.AbstractSQLKeyword;

/**
 * fork：HANA 的标识符用双引号。不加引号的名字 HANA 会折成大写，easy-query 总是加引号，所以表名、列名按实体里写的大小写原样使用。
 */
public final class HanaSQLKeyword extends AbstractSQLKeyword {
    @Override
    protected String getQuoteStart() {
        return "\"";
    }

    @Override
    protected String getQuoteEnd() {
        return "\"";
    }
}
