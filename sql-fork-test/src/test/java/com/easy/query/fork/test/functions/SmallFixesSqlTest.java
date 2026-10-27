package com.easy.query.fork.test.functions;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.proxy.sql.Select;
import com.easy.query.fork.test.ForkClients;
import com.easy.query.fork.test.entity.ForkPost;
import com.easy.query.fork.test.entity.ForkUser;
import com.easy.query.mysql.config.MySQLDatabaseConfiguration;
import com.easy.query.pgsql.config.PgSQLDatabaseConfiguration;
import org.junit.Assert;
import org.junit.Test;

/** M1.5 窗口函数 PARTITION BY 后的空格、M1.6 JSON 数组的元素个数。 */
public class SmallFixesSqlTest {
    private final EasyEntityQuery mysql = ForkClients.sqlOnly(new MySQLDatabaseConfiguration());
    private final EasyEntityQuery pg = ForkClients.sqlOnly(new PgSQLDatabaseConfiguration());

    @Test
    public void offsetWindowHasSpaceBeforeOrderBy() {
        String sql = mysql.queryable(ForkPost.class)
            .select(p -> Select.DRAFT.of(p.id(), p.amount().offset(o -> o.partitionBy(p.userId()).orderBy(p.id())).prev(1)))
            .toSQL();
        Assert.assertTrue(sql, sql.contains("OVER (PARTITION BY t.`user_id` ORDER BY t.`id` ASC)"));
    }

    @Test
    public void jsonArraySize() {
        Assert.assertEquals("SELECT `id`,`name`,`age`,`company_id`,`attrs`,`created_at` FROM `t_fork_user` WHERE JSON_LENGTH(`attrs`) > ?",
            mysql.queryable(ForkUser.class).where(u -> u.attrs().asJSONArray().size().gt(1)).toSQL());
        Assert.assertEquals("SELECT \"id\",\"name\",\"age\",\"company_id\",\"attrs\",\"created_at\" FROM \"t_fork_user\" WHERE JSONB_ARRAY_LENGTH(\"attrs\") > ?",
            pg.queryable(ForkUser.class).where(u -> u.attrs().asJSONArray().size().gt(1)).toSQL());
    }
}
