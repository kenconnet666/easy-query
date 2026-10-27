package com.easy.query.sql.starter.json;

import com.easy.query.core.basic.extension.conversion.json.JsonCodec;
import com.easy.query.core.basic.extension.conversion.json.JsonValueConverter;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.AutoConfigureAfter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * fork：注册 {@link JsonValueConverter}，实体上写 {@code @Column(conversion = JsonValueConverter.class)} 即可。
 * 编解码用应用里的 {@link JsonCodec} bean；没有时、类路径上有 Jackson 2 则用 ObjectMapper bean（没有就 new 一个）。
 * 两者都没有时不注册，用到这个转换器的实体会在启动时报"找不到 conversion"。
 */
@Configuration
@AutoConfigureAfter(name = "org.springframework.boot.autoconfigure.jackson.JacksonAutoConfiguration")
public class EasyQueryJsonAutoConfiguration {

    @Configuration
    @ConditionalOnClass(name = "com.fasterxml.jackson.databind.ObjectMapper")
    static class JacksonCodecConfiguration {
        @Bean
        @ConditionalOnMissingBean(JsonCodec.class)
        public JsonCodec easyQueryJacksonJsonCodec(ObjectProvider<ObjectMapper> mapper) {
            return new JacksonJsonCodec(mapper.getIfAvailable(ObjectMapper::new));
        }
    }

    @Bean
    @ConditionalOnBean(JsonCodec.class)
    @ConditionalOnMissingBean(JsonValueConverter.class)
    public JsonValueConverter easyQueryJsonValueConverter(JsonCodec codec) {
        return new JsonValueConverter(codec);
    }
}
