package com.easy.query.fork.test.json;

import com.easy.query.core.basic.extension.conversion.json.JsonCodec;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.lang.reflect.Type;

/** 用例里用的 Jackson 编解码（与 starter 的 JacksonJsonCodec 同样写法；fork-test 不依赖 starter）。 */
public final class TestJsonCodecs {
    private TestJsonCodecs() { }

    public static JsonCodec jackson() {
        ObjectMapper mapper = new ObjectMapper();
        return new JsonCodec() {
            @Override
            public String encode(Object value) {
                try {
                    return mapper.writeValueAsString(value);
                } catch (IOException e) {
                    throw new IllegalStateException(e);
                }
            }

            @Override
            public Object decode(String json, Type type) {
                try {
                    return mapper.readValue(json, mapper.constructType(type));
                } catch (IOException e) {
                    throw new IllegalStateException(e);
                }
            }
        };
    }
}
