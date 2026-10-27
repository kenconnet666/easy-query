package com.easy.query.fork.test.live;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.proxy.sql.Select;
import com.easy.query.fork.test.entity.ForkUser;
import com.easy.query.mysql.MySQL;
import org.junit.Assert;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;

import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.stream.Collectors;

/** MySQL 方言入口在实库上执行：8.4 与 8.0.18（生产 PolarDB 的内核）都要过。 */
@RunWith(Parameterized.class)
public class MySQLDialectEntryLiveTest {
    @Parameterized.Parameters(name = "{0}")
    public static Collection<Object[]> databases() {
        return Arrays.asList(new Object[] {LiveDatabases.mysql84()}, new Object[] {LiveDatabases.mysql8018()});
    }

    private final LiveDatabases.Live live;
    private EasyEntityQuery db;

    public MySQLDialectEntryLiveTest(LiveDatabases.Live live) {
        this.live = live;
    }

    @Before
    public void seed() {
        live.execute(
            "DROP TABLE IF EXISTS t_fork_post",
            "DROP TABLE IF EXISTS t_fork_user",
            "CREATE TABLE t_fork_user (id VARCHAR(32) PRIMARY KEY, name VARCHAR(100), age INT, company_id VARCHAR(32), attrs JSON,"
                + " created_at DATETIME, FULLTEXT KEY ft_fork_user_name (name)) ENGINE=InnoDB",
            "CREATE TABLE t_fork_post (id VARCHAR(32) PRIMARY KEY, user_id VARCHAR(32), title VARCHAR(200), amount DECIMAL(12,2))",
            "INSERT INTO t_fork_user VALUES ('u1','easyquery fork',30,NULL,'{\"tags\":[\"vip\",\"java\"],\"skills\":[\"java\",\"sql\"]}',NOW()),"
                + "('u2','hibernate classic',40,NULL,'{\"tags\":[\"normal\"],\"skills\":[\"go\"]}',NOW()),"
                + "('u3','mybatis plus',20,NULL,'{\"tags\":[\"vip\"],\"skills\":[]}',NOW())",
            "INSERT INTO t_fork_post VALUES ('p1','u1','[\"x\",\"y\"]',1),('p2','u2','[\"z\"]',2)");
        db = live.client();
    }

    private static List<String> ids(List<ForkUser> users) {
        return users.stream().map(ForkUser::getId).sorted().collect(Collectors.toList());
    }

    @Test
    public void jsonContainsWithPath() {
        Assert.assertEquals(Arrays.asList("u1", "u3"),
            ids(db.queryable(ForkUser.class).where(u -> MySQL.json(u.attrs()).contains("\"vip\"", "$.tags")).toList()));
    }

    @Test
    public void memberOfAndOverlaps() {
        Assert.assertEquals(Arrays.asList("u1"),
            ids(db.queryable(ForkUser.class).where(u -> MySQL.json(u.attrs()).hasMember("java", "$.skills")).toList()));
        Assert.assertEquals(Arrays.asList("u2"),
            ids(db.queryable(ForkUser.class).where(u -> MySQL.json(u.attrs()).overlaps("{\"tags\":[\"normal\"]}")).toList()));
    }

    @Test
    public void insideImplicitSubquery() {
        Assert.assertEquals(Arrays.asList("u1"),
            ids(db.queryable(ForkUser.class).where(u -> u.posts().any(p -> MySQL.json(p.title()).hasMember("x"))).toList()));
    }

    @Test
    public void fullTextAgainstAndScore() {
        Assert.assertEquals(Arrays.asList("u1"),
            ids(db.queryable(ForkUser.class).where(u -> MySQL.match(u.name()).against("easyquery")).toList()));
        List<String> ranked = db.queryable(ForkUser.class)
            .orderBy(u -> MySQL.match(u.name()).score("hibernate").desc())
            .select(u -> Select.DRAFT.of(u.id(), MySQL.match(u.name()).score("hibernate")))
            .toList().stream().map(d -> d.getValue1()).collect(Collectors.toList());
        Assert.assertEquals("u2", ranked.get(0));
    }
}
