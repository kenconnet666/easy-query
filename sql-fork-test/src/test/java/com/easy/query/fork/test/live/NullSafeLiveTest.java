package com.easy.query.fork.test.live;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.fork.test.entity.ForkUser;
import org.junit.Assert;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;

import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.stream.Collectors;

/** M3.6：null 安全的相等与 NULLIF 在 MySQL 8.0.18、PG 17、HANA 上执行。 */
@RunWith(Parameterized.class)
public class NullSafeLiveTest {
    @Parameterized.Parameters(name = "{0}")
    public static Collection<Object[]> databases() {
        return Arrays.asList(new Object[] {LiveDatabases.mysql8018()}, new Object[] {LiveDatabases.pg17()}, new Object[] {LiveDatabases.hana()});
    }

    private final LiveDatabases.Live live;

    public NullSafeLiveTest(LiveDatabases.Live live) {
        this.live = live;
    }

    @Test
    public void nullMatchesNullAndEmptyBecomesNull() {
        boolean hana = live.name.startsWith("hana");
        boolean mysql = live.name.startsWith("mysql");
        String q = mysql ? "`" : "\"";
        String text = hana ? "NVARCHAR" : "VARCHAR";
        live.executeIgnoring("DROP TABLE " + q + "t_fork_user" + q);
        live.execute((hana ? "CREATE COLUMN TABLE " : "CREATE TABLE ") + q + "t_fork_user" + q + " (" + q + "id" + q + " " + text + "(32) PRIMARY KEY, "
                + q + "name" + q + " " + text + "(100), " + q + "age" + q + " INT, " + q + "company_id" + q + " " + text + "(32), "
                + q + "attrs" + q + " " + text + "(500), " + q + "created_at" + q + " TIMESTAMP)",
            "INSERT INTO " + q + "t_fork_user" + q + " (" + q + "id" + q + ", " + q + "name" + q + ") VALUES ('u1', 'a')",
            "INSERT INTO " + q + "t_fork_user" + q + " (" + q + "id" + q + ", " + q + "name" + q + ") VALUES ('u2', NULL)",
            "INSERT INTO " + q + "t_fork_user" + q + " (" + q + "id" + q + ", " + q + "name" + q + ") VALUES ('u3', '')");
        EasyEntityQuery db = live.client();

        Assert.assertEquals(Arrays.asList("u2"), ids(db.queryable(ForkUser.class).where(u -> u.name().eqNullSafe((String) null)).toList()));
        Assert.assertEquals(Arrays.asList("u1"), ids(db.queryable(ForkUser.class).where(u -> u.name().eqNullSafe("a")).toList()));
        // HANA 把空串存成空串（不像 Oracle 当 NULL），NULLIF 之后与 NULL 的那行一起匹配
        Assert.assertEquals(Arrays.asList("u2", "u3"), ids(db.queryable(ForkUser.class).where(u -> u.name().nullIf("").isNull()).toList()));
    }

    private static List<String> ids(List<ForkUser> users) {
        return users.stream().map(ForkUser::getId).sorted().collect(Collectors.toList());
    }
}
