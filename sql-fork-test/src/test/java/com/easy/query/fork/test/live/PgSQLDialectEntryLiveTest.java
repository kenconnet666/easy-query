package com.easy.query.fork.test.live;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.fork.test.entity.ForkUser;
import com.easy.query.pgsql.PgSQL;
import org.junit.Assert;
import org.junit.Before;
import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

/** PostgreSQL 方言入口在实库（PG 17）上执行。 */
public class PgSQLDialectEntryLiveTest {
    private final LiveDatabases.Live live = LiveDatabases.pg17();
    private EasyEntityQuery db;

    @Before
    public void seed() {
        live.execute(
            "DROP TABLE IF EXISTS t_fork_post",
            "DROP TABLE IF EXISTS t_fork_user",
            "CREATE TABLE t_fork_user (id VARCHAR(32) PRIMARY KEY, name VARCHAR(100), age INT, company_id VARCHAR(32), attrs JSONB, created_at TIMESTAMP)",
            "CREATE TABLE t_fork_post (id VARCHAR(32) PRIMARY KEY, user_id VARCHAR(32), title VARCHAR(200), amount DECIMAL(12,2))",
            "INSERT INTO t_fork_user VALUES ('u1','easyquery',30,NULL,'{\"tags\":[\"vip\",\"java\"],\"skills\":[\"java\"]}',now()),"
                + "('u2','hibernate',40,NULL,'{\"tags\":[\"normal\"],\"skills\":[\"go\"]}',now()),"
                + "('u3','mybatis',20,NULL,'{\"tags\":[\"vip\"]}',now())",
            "INSERT INTO t_fork_post VALUES ('p1','u1','{\"lang\":\"java\"}',1),('p2','u2','{\"lang\":\"go\"}',2)");
        db = live.client();
    }

    private static List<String> ids(List<ForkUser> users) {
        return users.stream().map(ForkUser::getId).sorted().collect(Collectors.toList());
    }

    @Test
    public void containsAndContainedBy() {
        Assert.assertEquals(Arrays.asList("u1", "u3"),
            ids(db.queryable(ForkUser.class).where(u -> PgSQL.jsonb(u.attrs()).contains("{\"tags\":[\"vip\"]}")).toList()));
        Assert.assertEquals(Arrays.asList("u3"),
            ids(db.queryable(ForkUser.class).where(u -> PgSQL.jsonb(u.attrs()).containedBy("{\"tags\":[\"vip\"],\"x\":1}")).toList()));
    }

    @Test
    public void keyExistence() {
        Assert.assertEquals(Arrays.asList("u1", "u2"),
            ids(db.queryable(ForkUser.class).where(u -> PgSQL.jsonb(u.attrs()).hasKey("skills")).toList()));
        Assert.assertEquals(Arrays.asList("u1", "u2", "u3"),
            ids(db.queryable(ForkUser.class).where(u -> PgSQL.jsonb(u.attrs()).hasAnyKey("nope", "tags")).toList()));
        Assert.assertEquals(Collections.emptyList(),
            ids(db.queryable(ForkUser.class).where(u -> PgSQL.jsonb(u.attrs()).hasAllKeys("tags", "nope")).toList()));
    }

    @Test
    public void insideImplicitSubquery() {
        Assert.assertEquals(Arrays.asList("u1"),
            ids(db.queryable(ForkUser.class).where(u -> u.posts().any(p -> PgSQL.jsonb(p.title()).contains("{\"lang\":\"java\"}"))).toList()));
    }
}
