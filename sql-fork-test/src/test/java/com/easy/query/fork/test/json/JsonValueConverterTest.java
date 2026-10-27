package com.easy.query.fork.test.json;

import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.basic.extension.conversion.json.JsonValueConverter;
import com.easy.query.core.metadata.ColumnMetadata;
import com.easy.query.fork.test.ForkClients;
import com.easy.query.fork.test.entity.ForkProfile;
import com.easy.query.mysql.config.MySQLDatabaseConfiguration;
import org.junit.Assert;
import org.junit.Test;

import javax.sql.rowset.serial.SerialClob;
import java.util.List;

/** M3.3：JsonValueConverter 按属性的泛型类型解码，接受驱动读出的各种 JSON 载体。 */
public class JsonValueConverterTest {
    private final JsonValueConverter converter = new JsonValueConverter(TestJsonCodecs.jackson());
    private final ColumnMetadata addresses;

    public JsonValueConverterTest() {
        EasyEntityQuery db = ForkClients.sqlOnly(new MySQLDatabaseConfiguration());
        db.getRuntimeContext().getQueryConfiguration().applyValueConverter(converter);
        addresses = db.getRuntimeContext().getEntityMetadataManager().getEntityMetadata(ForkProfile.class).getColumnNotNull("addresses");
    }

    @Test
    public void decodesWithTheDeclaredGenericType() throws Exception {
        String json = "[{\"city\":\"Hangzhou\",\"zip\":310000}]";
        for (Object provider : new Object[]{json, json.getBytes("UTF-8"), new SerialClob(json.toCharArray())}) {
            List<?> list = (List<?>) converter.deserialize(provider, addresses);
            Assert.assertEquals(ForkProfile.Address.class, list.get(0).getClass());
            Assert.assertEquals("Hangzhou", ((ForkProfile.Address) list.get(0)).getCity());
        }
    }

    @Test
    public void nullAndBlankStayNull() {
        Assert.assertNull(converter.serialize(null, addresses));
        Assert.assertNull(converter.deserialize(null, addresses));
        Assert.assertNull(converter.deserialize("  ", addresses));
    }

    @Test
    public void columnIsBoundToTheConverter() {
        Assert.assertSame(converter, addresses.getValueConverter());
    }
}
