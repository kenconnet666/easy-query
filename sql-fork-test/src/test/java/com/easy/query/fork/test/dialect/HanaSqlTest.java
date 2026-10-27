package com.easy.query.fork.test.dialect;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.proxy.sql.Select;
import com.easy.query.fork.test.ForkClients;
import com.easy.query.fork.test.entity.ForkUser;
import com.easy.query.hana.config.HanaDatabaseConfiguration;
import org.junit.Assert;
import org.junit.Test;

/** M2：HANA 方言生成的 SQL（CI 里没有 HANA，这里固定文本；同样的语句在 live.HanaDialectLiveTest 里实际执行过）。 */
public class HanaSqlTest {
    private final EasyEntityQuery hana = ForkClients.sqlOnly(new HanaDatabaseConfiguration());

    private static final String USER = "t.\"id\",t.\"name\",t.\"age\",t.\"company_id\",t.\"attrs\",t.\"created_at\"";

    @Test
    public void pagingUsesLimitOffset() {
        Assert.assertEquals("SELECT \"id\",\"name\",\"age\",\"company_id\",\"attrs\",\"created_at\" FROM \"t_fork_user\" WHERE \"name\" LIKE ?"
                + " ORDER BY \"id\" ASC LIMIT 20 OFFSET 10",
            hana.queryable(ForkUser.class).where(u -> u.name().like("a")).orderBy(u -> u.id().asc()).limit(10, 20).toSQL());
        Assert.assertEquals("SELECT t.\"id\" AS \"value1\" FROM \"t_fork_user\" t WHERE t.\"id\" = ? LIMIT 1",
            hana.queryable(ForkUser.class).where(u -> u.id().eq("u1")).select(u -> Select.DRAFT.of(u.id())).limit(1).toSQL());
    }

    /** HANA 不允许关联子查询带 LIMIT：EXISTS 里的 LIMIT 1 去掉 */
    @Test
    public void existsSubqueryHasNoLimit() {
        Assert.assertEquals("SELECT " + USER + " FROM \"t_fork_user\" t LEFT JOIN \"t_fork_company\" t1 ON t1.\"id\" = t.\"company_id\""
                + " WHERE t1.\"name\" = ? AND EXISTS(SELECT 1 FROM \"t_fork_post\" t2 WHERE t2.\"user_id\" = t.\"id\" AND t2.\"title\" = ?)",
            hana.queryable(ForkUser.class).where(u -> {
                u.company().name().eq("acme");
                u.posts().any(p -> p.title().eq("x"));
            }).toSQL());
    }

    @Test
    public void functions() {
        Assert.assertEquals("SELECT ((t.\"name\" || ?) || t.\"id\") AS \"value1\",SUBSTRING(t.\"name\",1,4) AS \"value2\","
                + "(LOCATE(t.\"name\",?) - 1) AS \"value3\",COALESCE(t.\"age\",?) AS \"value4\","
                + "(TO_NVARCHAR(t.\"created_at\",'YYYY') || '年' || TO_NVARCHAR(t.\"created_at\",'MM') || '月' || TO_NVARCHAR(t.\"created_at\",'DD')"
                + " || '日 ' || TO_NVARCHAR(t.\"created_at\",'HH24:MI')) AS \"value5\",ADD_DAYS(t.\"created_at\",?) AS \"value6\","
                + "(CASE WHEN (EXISTS(SELECT 1 FROM \"t_fork_post\" t1 WHERE t1.\"user_id\" = t.\"id\")) THEN TRUE"
                + " WHEN NOT ((EXISTS(SELECT 1 FROM \"t_fork_post\" t1 WHERE t1.\"user_id\" = t.\"id\"))) THEN FALSE ELSE NULL END) AS \"value7\""
                + " FROM \"t_fork_user\" t",
            hana.queryable(ForkUser.class).select(u -> Select.DRAFT.of(u.name().concat("-").concat(u.id()), u.name().subString(0, 4),
                u.name().indexOf("q"), u.age().nullOrDefault(0), u.createdAt().format("yyyy年MM月dd日 HH:mm"), u.createdAt().plusDays(2),
                u.posts().anyValue())).toSQL());
    }

    @Test
    public void upsertIsMerge() {
        ForkUser user = new ForkUser();
        user.setId("u1");
        user.setName("n");
        Assert.assertEquals("MERGE INTO \"t_fork_user\" t1 USING (SELECT ? AS \"id\",? AS \"name\" FROM DUMMY) t2 ON (t1.\"id\" = t2.\"id\")"
                + " WHEN MATCHED THEN UPDATE SET t1.\"name\" = t2.\"name\" WHEN NOT MATCHED THEN INSERT (\"id\",\"name\") VALUES (t2.\"id\",t2.\"name\")",
            hana.insertable(user).onConflictThen(o -> o.FETCHER.name()).toSQL(user));
    }

    @Test
    public void joinedUpdateIsMergeAndJoinedDeleteIsExists() {
        Assert.assertEquals("MERGE INTO \"t_fork_user\" t USING (SELECT t.\"id\" AS \"eq_key_0\",? AS \"eq_value_0\" FROM \"t_fork_user\" t"
                + " INNER JOIN \"t_fork_company\" t1 ON t1.\"id\" = t.\"company_id\" WHERE t1.\"name\" = ?) eq_src ON (t.\"id\" = eq_src.\"eq_key_0\")"
                + " WHEN MATCHED THEN UPDATE SET t.\"age\" = eq_src.\"eq_value_0\"",
            hana.updatable(ForkUser.class).setColumns(u -> u.age().set(50)).where(u -> u.company().name().eq("acme")).toSQL());
        Assert.assertEquals("DELETE FROM \"t_fork_user\" t WHERE EXISTS (SELECT 1 FROM DUMMY eq_seed INNER JOIN \"t_fork_company\" t1"
                + " ON t1.\"id\" = t.\"company_id\" WHERE eq_seed.\"DUMMY\" IS NOT NULL AND (t1.\"name\" = ?))",
            hana.deletable(ForkUser.class).allowDeleteStatement(true).where(u -> u.company().name().eq("other")).toSQL());
    }

    @Test
    public void dateFormatTranslation() {
        Assert.assertEquals("TO_NVARCHAR(t.\"created_at\",'YYYY-MM-DD HH24:MI:SS')", formatted("yyyy-MM-dd HH:mm:ss"));
        Assert.assertEquals("(TO_NVARCHAR(t.\"created_at\",'YYYY-MM-DD') || 'T' || TO_NVARCHAR(t.\"created_at\",'HH24:MI:SS.FF3'))",
            formatted("yyyy-MM-dd'T'HH:mm:ss.SSS"));
        Assert.assertEquals("(TO_NVARCHAR(MONTH(t.\"created_at\")) || '/' || TO_NVARCHAR(DAYOFMONTH(t.\"created_at\")))", formatted("M/d"));
    }

    /** select 里 format 生成的表达式 */
    private String formatted(String pattern) {
        String sql = hana.queryable(ForkUser.class).select(u -> Select.DRAFT.of(u.createdAt().format(pattern))).toSQL();
        return sql.substring("SELECT ".length(), sql.indexOf(" AS \"value1\""));
    }
}
