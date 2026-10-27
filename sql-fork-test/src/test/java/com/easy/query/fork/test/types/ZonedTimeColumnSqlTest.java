package com.easy.query.fork.test.types;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.proxy.columns.types.SQLInstantTypeColumn;
import com.easy.query.core.proxy.columns.types.SQLOffsetDateTimeTypeColumn;
import com.easy.query.core.proxy.columns.types.SQLZonedDateTimeTypeColumn;
import com.easy.query.core.proxy.sql.GroupKeys;
import com.easy.query.core.proxy.sql.Select;
import com.easy.query.fork.test.ForkClients;
import com.easy.query.fork.test.entity.ForkEvent;
import com.easy.query.fork.test.entity.proxy.ForkEventProxy;
import com.easy.query.mysql.config.MySQLDatabaseConfiguration;
import org.junit.Assert;
import org.junit.Test;

import java.time.Instant;

/** M1.4：Instant / OffsetDateTime / ZonedDateTime 属性生成日期时间列，日期函数与 LocalDateTime 列一样可用。 */
public class ZonedTimeColumnSqlTest {
    private final EasyEntityQuery mysql = ForkClients.sqlOnly(new MySQLDatabaseConfiguration());

    @Test
    public void proxyColumnsAreDateTimeColumns() {
        ForkEventProxy e = ForkEventProxy.createTable();
        Assert.assertTrue(e.createdAt() instanceof SQLInstantTypeColumn);
        Assert.assertTrue(e.dueAt() instanceof SQLOffsetDateTimeTypeColumn);
        Assert.assertTrue(e.seenAt() instanceof SQLZonedDateTimeTypeColumn);
    }

    @Test
    public void compareAndDateArithmetic() {
        Instant since = Instant.parse("2026-10-01T00:00:00Z");
        String sql = mysql.queryable(ForkEvent.class)
            .where(e -> {
                e.createdAt().ge(since);
                e.completedAt().gt(e.dueAt().plusDays(1));
                e.seenAt().format("yyyy-MM-dd").eq("2026-10-27");
            })
            .toSQL();
        Assert.assertEquals("SELECT `id`,`kind`,`created_at`,`completed_at`,`due_at`,`seen_at` FROM `t_fork_event`"
            // 列与函数比较时上游多输出一个空格（AND 后面两个），照现状断言
            + " WHERE `created_at` >= ? AND  `completed_at` > date_add(`due_at`, interval (?) day) AND DATE_FORMAT(`seen_at`,'%Y-%m-%d') = ?", sql);
    }

    /** 单独选出一个 Instant 列：要当成单值，不能当实体去找构造器（flow 的 StatsQueries.ops 在 M1.4 后报过 NoSuchMethodException） */
    @Test
    public void selectSingleZonedColumn() {
        Assert.assertEquals("SELECT t.`created_at` FROM `t_fork_event` t ORDER BY t.`created_at` ASC",
            mysql.queryable(ForkEvent.class).orderBy(e -> e.createdAt().asc()).select(e -> e.createdAt()).toSQL());
        Assert.assertEquals("SELECT t.`due_at` FROM `t_fork_event` t",
            mysql.queryable(ForkEvent.class).select(e -> e.dueAt()).toSQL());
        Assert.assertEquals("SELECT t.`seen_at` FROM `t_fork_event` t",
            mysql.queryable(ForkEvent.class).select(e -> e.seenAt()).toSQL());
    }

    /** flow 的 StatsQueries.nodes 原来要先 asLocalDateTime() 才能用 duration */
    @Test
    public void durationAggregateInGroupSelect() {
        String sql = mysql.queryable(ForkEvent.class)
            .groupBy(e -> GroupKeys.of(e.kind()))
            .select(g -> {
                ForkEventProxy e = g.groupTable();
                return Select.DRAFT.of(g.key1(), e.createdAt().duration(e.completedAt()).toSeconds().avg());
            })
            .toSQL();
        Assert.assertTrue(sql, sql.startsWith("SELECT t.`kind` AS `value1`,AVG("));
        Assert.assertTrue(sql, sql.contains("t.`created_at`") && sql.contains("t.`completed_at`"));
        Assert.assertTrue(sql, sql.endsWith("FROM `t_fork_event` t GROUP BY t.`kind`"));
    }
}
