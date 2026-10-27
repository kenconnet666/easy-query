package com.easy.query.fork.test.live;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.func.def.enums.DateTruncEnum;
import com.easy.query.core.proxy.core.draft.Draft8;
import com.easy.query.core.proxy.sql.Select;
import com.easy.query.fork.test.entity.ForkUser;
import org.junit.Assert;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Collection;

/** M3.7：2026-08-27（周四）13:45:56 截到各粒度，在 MySQL 8.0.18、PG 17、HANA 上结果一致。 */
@RunWith(Parameterized.class)
public class DateTruncLiveTest {
    @Parameterized.Parameters(name = "{0}")
    public static Collection<Object[]> databases() {
        return Arrays.asList(new Object[] {LiveDatabases.mysql8018()}, new Object[] {LiveDatabases.pg17()}, new Object[] {LiveDatabases.hana()});
    }

    private final LiveDatabases.Live live;

    public DateTruncLiveTest(LiveDatabases.Live live) {
        this.live = live;
    }

    @Test
    public void truncatesToEachUnit() {
        boolean hana = live.name.startsWith("hana");
        String q = live.name.startsWith("mysql") ? "`" : "\"";
        String text = hana ? "NVARCHAR" : "VARCHAR";
        live.executeIgnoring("DROP TABLE " + q + "t_fork_user" + q);
        live.execute((hana ? "CREATE COLUMN TABLE " : "CREATE TABLE ") + q + "t_fork_user" + q + " (" + q + "id" + q + " " + text + "(32) PRIMARY KEY, "
                + q + "name" + q + " " + text + "(100), " + q + "age" + q + " INT, " + q + "company_id" + q + " " + text + "(32), "
                + q + "attrs" + q + " " + text + "(500), " + q + "created_at" + q + " TIMESTAMP)");
        EasyEntityQuery db = live.client();
        ForkUser user = new ForkUser();
        user.setId("u1");
        user.setCreatedAt(LocalDateTime.of(2026, 8, 27, 13, 45, 56));
        db.insertable(user).executeRows();

        Draft8<LocalDateTime, LocalDateTime, LocalDateTime, LocalDateTime, LocalDateTime, LocalDateTime, LocalDateTime, LocalDateTime> r = db.queryable(ForkUser.class)
            .select(u -> Select.DRAFT.of(
                u.createdAt().dateTrunc(DateTruncEnum.YEAR),
                u.createdAt().dateTrunc(DateTruncEnum.QUARTER),
                u.createdAt().dateTrunc(DateTruncEnum.MONTH),
                u.createdAt().dateTrunc(DateTruncEnum.WEEK),
                u.createdAt().dateTrunc(DateTruncEnum.DAY),
                u.createdAt().dateTrunc(DateTruncEnum.HOUR),
                u.createdAt().dateTrunc(DateTruncEnum.MINUTE),
                u.createdAt().dateTrunc(DateTruncEnum.SECOND)))
            .singleNotNull();
        Assert.assertEquals(LocalDateTime.of(2026, 1, 1, 0, 0), r.getValue1());
        Assert.assertEquals(LocalDateTime.of(2026, 7, 1, 0, 0), r.getValue2());
        Assert.assertEquals(LocalDateTime.of(2026, 8, 1, 0, 0), r.getValue3());
        Assert.assertEquals(LocalDateTime.of(2026, 8, 24, 0, 0), r.getValue4());
        Assert.assertEquals(LocalDateTime.of(2026, 8, 27, 0, 0), r.getValue5());
        Assert.assertEquals(LocalDateTime.of(2026, 8, 27, 13, 0), r.getValue6());
        Assert.assertEquals(LocalDateTime.of(2026, 8, 27, 13, 45), r.getValue7());
        Assert.assertEquals(LocalDateTime.of(2026, 8, 27, 13, 45, 56), r.getValue8());

        Assert.assertEquals(1L, db.queryable(ForkUser.class)
            .where(u -> u.createdAt().dateTrunc(DateTruncEnum.MONTH).eq(LocalDateTime.of(2026, 8, 1, 0, 0)))
            .count());
    }
}
