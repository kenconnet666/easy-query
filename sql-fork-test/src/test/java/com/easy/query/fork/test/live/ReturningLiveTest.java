package com.easy.query.fork.test.live;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.fork.test.entity.ForkPost;
import com.easy.query.pgsql.PgSQL;
import org.junit.Assert;
import org.junit.Test;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/** M3.8：PG 17 上 DELETE / UPDATE … RETURNING 读回受影响的行。 */
public class ReturningLiveTest {
    private final LiveDatabases.Live live = LiveDatabases.pg17();

    @Test
    public void deleteAndUpdateReturnRows() {
        live.executeIgnoring("DROP TABLE \"t_fork_post\"");
        live.execute("CREATE TABLE \"t_fork_post\" (\"id\" VARCHAR(32) PRIMARY KEY, \"user_id\" VARCHAR(32), \"title\" VARCHAR(200), \"amount\" DECIMAL(12,2))",
            "INSERT INTO \"t_fork_post\" VALUES ('p1','u1','a',1),('p2','u1','b',2),('p3','u2','c',3)");
        EasyEntityQuery db = live.client();

        List<ForkPost> updated = PgSQL.returning(db.updatable(ForkPost.class)
                .setColumns(p -> p.amount().increment(10))
                .where(p -> p.id().eq("p3")))
            .toList();
        Assert.assertEquals(1, updated.size());
        Assert.assertEquals(0, new BigDecimal("13").compareTo(updated.get(0).getAmount()));
        Assert.assertEquals("c", updated.get(0).getTitle());

        List<ForkPost> deleted = PgSQL.returning(db.deletable(ForkPost.class).allowDeleteStatement(true).where(p -> p.userId().eq("u1"))).toList();
        Assert.assertEquals(Arrays.asList("p1", "p2"), deleted.stream().map(ForkPost::getId).sorted().collect(Collectors.toList()));
        Assert.assertEquals(1L, db.queryable(ForkPost.class).count());
    }
}
