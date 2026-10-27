package com.easy.query.fork.test.live;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.basic.jdbc.tx.Transaction;
import com.easy.query.fork.test.entity.ForkPost;
import org.junit.Assert;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/** M3.9：一个事务锁住 p1 时，另一个事务 NOWAIT 立即报错、SKIP LOCKED 只拿到其余的行（MySQL 8.0.18、PG 17、HANA）。 */
@RunWith(Parameterized.class)
public class LockWaitLiveTest {
    @Parameterized.Parameters(name = "{0}")
    public static Collection<Object[]> databases() {
        return Arrays.asList(new Object[] {LiveDatabases.mysql8018()}, new Object[] {LiveDatabases.pg17()}, new Object[] {LiveDatabases.hana()});
    }

    private final LiveDatabases.Live live;

    public LockWaitLiveTest(LiveDatabases.Live live) {
        this.live = live;
    }

    @Test
    public void noWaitFailsAndSkipLockedSkips() throws Exception {
        boolean hana = live.name.startsWith("hana");
        String q = live.name.startsWith("mysql") ? "`" : "\"";
        String text = hana ? "NVARCHAR" : "VARCHAR";
        live.executeIgnoring("DROP TABLE " + q + "t_fork_post" + q);
        live.execute((hana ? "CREATE COLUMN TABLE " : "CREATE TABLE ") + q + "t_fork_post" + q + " (" + q + "id" + q + " " + text + "(32) PRIMARY KEY, "
            + q + "user_id" + q + " " + text + "(32), " + q + "title" + q + " " + text + "(200), " + q + "amount" + q + " DECIMAL(12,2))");
        EasyEntityQuery db = live.client();
        db.insertable(Arrays.asList(post("p1"), post("p2"), post("p3"))).executeRows();

        CountDownLatch locked = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService holder = Executors.newSingleThreadExecutor();
        try {
            Future<?> holding = holder.submit(() -> {
                try (Transaction tx = db.beginTransaction()) {
                    db.queryable(ForkPost.class).whereById("p1").forUpdate().toList();
                    locked.countDown();
                    release.await(30, TimeUnit.SECONDS);
                    tx.rollback();
                }
                return null;
            });
            Assert.assertTrue("holder did not lock p1", locked.await(30, TimeUnit.SECONDS));

            try (Transaction tx = db.beginTransaction()) {
                try {
                    db.queryable(ForkPost.class).whereById("p1").forUpdateNoWait().toList();
                    Assert.fail(live.name + ": NOWAIT should fail on a locked row");
                } catch (RuntimeException expected) {
                    // 各库的错误码不同（MySQL 3572、PG 55P03、HANA 146 resource busy），确认是锁冲突而不是语法错误
                    String message = String.valueOf(rootMessage(expected)).toLowerCase(java.util.Locale.ROOT);
                    Assert.assertTrue(live.name + ": " + message, message.contains("lock") || message.contains("busy") || message.contains("nowait"));
                }
                tx.rollback();
            }

            try (Transaction tx = db.beginTransaction()) {
                List<String> free = db.queryable(ForkPost.class).orderBy(p -> p.id().asc()).forUpdateSkipLocked().toList()
                    .stream().map(ForkPost::getId).collect(Collectors.toList());
                Assert.assertEquals(Arrays.asList("p2", "p3"), free);
                tx.rollback();
            }

            release.countDown();
            holding.get(30, TimeUnit.SECONDS);
        } finally {
            release.countDown();
            holder.shutdownNow();
        }
    }

    private static String rootMessage(Throwable e) {
        Throwable root = e;
        while (root.getCause() != null) {
            root = root.getCause();
        }
        return root.getMessage();
    }

    private static ForkPost post(String id) {
        ForkPost p = new ForkPost();
        p.setId(id);
        p.setUserId("u1");
        p.setTitle(id);
        p.setAmount(BigDecimal.ONE);
        return p;
    }
}
