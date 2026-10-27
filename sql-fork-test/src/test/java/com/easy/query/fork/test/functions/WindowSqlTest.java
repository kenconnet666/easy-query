package com.easy.query.fork.test.functions;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.func.def.WindowFrame.Bound;
import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.sql.Select;
import com.easy.query.fork.test.ForkClients;
import com.easy.query.fork.test.entity.ForkPost;
import com.easy.query.fork.test.entity.proxy.ForkPostProxy;
import com.easy.query.mysql.config.MySQLDatabaseConfiguration;
import org.junit.Assert;
import org.junit.Test;

import java.util.function.Function;

/** M3.4：全局窗口、ROWS / RANGE frame、NTILE / PERCENT_RANK / CUME_DIST。 */
public class WindowSqlTest {
    private final EasyEntityQuery mysql = ForkClients.sqlOnly(new MySQLDatabaseConfiguration());

    /** 只取窗口那一列的 SQL */
    private String column(Function<ForkPostProxy, PropTypeColumn<?>> window) {
        String sql = mysql.queryable(ForkPost.class).select(p -> Select.DRAFT.of(p.id(), window.apply(p))).toSQL();
        return sql.substring("SELECT t.`id` AS `value1`,".length(), sql.indexOf(" AS `value2`"));
    }

    @Test
    public void partitionedWindowIsUnchanged() {
        Assert.assertEquals("(SUM(t.`amount`) OVER (PARTITION BY t.`user_id` ORDER BY t.`id` ASC))",
            column(p -> p.expression().sumOver(p.amount()).partitionBy(p.userId()).orderBy(p.id())));
        Assert.assertEquals("(ROW_NUMBER() OVER (PARTITION BY t.`user_id`, t.`title` ORDER BY t.`id` DESC))",
            column(p -> p.expression().rowNumberOver().partitionBy(p.userId(), p.title()).orderByDescending(p.id())));
    }

    @Test
    public void globalWindowWithoutPartition() {
        Assert.assertEquals("(ROW_NUMBER() OVER (ORDER BY t.`amount` DESC))",
            column(p -> p.expression().rowNumberOver().over().orderByDescending(p.amount())));
        Assert.assertEquals("(SUM(t.`amount`) OVER ())", column(p -> p.expression().sumOver(p.amount()).over()));
        Assert.assertEquals("(COUNT(t.`id`) OVER ())", column(p -> p.expression().countOver(p.id()).over()));
    }

    @Test
    public void framesFollowOrderBy() {
        Assert.assertEquals("(SUM(t.`amount`) OVER (PARTITION BY t.`user_id` ORDER BY t.`id` ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))",
            column(p -> p.expression().sumOver(p.amount()).partitionBy(p.userId()).orderBy(p.id()).rows(Bound.unboundedPreceding(), Bound.currentRow())));
        Assert.assertEquals("(AVG(t.`amount`) OVER (ORDER BY t.`id` ASC ROWS BETWEEN 2 PRECEDING AND 1 FOLLOWING))",
            column(p -> p.expression().avgOver(p.amount()).over().orderBy(p.id()).rows(Bound.preceding(2), Bound.following(1))));
        Assert.assertEquals("(MAX(t.`amount`) OVER (ORDER BY t.`amount` ASC RANGE BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING))",
            column(p -> p.expression().maxOver(p.amount()).over().orderBy(p.amount()).range(Bound.currentRow(), Bound.unboundedFollowing())));
    }

    @Test
    public void distributionFunctions() {
        Assert.assertEquals("(NTILE(4) OVER (ORDER BY t.`amount` ASC))", column(p -> p.expression().ntileOver(4).over().orderBy(p.amount())));
        Assert.assertEquals("(PERCENT_RANK() OVER (PARTITION BY t.`user_id` ORDER BY t.`amount` ASC))",
            column(p -> p.expression().percentRankOver().partitionBy(p.userId()).orderBy(p.amount())));
        Assert.assertEquals("(CUME_DIST() OVER (ORDER BY t.`amount` ASC))", column(p -> p.expression().cumeDistOver().over().orderBy(p.amount())));
    }

    @Test
    public void invalidArgumentsAreRejected() {
        assertThrows(() -> Bound.preceding(-1));
        assertThrows(() -> column(p -> p.expression().ntileOver(0).over()));
        assertThrows(() -> column(p -> p.expression().sumOver(p.amount()).partitionBy()));
    }

    private static void assertThrows(Runnable action) {
        try {
            action.run();
        } catch (RuntimeException expected) {
            return;
        }
        Assert.fail("expected an exception");
    }
}
