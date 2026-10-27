package com.easy.query.fork.test.live;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.proxy.sql.GroupKeys;
import com.easy.query.core.proxy.sql.Select;
import com.easy.query.fork.test.entity.ForkCompany;
import com.easy.query.fork.test.entity.ForkPost;
import com.easy.query.fork.test.entity.ForkUser;
import org.junit.Assert;
import org.junit.Before;
import org.junit.Test;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/** M2：HANA 方言在 HANA 2.00.088 实库上执行（-Plive）。 */
public class HanaDialectLiveTest {
    private final LiveDatabases.Live live = LiveDatabases.hana();
    private EasyEntityQuery db;

    @Before
    public void seed() {
        live.executeIgnoring("DROP TABLE \"t_fork_post\"", "DROP TABLE \"t_fork_user\"", "DROP TABLE \"t_fork_company\"");
        live.execute(
            "CREATE COLUMN TABLE \"t_fork_company\" (\"id\" NVARCHAR(32) PRIMARY KEY, \"name\" NVARCHAR(100))",
            "CREATE COLUMN TABLE \"t_fork_user\" (\"id\" NVARCHAR(32) PRIMARY KEY, \"name\" NVARCHAR(100), \"age\" INTEGER,"
                + " \"company_id\" NVARCHAR(32), \"attrs\" NVARCHAR(2000), \"created_at\" TIMESTAMP)",
            "CREATE COLUMN TABLE \"t_fork_post\" (\"id\" NVARCHAR(32) PRIMARY KEY, \"user_id\" NVARCHAR(32), \"title\" NVARCHAR(200), \"amount\" DECIMAL(12,2))",
            "INSERT INTO \"t_fork_company\" VALUES ('c1','acme')",
            "INSERT INTO \"t_fork_company\" VALUES ('c2','other')");
        db = live.client();
        db.insertable(Arrays.asList(
            user("u1", "easy_query", 30, "c1", "{\"tags\":[\"vip\"],\"level\":3}", LocalDateTime.of(2026, 10, 27, 8, 30, 15)),
            user("u2", "hibernate", null, "c2", "{\"tags\":[],\"level\":1}", LocalDateTime.of(2026, 10, 1, 0, 0, 0)),
            user("u3", "100%sure", 20, "c1", null, LocalDateTime.of(2025, 1, 31, 23, 59, 59)))).executeRows();
        db.insertable(Arrays.asList(post("p1", "u1", "first", "10.50"), post("p2", "u1", "second", "2.25"), post("p3", "u2", "third", "1.00"))).executeRows();
    }

    private static ForkUser user(String id, String name, Integer age, String companyId, String attrs, LocalDateTime createdAt) {
        ForkUser u = new ForkUser();
        u.setId(id);
        u.setName(name);
        u.setAge(age);
        u.setCompanyId(companyId);
        u.setAttrs(attrs);
        u.setCreatedAt(createdAt);
        return u;
    }

    private static ForkPost post(String id, String userId, String title, String amount) {
        ForkPost p = new ForkPost();
        p.setId(id);
        p.setUserId(userId);
        p.setTitle(title);
        p.setAmount(new BigDecimal(amount));
        return p;
    }

    private static List<String> ids(List<ForkUser> users) {
        return users.stream().map(ForkUser::getId).collect(Collectors.toList());
    }

    @Test
    public void pagingImplicitJoinAndSubquery() {
        Assert.assertEquals(Arrays.asList("u2"), ids(db.queryable(ForkUser.class).orderBy(u -> u.id().asc()).limit(1, 1).toList()));
        Assert.assertEquals(Arrays.asList("u1", "u3"), ids(db.queryable(ForkUser.class)
            .where(u -> u.company().name().eq("acme")).orderBy(u -> u.id().asc()).toList()));
        Assert.assertEquals(Arrays.asList("u1"), ids(db.queryable(ForkUser.class)
            .where(u -> u.posts().any(p -> p.amount().gt(new BigDecimal("5")))).toList()));
        Assert.assertEquals(3L, db.queryable(ForkUser.class).count());
    }

    @Test
    public void likeEscapesWildcards() {
        Assert.assertEquals(Arrays.asList("u3"), ids(db.queryable(ForkUser.class).where(u -> u.name().like("0%s")).toList()));
        Assert.assertEquals(Arrays.asList("u1"), ids(db.queryable(ForkUser.class).where(u -> u.name().startsWith("easy_")).toList()));
        Assert.assertEquals(Arrays.asList("u2"), ids(db.queryable(ForkUser.class).where(u -> u.name().endsWith("nate")).toList()));
    }

    @Test
    public void stringAndNullFunctions() {
        List<String> values = db.queryable(ForkUser.class).where(u -> u.id().eq("u1"))
            .select(u -> Select.DRAFT.of(u.name().concat("-").concat(u.id()), u.name().subString(0, 4), u.name().indexOf("q"),
                u.name().length(), u.age().nullOrDefault(0), u.name().toUpper()))
            .toList().stream().map(d -> d.getValue1() + "|" + d.getValue2() + "|" + d.getValue3() + "|" + d.getValue4() + "|" + d.getValue5() + "|" + d.getValue6())
            .collect(Collectors.toList());
        Assert.assertEquals(Arrays.asList("easy_query-u1|easy|5|10|30|EASY_QUERY"), values);
        Integer age = db.queryable(ForkUser.class).where(u -> u.id().eq("u2")).select(u -> Select.DRAFT.of(u.age().nullOrDefault(-1))).firstOrNull().getValue1();
        Assert.assertEquals(Integer.valueOf(-1), age);
    }

