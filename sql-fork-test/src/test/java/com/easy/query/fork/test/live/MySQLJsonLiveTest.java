package com.easy.query.fork.test.live;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.fork.test.entity.ForkUser;
import com.easy.query.mysql.MySQL;
import org.junit.Assert;
import org.junit.Test;

/** M4.3：MySQL 8.0.18（PolarDB 内核）上 JSON 路径条件与 JSON_SET / JSON_REMOVE / JSON_ARRAY_APPEND 更新。 */
public class MySQLJsonLiveTest {
    private final LiveDatabases.Live live = LiveDatabases.mysql8018();

    @Test
    public void pathPredicatesAndUpdates() {
        live.execute("DROP TABLE IF EXISTS t_fork_user",
            "CREATE TABLE t_fork_user (id VARCHAR(32) PRIMARY KEY, name VARCHAR(100), age INT, company_id VARCHAR(32), attrs JSON, created_at DATETIME)",
            "INSERT INTO t_fork_user (id, attrs) VALUES ('u1', '{\"tags\":[\"a\"],\"level\":1,\"old\":true}'), ('u2', '{\"tags\":[]}')");
        EasyEntityQuery db = live.client();

        Assert.assertEquals(1L, db.queryable(ForkUser.class).where(u -> MySQL.json(u.attrs()).containsPath("$.level", "$.nope")).count());
        Assert.assertEquals(0L, db.queryable(ForkUser.class).where(u -> MySQL.json(u.attrs()).containsAllPaths("$.level", "$.nope")).count());

        long rows = db.updatable(ForkUser.class)
            .setColumns(u -> u.attrs().set(MySQL.json(u.attrs()).edit(e -> e
                .set("$.level", 3)
                .setJson("$.vip", "true")
                .arrayAppend("$.tags", "b")
                .remove("$.old"))))
            .where(u -> u.id().eq("u1"))
            .executeRows();
        Assert.assertEquals(1L, rows);

        Assert.assertEquals(1L, db.queryable(ForkUser.class).where(u -> {
            u.id().eq("u1");
            MySQL.json(u.attrs()).contains("3", "$.level");
            MySQL.json(u.attrs()).contains("true", "$.vip");
            MySQL.json(u.attrs()).hasMember("b", "$.tags");
        }).count());
        Assert.assertEquals(0L, db.queryable(ForkUser.class).where(u -> {
            u.id().eq("u1");
            MySQL.json(u.attrs()).containsPath("$.old");
        }).count());
    }
}
