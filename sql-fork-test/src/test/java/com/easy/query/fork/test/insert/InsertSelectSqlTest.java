package com.easy.query.fork.test.insert;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.basic.api.insert.select.InsertSelect;
import com.easy.query.fork.test.ForkClients;
import com.easy.query.fork.test.entity.ForkPost;
import com.easy.query.hana.config.HanaDatabaseConfiguration;
import com.easy.query.mysql.config.MySQLDatabaseConfiguration;
import com.easy.query.pgsql.config.PgSQLDatabaseConfiguration;
import org.junit.Assert;
import org.junit.Test;

import java.time.LocalDateTime;
import java.util.Arrays;

/** M3.2：INSERT … SELECT 的 SQL。 */
public class InsertSelectSqlTest {
    @Test
    public void mysqlCopiesEntityColumnsPlusExtraColumn() {
        EasyEntityQuery mysql = ForkClients.sqlOnly(new MySQLDatabaseConfiguration());
        String sql = InsertSelect.from(mysql.queryable(ForkPost.class).where(p -> p.userId().in(Arrays.asList("u1", "u2"))))
            .into("t_fork_post_archive")
            .column("archived_at", LocalDateTime.of(2026, 10, 28, 0, 0))
            .toSQL();
        Assert.assertEquals("INSERT INTO `t_fork_post_archive` (`id`,`user_id`,`title`,`amount`,`archived_at`)"
            + " SELECT eq_src.`id`,eq_src.`user_id`,eq_src.`title`,eq_src.`amount`,?"
            + " FROM (SELECT `id`,`user_id`,`title`,`amount` FROM `t_fork_post` WHERE `user_id` IN (?,?)) eq_src", sql);
    }

    @Test
    public void defaultTargetIsTheEntityTable() {
        EasyEntityQuery pg = ForkClients.sqlOnly(new PgSQLDatabaseConfiguration());
        Assert.assertEquals("INSERT INTO \"t_fork_post\" (\"id\",\"user_id\",\"title\",\"amount\") SELECT eq_src.\"id\",eq_src.\"user_id\",eq_src.\"title\",eq_src.\"amount\""
                + " FROM (SELECT \"id\",\"user_id\",\"title\",\"amount\" FROM \"t_fork_post\" WHERE \"title\" = ?) eq_src",
            InsertSelect.from(pg.queryable(ForkPost.class).where(p -> p.title().eq("x"))).toSQL());
    }

    @Test
    public void hanaUsesQuotedNames() {
        EasyEntityQuery hana = ForkClients.sqlOnly(new HanaDatabaseConfiguration());
        Assert.assertEquals("INSERT INTO \"t_fork_post_archive\" (\"id\",\"user_id\",\"title\",\"amount\") SELECT eq_src.\"id\",eq_src.\"user_id\",eq_src.\"title\",eq_src.\"amount\""
                + " FROM (SELECT \"id\",\"user_id\",\"title\",\"amount\" FROM \"t_fork_post\") eq_src",
            InsertSelect.from(hana.queryable(ForkPost.class)).into("t_fork_post_archive").toSQL());
    }
}
