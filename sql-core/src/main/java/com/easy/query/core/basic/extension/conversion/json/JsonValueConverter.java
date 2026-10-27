package com.easy.query.core.basic.extension.conversion.json;

import com.easy.query.core.basic.extension.conversion.ValueConverter;
import com.easy.query.core.exception.EasyQueryInvalidOperationException;
import com.easy.query.core.metadata.ColumnMetadata;
import com.easy.query.core.util.EasyClassUtil;
import com.easy.query.core.util.EasyStringUtil;
import org.jetbrains.annotations.NotNull;

import java.io.IOException;
import java.io.Reader;
import java.lang.reflect.Field;
import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.sql.Clob;
import java.sql.SQLException;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;

/**
 * fork：把属性存成 JSON 文字列。读回时按属性的声明类型（含泛型，如 {@code List<Address>}、{@code Map<String, Object>}）解码：
 * <pre>{@code
 * @Column(conversion = JsonValueConverter.class)
 * private List<Address> addresses;
 *
 * // 非 Spring：注册一次
 * configuration.applyValueConverter(new JsonValueConverter(codec));
 * }</pre>
 * Spring Boot starter 会自动注册（有 {@link JsonCodec} bean 时用它，否则有 Jackson 时用 Jackson）。
 * 写入的是字符串参数：PostgreSQL 的 json / jsonb 列需要连接串加 {@code stringtype=unspecified}，或用列类型为文字的列。
 */
public class JsonValueConverter implements ValueConverter<Object, Object> {
    private final JsonCodec codec;
    private final Map<ColumnMetadata, Type> types = new ConcurrentHashMap<>();

    public JsonValueConverter(@NotNull JsonCodec codec) {
        this.codec = Objects.requireNonNull(codec, "codec");
    }

    @Override
    public Object serialize(Object property, @NotNull ColumnMetadata columnMetadata) {
        return property == null ? null : codec.encode(property);
    }

    @Override
    public Object deserialize(Object provider, @NotNull ColumnMetadata columnMetadata) {
        String json = text(provider, columnMetadata);
        if (EasyStringUtil.isBlank(json)) {
            return null;
        }
        return codec.decode(json, types.computeIfAbsent(columnMetadata, JsonValueConverter::declaredType));
    }

    /** 驱动读出的值：多数是 String；PG 的 PGobject、HANA 的 NCLOB、二进制列各不相同 */
    private static String text(Object provider, ColumnMetadata column) {
        if (provider == null || provider instanceof String) {
            return (String) provider;
        }
        if (provider instanceof byte[]) {
            return new String((byte[]) provider, StandardCharsets.UTF_8);
        }
        if (provider instanceof Clob) {
            return clobText((Clob) provider, column);
        }
        // PGobject 等：toString 即 JSON 文字
        return provider.toString();
    }

    private static String clobText(Clob clob, ColumnMetadata column) {
        try (Reader reader = clob.getCharacterStream()) {
            StringBuilder text = new StringBuilder();
            char[] buffer = new char[4096];
            for (int n; (n = reader.read(buffer)) != -1; ) {
                text.append(buffer, 0, n);
            }
            return text.toString();
        } catch (SQLException | IOException e) {
            throw new EasyQueryInvalidOperationException("cannot read JSON column " + describe(column), e);
        }
    }

    private static Type declaredType(ColumnMetadata column) {
        Class<?> owner = column.getEntityMetadata().getEntityClass();
        // 含父类的字段：实体常把公共列放在基类里
        Field field = EasyClassUtil.getAllFieldsMap(owner).get(column.getPropertyName());
        if (field == null) {
            // 没有同名字段（例如只有 getter 的属性）时退回属性的原始类型
            return column.getPropertyType();
        }
        return field.getGenericType();
    }

    private static String describe(ColumnMetadata column) {
        return column.getEntityMetadata().getEntityClass().getSimpleName() + "." + column.getPropertyName();
    }
}
