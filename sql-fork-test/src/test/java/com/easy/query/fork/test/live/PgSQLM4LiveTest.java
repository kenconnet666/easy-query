package com.easy.query.fork.test.live;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.proxy.core.draft.Draft2;
import com.easy.query.core.proxy.sql.Select;
import com.easy.query.fork.test.entity.ForkPost;
import com.easy.query.fork.test.entity.ForkUser;
import com.easy.query.pgsql.PgSQL;
import org.junit.Assert;
import org.junit.Test;

import java.util.List;

/** M4.2：PG 17 上 jsonb 局部修改、数组条件、全文检索。 */
public class PgSQLM4LiveTest {
    private final LiveDatabases.Live live = LiveDatabases.pg17();

    @Test
    public void jsonbEditRoundTrip() {
        live.executeIgnoring("DROP TABLE \"t_fork_user\"");
        live.execute("CREATE TABLE \"t_fork_user\" (\"id\" VARCHAR(32) PRIMARY KEY, \"name\" VARCHAR(100), \"age\" INT, \"company_id\" VARCHAR(32), \"attrs\" JSONB, \"created_at\" TIMESTAMP)",
            "INSERT INTO \"t_fork_user\" (\"id\", \"attrs\") VALUES ('u1', '{\"level\":1,\"old\":true,\"tags\":[\"a\"]}')");
        EasyEntityQuery db = live.client();

        long rows = db.updatable(ForkUser.class)
            .setColumns(u -> u.attrs().set(PgSQL.jsonb(u.attrs()).edit(e -> e
                .set("level", "3")
                .set("tags.1", "\"b\"")
                .remove("old")
                .merge("{\"vip\":true}"))))
            .where(u -> u.id().eq("u1"))
            .executeRows();
        Assert.assertEquals(1L, rows);
        Assert.assertEquals(1L, db.queryable(ForkUser.class).where(u -> {
            PgSQL.jsonb(u.attrs()).contains("{\"level\":3,\"vip\":true,\"tags\":[\"a\",\"b\"]}");
        }).count());
        Assert.assertEquals(0L, db.queryable(ForkUser.class).where(u -> PgSQL.jsonb(u.attrs()).hasKey("old")).count());
    }

    @Test
    public void arrayPredicatesAndFullText() {
        live.executeIgnoring("DROP TABLE \"t_fork_post\"");
        live.execute("CREATE TABLE \"t_fork_post\" (\"id\" VARCHAR(32) PRIMARY KEY, \"user_id\" TEXT[], \"title\" TEXT, \"amount\" DECIMAL(12,2))",
            "INSERT INTO \"t_fork_post\" VALUES ('p1', '{a,b}', 'easy query makes orm simple', 1),"
                + " ('p2', '{b}', 'plain jdbc is verbose', 2), ('p3', '{}', 'easy query and jdbc together', 3)");
        EasyEntityQuery db = live.client();

        Assert.assertEquals(2L, db.queryable(ForkPost.class).where(p -> PgSQL.array(p.userId()).has("b")).count());
        Assert.assertEquals(1L, db.queryable(ForkPost.class).where(p -> PgSQL.array(p.userId()).hasAll("a", "b")).count());
        Assert.assertEquals(2L, db.queryable(ForkPost.class).where(p -> PgSQL.array(p.userId()).hasAny("a", "z", "b")).count());
        Assert.assertEquals(1L, db.queryable(ForkPost.class).where(p -> PgSQL.array(p.userId()).length().eq(0)).count());

        Assert.assertEquals(1L, db.queryable(ForkPost.class).where(p -> PgSQL.fulltext(p.title()).matches("easy query -jdbc")).count());
        List<Draft2<String, Double>> ranked = db.queryable(ForkPost.class)
            .where(p -> PgSQL.fulltext(p.title()).matches("easy or jdbc"))
            .orderBy(p -> p.id().asc())
            .select(p -> Select.DRAFT.of(p.id(), PgSQL.fulltext(p.title()).rank("jdbc")))
            .toList();
        Assert.assertEquals(3, ranked.size());
        Assert.assertTrue(ranked.get(1).getValue2() > ranked.get(0).getValue2());
    }
}
