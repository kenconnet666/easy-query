package com.easy.query.fork.test.live;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.basic.extension.tablemapping.TableNameMapping;
import com.easy.query.fork.test.entity.ForkPost;
import com.easy.query.fork.test.entity.ForkUser;
import org.junit.Assert;
import org.junit.Before;
import org.junit.Test;

import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/** M3.1：热表与归档表在实库上（MySQL 8.0.18）：include 单独拉取的关联查询也读归档表。 */
public class TableNameMappingLiveTest {
    private static final TableNameMapping ARCHIVE = TableNameMapping.builder()
        .map(ForkUser.class, "t_fork_user_archive")
        .map(ForkPost.class, "t_fork_post_archive")
        .build();

    private final LiveDatabases.Live live = LiveDatabases.mysql8018();
    private EasyEntityQuery db;

    @Before
    public void seed() {
        String user = "(id VARCHAR(32) PRIMARY KEY, name VARCHAR(100), age INT, company_id VARCHAR(32), attrs JSON, created_at DATETIME)";
        String post = "(id VARCHAR(32) PRIMARY KEY, user_id VARCHAR(32), title VARCHAR(200), amount DECIMAL(12,2))";
        live.execute(
            "DROP TABLE IF EXISTS t_fork_post", "DROP TABLE IF EXISTS t_fork_user",
            "DROP TABLE IF EXISTS t_fork_post_archive", "DROP TABLE IF EXISTS t_fork_user_archive",
            "CREATE TABLE t_fork_user " + user, "CREATE TABLE t_fork_post " + post,
            "CREATE TABLE t_fork_user_archive " + user, "CREATE TABLE t_fork_post_archive " + post,
            "INSERT INTO t_fork_user VALUES ('hot1','hot',1,NULL,NULL,NOW())",
            "INSERT INTO t_fork_post VALUES ('hp1','hot1','hot post',1)",
            "INSERT INTO t_fork_user_archive VALUES ('old1','old',2,NULL,NULL,NOW())",
            "INSERT INTO t_fork_post_archive VALUES ('op1','old1','old post a',1),('op2','old1','old post b',2)");
        db = live.client();
    }

    @Test
    public void includeAndImplicitSubqueryReadArchiveTables() {
        List<ForkUser> archived = ARCHIVE.call(() -> db.queryable(ForkUser.class)
            .where(u -> u.posts().any(p -> p.title().startsWith("old")))
            .include(u -> u.posts())
            .toList());
        Assert.assertEquals(1, archived.size());
        Assert.assertEquals("old1", archived.get(0).getId());
        Assert.assertEquals(Arrays.asList("op1", "op2"),
            archived.get(0).getPosts().stream().map(ForkPost::getId).sorted().collect(Collectors.toList()));

        List<ForkUser> hot = db.queryable(ForkUser.class).include(u -> u.posts()).toList();
        Assert.assertEquals("hot1", hot.get(0).getId());
        Assert.assertEquals("hp1", hot.get(0).getPosts().get(0).getId());
    }
}
