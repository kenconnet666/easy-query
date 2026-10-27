package com.easy.query.fork.test.mapping;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.basic.extension.tablemapping.TableNameMapping;
import com.easy.query.core.proxy.sql.Select;
import com.easy.query.fork.test.ForkClients;
import com.easy.query.fork.test.entity.ForkCompany;
import com.easy.query.fork.test.entity.ForkPost;
import com.easy.query.fork.test.entity.ForkUser;
import com.easy.query.mysql.config.MySQLDatabaseConfiguration;
import org.junit.Assert;
import org.junit.Test;

/** M3.1：作用域内的表名映射，主表、隐式 join、隐式子查询都跟着换表。 */
public class TableNameMappingSqlTest {
    private final EasyEntityQuery mysql = ForkClients.sqlOnly(new MySQLDatabaseConfiguration());

    static final TableNameMapping ARCHIVE = TableNameMapping.builder()
        .map(ForkUser.class, "t_fork_user_archive")
        .map(ForkPost.class, "t_fork_post_archive")
        .map(ForkCompany.class, "t_fork_company_archive")
        .build();

    @Test
    public void mainTableJoinAndSubqueriesFollowTheMapping() {
        String sql = ARCHIVE.call(() -> mysql.queryable(ForkUser.class)
            .where(u -> {
                u.company().name().eq("acme");
                u.posts().any(p -> p.title().eq("x"));
            })
            .select(u -> Select.DRAFT.of(u.id(), u.posts().count()))
            .toSQL());
        Assert.assertEquals("SELECT t.`id` AS `value1`,(SELECT COUNT(*) FROM `t_fork_post_archive` t3 WHERE t3.`user_id` = t.`id`) AS `value2`"
            + " FROM `t_fork_user_archive` t LEFT JOIN `t_fork_company_archive` t1 ON t1.`id` = t.`company_id`"
            + " WHERE t1.`name` = ? AND EXISTS(SELECT 1 FROM `t_fork_post_archive` t2 WHERE t2.`user_id` = t.`id` AND t2.`title` = ? LIMIT 1)", sql);
    }

    @Test
    public void onlyMappedEntitiesChange() {
        TableNameMapping postsOnly = TableNameMapping.builder().map(ForkPost.class, "t_fork_post_archive").build();
        String sql = postsOnly.call(() -> mysql.queryable(ForkUser.class).where(u -> u.posts().any(p -> p.title().eq("x"))).toSQL());
        Assert.assertEquals("SELECT t.`id`,t.`name`,t.`age`,t.`company_id`,t.`attrs`,t.`created_at` FROM `t_fork_user` t"
            + " WHERE EXISTS(SELECT 1 FROM `t_fork_post_archive` t1 WHERE t1.`user_id` = t.`id` AND t1.`title` = ? LIMIT 1)", sql);
    }

    @Test
    public void explicitAsTableWins() {
        String sql = ARCHIVE.call(() -> mysql.queryable(ForkUser.class).asTable("t_fork_user_2025").toSQL());
        Assert.assertEquals("SELECT `id`,`name`,`age`,`company_id`,`attrs`,`created_at` FROM `t_fork_user_2025`", sql);
    }

    @Test
    public void scopesNestAndRestore() {
        TableNameMapping usersElsewhere = TableNameMapping.builder().map(ForkUser.class, "t_fork_user_other").build();
        String nested = ARCHIVE.call(() -> usersElsewhere.call(() -> mysql.queryable(ForkUser.class).where(u -> u.posts().any()).toSQL()));
        Assert.assertEquals("SELECT t.`id`,t.`name`,t.`age`,t.`company_id`,t.`attrs`,t.`created_at` FROM `t_fork_user_other` t"
            + " WHERE EXISTS(SELECT 1 FROM `t_fork_post_archive` t1 WHERE t1.`user_id` = t.`id` LIMIT 1)", nested);
        Assert.assertEquals("SELECT `id`,`name`,`age`,`company_id`,`attrs`,`created_at` FROM `t_fork_user`",
            mysql.queryable(ForkUser.class).toSQL());
        Assert.assertNull(TableNameMapping.currentTableName(ForkUser.class));
    }

    @Test
    public void emptyMappingChangesNothing() {
        Assert.assertEquals("SELECT `id`,`name`,`age`,`company_id`,`attrs`,`created_at` FROM `t_fork_user`",
            TableNameMapping.empty().call(() -> mysql.queryable(ForkUser.class).toSQL()));
    }
}
