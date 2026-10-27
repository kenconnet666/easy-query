package com.easy.query.fork.test.dialect;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.fork.test.ForkClients;
import com.easy.query.fork.test.entity.ForkPost;
import com.easy.query.fork.test.entity.ForkUser;
import com.easy.query.pgsql.PgSQL;
import com.easy.query.pgsql.config.PgSQLDatabaseConfiguration;
import org.junit.Assert;
import org.junit.Test;

/** M4.2：PG 的 jsonb 修改、数组条件、全文检索的写法。 */
public class PgSQLM4SqlTest {
    private final EasyEntityQuery pg = ForkClients.sqlOnly(new PgSQLDatabaseConfiguration());

    @Test
    public void jsonbEdit() {
        Assert.assertEquals("UPDATE \"t_fork_user\" SET \"attrs\" = (jsonb_set((\"attrs\")::jsonb,(?)::text[],(?)::jsonb,true) #- (?)::text[]) WHERE \"id\" = ?",
            pg.updatable(ForkUser.class)
                .setColumns(u -> u.attrs().set(PgSQL.jsonb(u.attrs()).edit(e -> e.set("a.b", "1").remove("old"))))
                .where(u -> u.id().eq("u1")).toSQL());
    }

    @Test
    public void arrayAndFullText() {
        Assert.assertTrue(pg.queryable(ForkPost.class).where(p -> PgSQL.array(p.userId()).hasAll("a", "b")).toSQL()
            .endsWith("WHERE (? = ANY(\"user_id\") AND ? = ANY(\"user_id\"))"));
        Assert.assertTrue(pg.queryable(ForkPost.class).where(p -> PgSQL.fulltext(p.title()).matches("english", "orm")).toSQL()
            .endsWith("WHERE to_tsvector('english',\"title\") @@ websearch_to_tsquery('english',?)"));
        try {
            pg.queryable(ForkPost.class).where(p -> PgSQL.fulltext(p.title()).matches("x'; drop", "orm")).toSQL();
            Assert.fail("config must be an identifier");
        } catch (IllegalArgumentException expected) {
            // 配置名直接写进 SQL，只接受标识符
        }
    }
}
