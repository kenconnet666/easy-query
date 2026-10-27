package com.easy.query.fork.test.live;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.basic.api.insert.select.InsertSelect;
import com.easy.query.fork.test.entity.ForkPost;
import org.junit.Assert;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collection;

/** M3.2：INSERT … SELECT 在 MySQL 8.0.18、PG 17、HANA 上执行：搬进归档表并带上归档时间。 */
@RunWith(Parameterized.class)
public class InsertSelectLiveTest {
    @Parameterized.Parameters(name = "{0}")
    public static Collection<Object[]> databases() {
        return Arrays.asList(new Object[] {LiveDatabases.mysql8018()}, new Object[] {LiveDatabases.pg17()}, new Object[] {LiveDatabases.hana()});
    }

    private final LiveDatabases.Live live;

    public InsertSelectLiveTest(LiveDatabases.Live live) {
        this.live = live;
    }

    @Test
    public void copyMatchingRowsWithArchiveTime() {
        boolean hana = live.name.startsWith("hana");
        String q = hana || live.name.startsWith("pg") ? "\"" : "`";
        String table = hana ? "CREATE COLUMN TABLE " : "CREATE TABLE ";
        String text = hana ? "NVARCHAR" : "VARCHAR";
        String time = live.name.startsWith("mysql") ? "DATETIME" : "TIMESTAMP";
        live.executeIgnoring("DROP TABLE " + q + "t_fork_post" + q, "DROP TABLE " + q + "t_fork_post_archive" + q);
        String columns = "(" + q + "id" + q + " " + text + "(32) PRIMARY KEY, " + q + "user_id" + q + " " + text + "(32), "
            + q + "title" + q + " " + text + "(200), " + q + "amount" + q + " DECIMAL(12,2)";
        live.execute(table + q + "t_fork_post" + q + " " + columns + ")",
            table + q + "t_fork_post_archive" + q + " " + columns + ", " + q + "archived_at" + q + " " + time + ")");
        EasyEntityQuery db = live.client();
        db.insertable(Arrays.asList(post("p1", "u1"), post("p2", "u1"), post("p3", "u2"))).executeRows();

        LocalDateTime now = LocalDateTime.of(2026, 10, 28, 9, 0, 0);
        long moved = InsertSelect.from(db.queryable(ForkPost.class).where(p -> p.userId().eq("u1")))
            .into("t_fork_post_archive")
            .column("archived_at", now)
            .executeRows();
        Assert.assertEquals(2L, moved);
        Assert.assertEquals(2L, db.queryable(ForkPost.class).asTable("t_fork_post_archive").count());
        Assert.assertEquals(new BigDecimal("1.50"), db.queryable(ForkPost.class).asTable("t_fork_post_archive").whereById("p2").singleNotNull().getAmount());
        String archivedAt = String.valueOf(db.sqlQuery("SELECT " + q + "archived_at" + q + " FROM " + q + "t_fork_post_archive" + q
            + " WHERE " + q + "id" + q + " = 'p1'", Object.class).get(0));
        Assert.assertTrue(archivedAt, archivedAt.startsWith("2026-10-28") && archivedAt.contains("09:00"));
    }

    private static ForkPost post(String id, String userId) {
        ForkPost p = new ForkPost();
        p.setId(id);
        p.setUserId(userId);
        p.setTitle("t-" + id);
        p.setAmount(new BigDecimal("1.50"));
        return p;
    }
}