    @Test
    public void dateFunctions() {
        List<String> values = db.queryable(ForkUser.class).where(u -> u.id().eq("u1"))
            .select(u -> Select.DRAFT.of(u.createdAt().format("yyyy-MM-dd HH:mm:ss"), u.createdAt().format("yyyy年MM月dd日"),
                u.createdAt().plusDays(2).format("yyyy-MM-dd"), u.createdAt().plusMonths(1).format("yyyyMM"),
                u.createdAt().year(), u.createdAt().dayOfWeek()))
            .toList().stream().map(d -> d.getValue1() + "|" + d.getValue2() + "|" + d.getValue3() + "|" + d.getValue4() + "|" + d.getValue5() + "|" + d.getValue6())
            .collect(Collectors.toList());
        // 2026-10-27 是周二：DayOfWeek 约定周日 0，所以是 2
        Assert.assertEquals(Arrays.asList("2026-10-27 08:30:15|2026年10月27日|2026-10-29|202611|2026|2"), values);
        Number days = db.queryable(ForkUser.class).where(u -> u.id().eq("u1"))
            .select(u -> Select.DRAFT.of(u.createdAt().plusDays(3).duration(u.createdAt()).toDays())).firstOrNull().getValue1();
        // a.duration(b) 是 b - a（上游约定：a 比 b 少多少）
        Assert.assertEquals(-3L, days.longValue());
    }

    @Test
    public void aggregatesAndBooleanProjection() {
        List<String> joined = db.queryable(ForkPost.class)
            .groupBy(p -> GroupKeys.of(p.userId()))
            .orderBy(g -> g.key1().asc())
            .select(g -> Select.DRAFT.of(g.key1(), g.groupTable().title().joining(","), g.groupTable().amount().sumBigDecimal()))
            .toList().stream().map(d -> d.getValue1() + "=" + d.getValue3().stripTrailingZeros().toPlainString()).collect(Collectors.toList());
        Assert.assertEquals(Arrays.asList("u1=12.75", "u2=1"), joined);
        List<Boolean> hasPosts = db.queryable(ForkUser.class).orderBy(u -> u.id().asc()).select(u -> Select.DRAFT.of(u.posts().anyValue()))
            .toList().stream().map(d -> d.getValue1()).collect(Collectors.toList());
        Assert.assertEquals(Arrays.asList(true, true, false), hasPosts);
    }

    @Test
    public void mergeUpsert() {
        ForkUser changed = user("u1", "renamed", 31, "c1", null, LocalDateTime.of(2026, 10, 27, 8, 30, 15));
        ForkUser created = user("u9", "new", 9, null, null, LocalDateTime.of(2026, 1, 1, 0, 0, 0));
        db.insertable(changed).onConflictThen(o -> o.FETCHER.name().age()).executeRows();
        db.insertable(created).onConflictThen(o -> o.FETCHER.name().age()).executeRows();
        db.insertable(user("u2", "ignored", 99, "c2", null, LocalDateTime.of(2026, 1, 1, 0, 0, 0))).onConflictThen(null).executeRows();
        ForkUser u1 = db.queryable(ForkUser.class).whereById("u1").singleNotNull();
        Assert.assertEquals("renamed", u1.getName());
        Assert.assertEquals(Integer.valueOf(31), u1.getAge());
        Assert.assertEquals("new", db.queryable(ForkUser.class).whereById("u9").singleNotNull().getName());
        Assert.assertEquals("hibernate", db.queryable(ForkUser.class).whereById("u2").singleNotNull().getName());
    }

    @Test
    public void joinedUpdateAndDelete() {
        long updated = db.updatable(ForkUser.class).setColumns(u -> u.age().set(50)).where(u -> u.company().name().eq("acme")).executeRows();
        Assert.assertEquals(2L, updated);
        Assert.assertEquals(Arrays.asList(50, 50), db.queryable(ForkUser.class).where(u -> u.companyId().eq("c1")).select(u -> u.age()).toList());
        long deleted = db.deletable(ForkUser.class).allowDeleteStatement(true).where(u -> u.company().name().eq("other")).executeRows();
        Assert.assertEquals(1L, deleted);
        Assert.assertEquals(Arrays.asList("u1", "u3"), ids(db.queryable(ForkUser.class).orderBy(u -> u.id().asc()).toList()));
    }

    @Test
    public void plainCrudAndForUpdate() {
        ForkCompany company = new ForkCompany();
        company.setId("c3");
        company.setName("third");
        Assert.assertEquals(1L, db.insertable(company).executeRows());
        company.setName("third!");
        Assert.assertEquals(1L, db.updatable(company).executeRows());
        Assert.assertEquals("third!", db.queryable(ForkCompany.class).whereById("c3").singleNotNull().getName());
        try (com.easy.query.core.basic.jdbc.tx.Transaction tx = db.beginTransaction()) {
            Assert.assertEquals("third!", db.queryable(ForkCompany.class).whereById("c3").forUpdate().singleNotNull().getName());
            tx.commit();
        }
        Assert.assertEquals(1L, db.deletable(company).allowDeleteStatement(true).executeRows());
        Assert.assertEquals(0L, db.queryable(ForkCompany.class).where(c -> c.id().eq("c3")).count());
    }
}
