package com.easy.query.fork.test.live;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.proxy.core.draft.Draft3;
import com.easy.query.core.proxy.sql.GroupKeys;
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
import java.util.stream.Collectors;

/** M3.5：按用户 ROLLUP 出小计与总计，GROUPING 标出总计行（MySQL 8.0.18、PG 17、HANA）。 */
@RunWith(Parameterized.class)
public class GroupingLiveTest {
    @Parameterized.Parameters(name = "{0}")
    public static Collection<Object[]> databases() {
        return Arrays.asList(new Object[] {LiveDatabases.mysql8018()}, new Object[] {LiveDatabases.pg17()}, new Object[] {LiveDatabases.hana()});
    }

    private final LiveDatabases.Live live;

    public GroupingLiveTest(LiveDatabases.Live live) {
        this.live = live;
    }

    @Test
    public void rollupAddsGrandTotal() {
        boolean hana = live.name.startsWith("hana");
        String q = live.name.startsWith("mysql") ? "`" : "\"";
        String text = hana ? "NVARCHAR" : "VARCHAR";
        live.executeIgnoring("DROP TABLE " + q + "t_fork_post" + q);
        live.execute((hana ? "CREATE COLUMN TABLE " : "CREATE TABLE ") + q + "t_fork_post" + q + " (" + q + "id" + q + " " + text + "(32) PRIMARY KEY, "
            + q + "user_id" + q + " " + text + "(32), " + q + "title" + q + " " + text + "(200), " + q + "amount" + q + " DECIMAL(12,2))");
        EasyEntityQuery db = live.client();
        db.insertable(Arrays.asList(post("p1", "u1", "10"), post("p2", "u1", "20"), post("p3", "u2", "5"))).executeRows();

        List<Draft3<String, Number, Integer>> rows = db.queryable(ForkPost.class)
            .groupBy(p -> GroupKeys.of(p.userId()))
            .rollup()
            .select(g -> Select.DRAFT.of(g.key1(), g.groupTable().amount().sum(), g.expression().grouping(g.key1())))
            .toList();

        List<String> lines = rows.stream()
            .map(r -> r.getValue1() + "=" + new BigDecimal(r.getValue2().toString()).stripTrailingZeros().toPlainString() + "/" + r.getValue3())
            .sorted()
            .collect(Collectors.toList());
        Assert.assertEquals(Arrays.asList("null=35/1", "u1=30/0", "u2=5/0"), lines);
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
