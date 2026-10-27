package com.easy.query.fork.test.functions;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.proxy.sql.Select;
import com.easy.query.fork.test.ForkClients;
import com.easy.query.fork.test.entity.ForkPost;
import com.easy.query.fork.test.entity.ForkUser;
import com.easy.query.hana.config.HanaDatabaseConfiguration;
import com.easy.query.mysql.config.MySQLDatabaseConfiguration;
import com.easy.query.pgsql.config.PgSQLDatabaseConfiguration;
import org.junit.Assert;
import org.junit.Test;

/** M3.6：NULLIF 与 null 安全的相等（MySQL <=>、PG IS NOT DISTINCT FROM、其它库 OR 写法）。 */
public class NullSafeSqlTest {
    private final EasyEntityQuery mysql = ForkClients.sqlOnly(new MySQLDatabaseConfiguration());
    private final EasyEntityQuery pg = ForkClients.sqlOnly(new PgSQLDatabaseConfiguration());
    private final EasyEntityQuery hana = ForkClients.sqlOnly(new HanaDatabaseConfiguration());

    @Test
    public void nullSafeEqualsPerDialect() {
        Assert.assertEquals("SELECT t.`id` FROM `t_fork_user` t WHERE (t.`name` <=> ?)",
            mysql.queryable(ForkUser.class).where(u -> u.name().eqNullSafe("a")).select(u -> u.id()).toSQL());
        Assert.assertEquals("SELECT t.\"id\" FROM \"t_fork_user\" t WHERE (t.\"name\" IS NOT DISTINCT FROM ?)",
            pg.queryable(ForkUser.class).where(u -> u.name().eqNullSafe("a")).select(u -> u.id()).toSQL());
        Assert.assertEquals("SELECT t.\"id\" FROM \"t_fork_user\" t WHERE ((t.\"name\" = ?) OR (t.\"name\" IS NULL AND ? IS NULL))",
            hana.queryable(ForkUser.class).where(u -> u.name().eqNullSafe("a")).select(u -> u.id()).toSQL());
    }

    @Test
    public void nullSafeEqualsBetweenColumns() {
        Assert.assertEquals("SELECT t.`id` FROM `t_fork_post` t INNER JOIN `t_fork_user` t1 ON (t1.`id` <=> t.`user_id`)",
            mysql.queryable(ForkPost.class).innerJoin(ForkUser.class, (p, u) -> u.id().eqNullSafe(p.userId())).select((p, u) -> p.id()).toSQL());
    }

    @Test
    public void nullIf() {
        Assert.assertEquals("SELECT NULLIF(t.`name`, ?) AS `value1` FROM `t_fork_user` t",
            mysql.queryable(ForkUser.class).select(u -> Select.DRAFT.of(u.name().nullIf(""))).toSQL());
        Assert.assertEquals("SELECT t.\"id\" FROM \"t_fork_user\" t WHERE COALESCE(NULLIF(t.\"name\", ?),?) = ?",
            pg.queryable(ForkUser.class).where(u -> u.name().nullIf("").nullOrDefault("-").eq("-")).select(u -> u.id()).toSQL());
    }
}
