package com.easy.query.fork.test.dialect;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.fork.test.ForkClients;
import com.easy.query.fork.test.entity.ForkPost;
import com.easy.query.mysql.config.MySQLDatabaseConfiguration;
import com.easy.query.pgsql.PgSQL;
import com.easy.query.pgsql.config.PgSQLDatabaseConfiguration;
import org.junit.Assert;
import org.junit.Test;

import java.math.BigDecimal;

/** M3.8：PgSQL.returning 在 UPDATE / DELETE 末尾追加 RETURNING *；非 PG 方言构造时报错。 */
public class ReturningSqlTest {
    private final EasyEntityQuery pg = ForkClients.sqlOnly(new PgSQLDatabaseConfiguration());

    @Test
    public void deleteAndUpdateReturning() {
        Assert.assertEquals("DELETE FROM \"t_fork_post\" WHERE \"user_id\" = ? RETURNING *",
            PgSQL.returning(pg.deletable(ForkPost.class).allowDeleteStatement(true).where(p -> p.userId().eq("u1"))).toSQL());
        Assert.assertEquals("UPDATE \"t_fork_post\" SET \"amount\" = ? WHERE \"id\" = ? RETURNING *",
            PgSQL.returning(pg.updatable(ForkPost.class).setColumns(p -> p.amount().set(BigDecimal.TEN)).where(p -> p.id().eq("p1"))).toSQL());
    }

    @Test
    public void otherDialectsAreRejected() {
        EasyEntityQuery mysql = ForkClients.sqlOnly(new MySQLDatabaseConfiguration());
        try {
            PgSQL.returning(mysql.deletable(ForkPost.class).allowDeleteStatement(true).where(p -> p.userId().eq("u1")));
            Assert.fail("expected UnsupportedOperationException");
        } catch (UnsupportedOperationException expected) {
            Assert.assertTrue(expected.getMessage(), expected.getMessage().contains("PgSQL.returning"));
        }
    }
}
