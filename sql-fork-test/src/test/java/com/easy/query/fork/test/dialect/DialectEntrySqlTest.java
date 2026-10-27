package com.easy.query.fork.test.dialect;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.extension.dialect.DialectExpressions;
import com.easy.query.core.proxy.sql.Select;
import com.easy.query.fork.test.ForkClients;
import com.easy.query.fork.test.entity.ForkUser;
import com.easy.query.mysql.MySQL;
import com.easy.query.mysql.config.MySQLDatabaseConfiguration;
import com.easy.query.mysql.proxy.MySQLMatch;
import com.easy.query.pgsql.PgSQL;
import com.easy.query.pgsql.config.PgSQLDatabaseConfiguration;
import org.junit.Assert;
import org.junit.Test;

/**
 * 方言专属函数入口（M1.1）生成的 SQL：普通 where、or 分组、隐式子查询、select、orderBy，错方言报错，以及用户自写的扩展。
 */
public class DialectEntrySqlTest {
    private final EasyEntityQuery mysql = ForkClients.sqlOnly(new MySQLDatabaseConfiguration());
    private final EasyEntityQuery pg = ForkClients.sqlOnly(new PgSQLDatabaseConfiguration());

    private static final String USER_COLUMNS = "`id`,`name`,`age`,`company_id`,`attrs`,`created_at`";

    @Test
    public void mysqlJsonPredicatesInWhere() {
        String sql = mysql.queryable(ForkUser.class)
            .where(u -> {
                MySQL.json(u.attrs()).contains("\"vip\"", "$.tags");
                MySQL.json(u.attrs()).hasMember("java", "$.skills");
                MySQL.json(u.attrs()).overlaps("[1,2]");
            })
            .toSQL();
        Assert.assertEquals("SELECT " + USER_COLUMNS + " FROM `t_fork_user` WHERE JSON_CONTAINS(`attrs`,?,?)"
            + " AND ? MEMBER OF(JSON_EXTRACT(`attrs`,?)) AND JSON_OVERLAPS(`attrs`,?)", sql);
    }

    @Test
    public void mysqlPredicateRespectsOrGroup() {
        String sql = mysql.queryable(ForkUser.class)
            .where(u -> {
                u.name().eq("a");
                u.or(() -> {
                    MySQL.json(u.attrs()).contains("1");
                    u.age().gt(18);
                });
            })
            .toSQL();
        Assert.assertEquals("SELECT " + USER_COLUMNS + " FROM `t_fork_user` WHERE `name` = ? AND (JSON_CONTAINS(`attrs`,?) OR `age` > ?)", sql);
    }

    @Test
    public void mysqlPredicateInsideImplicitSubquery() {
        String sql = mysql.queryable(ForkUser.class)
            .where(u -> u.posts().any(p -> MySQL.json(p.title()).hasMember("x")))
            .toSQL();
        Assert.assertEquals("SELECT t." + USER_COLUMNS.replace(",`", ",t.`") + " FROM `t_fork_user` t WHERE EXISTS(SELECT 1 FROM `t_fork_post` t1"
            + " WHERE t1.`user_id` = t.`id` AND ? MEMBER OF(t1.`title`) LIMIT 1)", sql);
    }

    @Test
    public void mysqlFullTextAgainstAndScore() {
        String sql = mysql.queryable(ForkUser.class)
            .where(u -> MySQL.match(u.name(), u.attrs()).against("+easy -slow", MySQLMatch.Mode.BOOLEAN))
            .orderBy(u -> MySQL.match(u.name(), u.attrs()).score("easy").desc())
            .select(u -> Select.DRAFT.of(u.id(), MySQL.match(u.name()).score("easy")))
            .toSQL();
        Assert.assertEquals("SELECT t.`id` AS `value1`,MATCH(t.`name`) AGAINST(? IN NATURAL LANGUAGE MODE) AS `value2` FROM `t_fork_user` t"
            + " WHERE MATCH(t.`name`,t.`attrs`) AGAINST(? IN BOOLEAN MODE)"
            + " ORDER BY MATCH(t.`name`,t.`attrs`) AGAINST(? IN NATURAL LANGUAGE MODE) DESC", sql);
    }

    @Test
    public void pgJsonbPredicates() {
        String sql = pg.queryable(ForkUser.class)
            .where(u -> {
                PgSQL.jsonb(u.attrs()).contains("{\"vip\":true}");
                PgSQL.jsonb(u.attrs()).hasKey("tags");
                PgSQL.jsonb(u.attrs()).hasAnyKey("a", "b");
            })
            .toSQL();
        Assert.assertEquals("SELECT \"id\",\"name\",\"age\",\"company_id\",\"attrs\",\"created_at\" FROM \"t_fork_user\""
            + " WHERE (\"attrs\")::jsonb @> (?)::jsonb AND jsonb_exists((\"attrs\")::jsonb,?)"
            + " AND jsonb_exists_any((\"attrs\")::jsonb,ARRAY[?,?]::text[])", sql);
    }

    @Test
    public void wrongDialectFailsWhenTheExpressionIsBuilt() {
        Assert.assertEquals("MySQL.json is not supported by the current dialect (PgSQLSQLKeyword)",
            unsupported(() -> pg.queryable(ForkUser.class).where(u -> MySQL.json(u.attrs()).contains("1")).toSQL()));
        Assert.assertEquals("PgSQL.jsonb is not supported by the current dialect (MySQLSQLKeyword)",
            unsupported(() -> mysql.queryable(ForkUser.class).where(u -> PgSQL.jsonb(u.attrs()).hasKey("a")).toSQL()));
    }

    /** JUnit 4.12 没有 assertThrows：执行并返回 UnsupportedOperationException 的消息 */
    private static String unsupported(Runnable action) {
        try {
            action.run();
        } catch (UnsupportedOperationException e) {
            return e.getMessage();
        }
        throw new AssertionError("expected UnsupportedOperationException");
    }

    /** 用户自己写的方言函数：与内置入口用同一个工具，写法与生成方式没有差别。 */
    static final class MyFunctions {
        static void soundsLike(PropTypeColumn<String> column, String word) {
            DialectExpressions.predicate(column, "SOUNDEX({0}) = SOUNDEX({1})", column, word);
        }

        static com.easy.query.core.proxy.extension.functions.type.NumberTypeExpression<Integer> charLength(PropTypeColumn<String> column) {
            return DialectExpressions.number(column, Integer.class, "CHAR_LENGTH({0})", column);
        }
    }

    @Test
    public void userDefinedValueFunctionChainsLikeBuiltIns() {
        String sql = mysql.queryable(ForkUser.class)
            .where(u -> MyFunctions.charLength(u.name()).gt(3))
            .orderBy(u -> MyFunctions.charLength(u.name()).desc())
            .toSQL();
        Assert.assertEquals("SELECT " + USER_COLUMNS + " FROM `t_fork_user` WHERE CHAR_LENGTH(`name`) > ? ORDER BY CHAR_LENGTH(`name`) DESC", sql);
    }

    @Test
    public void userDefinedFunctionHasTheSameShape() {
        String sql = mysql.queryable(ForkUser.class)
            .where(u -> u.posts().any(p -> MyFunctions.soundsLike(p.title(), "smith")))
            .toSQL();
        Assert.assertEquals("SELECT t." + USER_COLUMNS.replace(",`", ",t.`") + " FROM `t_fork_user` t WHERE EXISTS(SELECT 1 FROM `t_fork_post` t1"
            + " WHERE t1.`user_id` = t.`id` AND SOUNDEX(t1.`title`) = SOUNDEX(?) LIMIT 1)", sql);
    }
}
