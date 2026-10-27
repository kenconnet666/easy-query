package com.easy.query.sql.starter.json;

import com.easy.query.core.basic.extension.conversion.json.JsonCodec;
import com.easy.query.core.exception.EasyQueryInvalidOperationException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.lang.reflect.Type;
import java.util.Objects;

/**
 * fork：用 Jackson 2 的 ObjectMapper 实现 {@link JsonCodec}；starter 在类路径有 Jackson 时自动注册，用应用里的 ObjectMapper bean。
 */
public class JacksonJsonCodec implements JsonCodec {
    private final ObjectMapper mapper;

    public JacksonJsonCodec(ObjectMapper mapper) {
        this.mapper = Objects.requireNonNull(mapper, "mapper");
    }

    @Override
    public String encode(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new EasyQueryInvalidOperationException("cannot write " + value.getClass().getName() + " as JSON", e);
        }
    }

    @Override
    public Object decode(String json, Type type) {
        try {
            return mapper.readValue(json, mapper.constructType(type));
        } catch (JsonProcessingException e) {
            throw new EasyQueryInvalidOperationException("cannot read JSON as " + type.getTypeName(), e);
        }
    }
}
