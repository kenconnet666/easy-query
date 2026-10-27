package com.easy.query.fork.test.functions;

import com.easy.query.core.func.def.enums.DateTruncEnum;
import com.easy.query.core.proxy.sql.Select;
import com.easy.query.fork.test.ForkClients;
import com.easy.query.fork.test.entity.ForkUser;
import com.easy.query.mssql.config.MsSQLDatabaseConfiguration;
import com.easy.query.mysql.config.MySQLDatabaseConfiguration;
import com.easy.query.pgsql.config.PgSQLDatabaseConfiguration;
import org.junit.Assert;
import org.junit.Test;

/** M3.7：日期截断的写法；没实现的方言报清楚的错误。 */
public class DateTruncSqlTest {
    @Test
    public void postgresUsesDateTrunc() {
        Assert.assertEquals("SELECT DATE_TRUNC('quarter', t.\"created_at\") AS \"value1\" FROM \"t_fork_user\" t",
            ForkClients.sqlOnly(new PgSQLDatabaseConfiguration()).queryable(ForkUser.class)
                .select(u -> Select.DRAFT.of(u.createdAt().dateTrunc(DateTruncEnum.QUARTER))).toSQL());
    }

    @Test
    public void mysqlRepeatsTheColumnForWeeks() {
        Assert.assertEquals("SELECT DATE_SUB(CAST(DATE_FORMAT(t.`created_at`,'%Y-%m-%d 00:00:00') AS DATETIME), INTERVAL WEEKDAY(t.`created_at`) DAY) AS `value1` FROM `t_fork_user` t",
            ForkClients.sqlOnly(new MySQLDatabaseConfiguration()).queryable(ForkUser.class)
                .select(u -> Select.DRAFT.of(u.createdAt().dateTrunc(DateTruncEnum.WEEK))).toSQL());
    }

    @Test
    public void unsupportedDialectSaysSo() {
        try {
            ForkClients.sqlOnly(new MsSQLDatabaseConfiguration()).queryable(ForkUser.class)
                .select(u -> Select.DRAFT.of(u.createdAt().dateTrunc(DateTruncEnum.DAY))).toSQL();
            Assert.fail("expected UnsupportedOperationException");
        } catch (UnsupportedOperationException expected) {
            Assert.assertTrue(expected.getMessage(), expected.getMessage().contains("dateTrunc(DAY)"));
        }
    }
}
