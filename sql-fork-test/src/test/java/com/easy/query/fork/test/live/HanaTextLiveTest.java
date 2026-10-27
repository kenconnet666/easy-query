package com.easy.query.fork.test.live;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.proxy.core.draft.Draft2;
import com.easy.query.core.proxy.sql.Select;
import com.easy.query.fork.test.entity.ForkPost;
import com.easy.query.hana.Hana;
import org.junit.Assert;
import org.junit.Test;

import java.util.List;

/** M4.1：HANA 2.0 的 CONTAINS（EXACT、FUZZY、多列）与 SCORE()。 */
public class HanaTextLiveTest {
    private final LiveDatabases.Live live = LiveDatabases.hana();

    @Test
    public void containsFuzzyAndScore() {
        live.executeIgnoring("DROP TABLE \"t_fork_post\"");
        live.execute("CREATE COLUMN TABLE \"t_fork_post\" (\"id\" NVARCHAR(32) PRIMARY KEY, \"user_id\" NVARCHAR(32), \"title\" NVARCHAR(200), \"amount\" DECIMAL(12,2))",
            "INSERT INTO \"t_fork_post\" VALUES ('p1', 'orm notes', 'easy query makes orm simple', 1)",
            "INSERT INTO \"t_fork_post\" VALUES ('p2', 'jdbc', 'plain jdbc is verbose', 2)",
            "INSERT INTO \"t_fork_post\" VALUES ('p3', 'mixed', 'easy query and jdbc together', 3)");
        // 没有全文索引时 CONTAINS 按整列值匹配；词级检索与 FUZZY 要 FULLTEXT INDEX
        live.execute("CREATE FULLTEXT INDEX \"ft_fork_post_title\" ON \"t_fork_post\"(\"title\") FUZZY SEARCH INDEX ON SYNC",
            "CREATE FULLTEXT INDEX \"ft_fork_post_user\" ON \"t_fork_post\"(\"user_id\") FUZZY SEARCH INDEX ON SYNC");
        EasyEntityQuery db = live.client();

        Assert.assertEquals(2L, db.queryable(ForkPost.class).where(p -> Hana.text(p.title()).contains("jdbc")).count());
        Assert.assertEquals(1L, db.queryable(ForkPost.class).where(p -> Hana.text(p.title()).contains("query -jdbc")).count());
        // 拼写错误也能匹配
        Assert.assertEquals(2L, db.queryable(ForkPost.class).where(p -> Hana.text(p.title()).fuzzy("qurey", 0.7)).count());
        // 多列：任一列匹配
        Assert.assertEquals(1L, db.queryable(ForkPost.class).where(p -> Hana.text(p.userId(), p.title()).contains("notes")).count());

        List<Draft2<String, Double>> scored = db.queryable(ForkPost.class)
            .where(p -> Hana.text(p.title()).fuzzy("easy query", 0.7))
            .orderBy(p -> p.id().asc())
            .select(p -> Select.DRAFT.of(p.id(), Hana.text(p.title()).score()))
            .toList();
        Assert.assertEquals(2, scored.size());
        Assert.assertTrue(scored.get(0).getValue2() > 0);
    }
}
