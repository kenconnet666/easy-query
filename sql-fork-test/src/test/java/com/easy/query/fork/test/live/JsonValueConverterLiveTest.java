package com.easy.query.fork.test.live;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.basic.extension.conversion.json.JsonValueConverter;
import com.easy.query.fork.test.entity.ForkProfile;
import com.easy.query.fork.test.json.TestJsonCodecs;
import org.junit.Assert;
import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** M3.3：JSON 列在实库上往返——MySQL 8.0.18 的 JSON 列、HANA 的 NCLOB（驱动读出 Clob）。 */
public class JsonValueConverterLiveTest {

    @Test
    public void mysql8018JsonColumn() {
        LiveDatabases.Live live = LiveDatabases.mysql8018();
        live.execute("DROP TABLE IF EXISTS t_fork_profile",
            "CREATE TABLE t_fork_profile (id VARCHAR(32) PRIMARY KEY, addresses JSON, extra JSON)");
        roundTrip(live);
    }

    @Test
    public void hanaNclobColumn() {
        LiveDatabases.Live live = LiveDatabases.hana();
        live.executeIgnoring("DROP TABLE \"t_fork_profile\"");
        live.execute("CREATE COLUMN TABLE \"t_fork_profile\" (\"id\" NVARCHAR(32) PRIMARY KEY, \"addresses\" NCLOB, \"extra\" NCLOB)");
        roundTrip(live);
    }

    private static void roundTrip(LiveDatabases.Live live) {
        EasyEntityQuery db = live.client();
        db.getRuntimeContext().getQueryConfiguration().applyValueConverter(new JsonValueConverter(TestJsonCodecs.jackson()));

        ForkProfile p = new ForkProfile();
        p.setId("p1");
        ForkProfile.Address a = new ForkProfile.Address();
        a.setCity("Hangzhou");
        a.setZip(310000);
        p.setAddresses(Arrays.asList(a));
        Map<String, Object> extra = new LinkedHashMap<>();
        extra.put("vip", true);
        extra.put("tags", Arrays.asList("x", "y"));
        p.setExtra(extra);
        db.insertable(p).executeRows();
        ForkProfile empty = new ForkProfile();
        empty.setId("p2");
        db.insertable(empty).executeRows();

        ForkProfile read = db.queryable(ForkProfile.class).whereById("p1").singleNotNull();
        Assert.assertEquals(ForkProfile.Address.class, read.getAddresses().get(0).getClass());
        Assert.assertEquals("Hangzhou", read.getAddresses().get(0).getCity());
        Assert.assertEquals(Integer.valueOf(310000), read.getAddresses().get(0).getZip());
        Assert.assertEquals(true, read.getExtra().get("vip"));
        Assert.assertEquals(Arrays.asList("x", "y"), read.getExtra().get("tags"));

        ForkProfile none = db.queryable(ForkProfile.class).whereById("p2").singleNotNull();
        Assert.assertNull(none.getAddresses());
        Assert.assertNull(none.getExtra());

        read.setAddresses(Collections.<ForkProfile.Address>emptyList());
        db.updatable(read).executeRows();
        Assert.assertEquals(Collections.emptyList(), db.queryable(ForkProfile.class).whereById("p1").singleNotNull().getAddresses());
    }
}
