package com.easy.query.fork.test;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.fork.test.entity.ForkUser;
import com.easy.query.mysql.config.MySQLDatabaseConfiguration;
import org.junit.Assert;
import org.junit.Test;

/** 测试源码上的 APT 代理能生成、隐式 join 与隐式子查询照常工作：fork 测试模块本身的冒烟。 */
public class ProxySmokeTest {
    private final EasyEntityQuery mysql = ForkClients.sqlOnly(new MySQLDatabaseConfiguration());

    @Test
    public void implicitJoinAndSubqueryRenderOnTestEntities() {
        String sql = mysql.queryable(ForkUser.class)
            .where(u -> {
                u.company().name().eq("acme");
                u.posts().any(p -> p.title().like("orm"));
            })
            .toSQL();
        Assert.assertEquals("SELECT t.`id`,t.`name`,t.`age`,t.`company_id`,t.`attrs`,t.`created_at` FROM `t_fork_user` t "
            + "LEFT JOIN `t_fork_company` t1 ON t1.`id` = t.`company_id` WHERE t1.`name` = ? "
            + "AND EXISTS(SELECT 1 FROM `t_fork_post` t2 WHERE t2.`user_id` = t.`id` AND t2.`title` LIKE ? LIMIT 1)", sql);
    }
}
