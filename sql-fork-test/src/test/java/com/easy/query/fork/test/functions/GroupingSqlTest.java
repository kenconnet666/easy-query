package com.easy.query.fork.test.functions;

import com.easy.query.core.proxy.sql.GroupKeys;
import com.easy.query.core.proxy.sql.Select;
import com.easy.query.fork.test.ForkClients;
import com.easy.query.fork.test.entity.ForkPost;
import com.easy.query.mysql.config.MySQLDatabaseConfiguration;
import com.easy.query.pgsql.config.PgSQLDatabaseConfiguration;
import org.junit.Assert;
import org.junit.Test;

/** M3.5：ROLLUP / CUBE 与 GROUPING()。 */
public class GroupingSqlTest {

    @Test
    public void postgresRollupAndCube() {
        Assert.assertEquals("SELECT t.\"user_id\" AS \"value1\",t.\"title\" AS \"value2\",SUM(t.\"amount\") AS \"value3\",GROUPING(t.\"title\") AS \"value4\""
                + " FROM \"t_fork_post\" t GROUP BY ROLLUP(t.\"user_id\",t.\"title\")",
            ForkClients.sqlOnly(new PgSQLDatabaseConfiguration()).queryable(ForkPost.class)
                .groupBy(p -> GroupKeys.of(p.userId(), p.title()))
                .rollup()
                .select(g -> Select.DRAFT.of(g.key1(), g.key2(), g.groupTable().amount().sum(), g.expression().grouping(g.key2())))
                .toSQL());
        Assert.assertTrue(ForkClients.sqlOnly(new PgSQLDatabaseConfiguration()).queryable(ForkPost.class)
            .groupBy(p -> GroupKeys.of(p.userId(), p.title())).cube()
            .select(g -> Select.DRAFT.of(g.key1(), g.count())).toSQL()
            .endsWith(" GROUP BY CUBE(t.\"user_id\",t.\"title\")"));
    }

    @Test
    public void mysqlWithRollupAndNoCube() {
        Assert.assertTrue(ForkClients.sqlOnly(new MySQLDatabaseConfiguration()).queryable(ForkPost.class)
            .groupBy(p -> GroupKeys.of(p.userId())).rollup()
            .select(g -> Select.DRAFT.of(g.key1(), g.count())).toSQL()
            .endsWith(" GROUP BY t.`user_id` WITH ROLLUP"));
        try {
            ForkClients.sqlOnly(new MySQLDatabaseConfiguration()).queryable(ForkPost.class)
                .groupBy(p -> GroupKeys.of(p.userId())).cube()
                .select(g -> Select.DRAFT.of(g.key1(), g.count())).toSQL();
            Assert.fail("expected UnsupportedOperationException");
        } catch (UnsupportedOperationException expected) {
            Assert.assertTrue(expected.getMessage().contains("CUBE"));
        }
    }

    @Test
    public void plainGroupByIsUnchanged() {
        Assert.assertTrue(ForkClients.sqlOnly(new MySQLDatabaseConfiguration()).queryable(ForkPost.class)
            .groupBy(p -> GroupKeys.of(p.userId()))
            .select(g -> Select.DRAFT.of(g.key1(), g.count())).toSQL()
            .endsWith(" GROUP BY t.`user_id`"));
    }

    @Test
    public void rollupNeedsGroupBy() {
        try {
            ForkClients.sqlOnly(new MySQLDatabaseConfiguration()).queryable(ForkPost.class).rollup();
            Assert.fail("expected IllegalStateException");
        } catch (IllegalStateException expected) {
            Assert.assertTrue(expected.getMessage(), expected.getMessage().contains("groupBy"));
        }
    }
}
