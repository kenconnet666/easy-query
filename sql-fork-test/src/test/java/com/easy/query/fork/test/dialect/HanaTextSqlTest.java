package com.easy.query.fork.test.dialect;

import com.easy.query.fork.test.ForkClients;
import com.easy.query.fork.test.entity.ForkPost;
import com.easy.query.hana.Hana;
import com.easy.query.hana.config.HanaDatabaseConfiguration;
import com.easy.query.mysql.config.MySQLDatabaseConfiguration;
import org.junit.Assert;
import org.junit.Test;

/** M4.1：Hana.text 的写法；别的方言上构造时报错。 */
public class HanaTextSqlTest {
    @Test
    public void containsAndFuzzy() {
        Assert.assertTrue(ForkClients.sqlOnly(new HanaDatabaseConfiguration()).queryable(ForkPost.class)
            .where(p -> Hana.text(p.title(), p.userId()).fuzzy("easy", 0.8)).toSQL()
            .endsWith("WHERE CONTAINS((\"title\",\"user_id\"),?,FUZZY(0.8))"));
    }

    @Test
    public void wrongDialectAndBadThreshold() {
        try {
            ForkClients.sqlOnly(new MySQLDatabaseConfiguration()).queryable(ForkPost.class).where(p -> Hana.text(p.title()).contains("x")).toSQL();
            Assert.fail("expected UnsupportedOperationException");
        } catch (UnsupportedOperationException expected) {
            Assert.assertTrue(expected.getMessage().contains("Hana.text"));
        }
        try {
            ForkClients.sqlOnly(new HanaDatabaseConfiguration()).queryable(ForkPost.class).where(p -> Hana.text(p.title()).fuzzy("x", 1.5)).toSQL();
            Assert.fail("expected IllegalArgumentException");
        } catch (IllegalArgumentException expected) {
            // threshold 写进 SQL，只接受 0–1
        }
    }
}
