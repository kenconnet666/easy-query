package com.easy.query.fork.test.live;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.func.def.WindowFrame.Bound;
import com.easy.query.core.proxy.core.draft.Draft4;
import com.easy.query.core.proxy.sql.Select;
import com.easy.query.fork.test.entity.ForkPost;
import org.junit.Assert;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;

/** M3.4：累计和（ROWS frame）、全局窗口的 ROW_NUMBER、NTILE 在 MySQL 8.0.18、PG 17、HANA 上执行。 */
@RunWith(Parameterized.class)
public class WindowLiveTest {
    @Parameterized.Parameters(name = "{0}")
    public static Collection<Object[]> databases() {
        return Arrays.asList(new Object[] {LiveDatabases.mysql8018()}, new Object[] {LiveDatabases.pg17()}, new Object[] {LiveDatabases.hana()});
    }

    private final LiveDatabases.Live live;

    public WindowLiveTest(LiveDatabases.Live live) {
        this.live = live;
    }

    @Test
    public void runningTotalRowNumberAndNtile() {
        boolean hana = live.name.startsWith("hana");
        String q = hana || live.name.startsWith("pg") ? "\"" : "`";
        String text = hana ? "NVARCHAR" : "VARCHAR";
        live.executeIgnoring("DROP TABLE " + q + "t_fork_post" + q);
        live.execute((hana ? "CREATE COLUMN TABLE " : "CREATE TABLE ") + q + "t_fork_post" + q + " (" + q + "id" + q + " " + text + "(32) PRIMARY KEY, "
            + q + "user_id" + q + " " + text + "(32), " + q + "title" + q + " " + text + "(200), " + q + "amount" + q + " DECIMAL(12,2))");
        EasyEntityQuery db = live.client();
        db.insertable(Arrays.asList(post("p1", "u1", "10"), post("p2", "u1", "20"), post("p3", "u1", "30"), post("p4", "u2", "5"))).executeRows();

        List<Draft4<String, BigDecimal, Long, Long>> rows = db.queryable(ForkPost.class)
            .orderBy(p -> p.id().asc())
            .select(p -> Select.DRAFT.of(
                p.id(),
                p.expression().sumOver(p.amount()).partitionBy(p.userId()).orderBy(p.id()).rows(Bound.unboundedPreceding(), Bound.currentRow()),
                p.expression().rowNumberOver().over().orderByDescending(p.amount()),
                p.expression().ntileOver(2).over().orderBy(p.amount())))
            .toList();

        Assert.assertEquals(Arrays.asList("p1", "p2", "p3", "p4"), Arrays.asList(rows.get(0).getValue1(), rows.get(1).getValue1(), rows.get(2).getValue1(), rows.get(3).getValue1()));
        BigDecimal[] totals = {new BigDecimal("10"), new BigDecimal("30"), new BigDecimal("60"), new BigDecimal("5")};
        long[] rowNumbers = {3, 2, 1, 4};
        long[] tiles = {1, 2, 2, 1};
        for (int i = 0; i < 4; i++) {
            Draft4<String, BigDecimal, Long, Long> row = rows.get(i);
            Assert.assertEquals(row.getValue1(), 0, totals[i].compareTo(row.getValue2()));
            Assert.assertEquals(row.getValue1(), rowNumbers[i], (long) row.getValue3());
            Assert.assertEquals(row.getValue1(), tiles[i], (long) row.getValue4());
        }
    }

    private static ForkPost post(String id, String userId, String amount) {
        ForkPost p = new ForkPost();
        p.setId(id);
        p.setUserId(userId);
        p.setTitle(id);
        p.setAmount(new BigDecimal(amount));
        return p;
    }
}
