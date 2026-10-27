package com.easy.query.fork.test.dialect;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.fork.test.ForkClients;
import com.easy.query.fork.test.entity.ForkUser;
import com.easy.query.mysql.MySQL;
import com.easy.query.mysql.config.MySQLDatabaseConfiguration;
import org.junit.Assert;
import org.junit.Test;

/** M4.3：MySQL JSON 的路径条件与修改函数。 */
public class MySQLJsonSqlTest {
    private final EasyEntityQuery mysql = ForkClients.sqlOnly(new MySQLDatabaseConfiguration());

    @Test
    public void containsPath() {
        Assert.assertEquals("SELECT `id`,`name`,`age`,`company_id`,`attrs`,`created_at` FROM `t_fork_user` WHERE JSON_CONTAINS_PATH(`attrs`,'one',?,?)",
            mysql.queryable(ForkUser.class).where(u -> MySQL.json(u.attrs()).containsPath("$.a", "$.b")).toSQL());
        Assert.assertEquals("SELECT `id`,`name`,`age`,`company_id`,`attrs`,`created_at` FROM `t_fork_user` WHERE JSON_CONTAINS_PATH(`attrs`,'all',?)",
            mysql.queryable(ForkUser.class).where(u -> MySQL.json(u.attrs()).containsAllPaths("$.a")).toSQL());
    }

    @Test
    public void modificationsChainIntoUpdate() {
        String sql = mysql.updatable(ForkUser.class)
            .setColumns(u -> u.attrs().set(MySQL.json(u.attrs()).edit(e -> e.set("$.level", 3).remove("$.old", "$.tmp"))))
            .where(u -> u.id().eq("u1"))
            .toSQL();
        Assert.assertEquals("UPDATE `t_fork_user` SET `attrs` = JSON_REMOVE(JSON_SET(`attrs`,?,?),?,?) WHERE `id` = ?", sql);
    }
}
