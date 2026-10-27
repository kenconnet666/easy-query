package com.easy.query.core.basic.extension.conversion.json;

import java.lang.reflect.Type;

/**
 * fork：JSON 的编解码，{@link JsonValueConverter} 用它把属性值写成 JSON 文字、把 JSON 文字读回属性的类型。
 * easy-query 不绑定任何 JSON 库；Spring Boot starter 在有 Jackson 时自动提供一个，其它库（fastjson2、Gson、json-wire…）自己实现这两个方法：
 * <pre>{@code
 * JsonCodec codec = new JsonCodec() {
 *     public String encode(Object value) { return JSON.toJSONString(value); }
 *     public Object decode(String json, Type type) { return JSON.parseObject(json, type); }
 * };
 * }</pre>
 */
public interface JsonCodec {
    /**
     * 属性值 → JSON 文字；value 不为 null
     */
    String encode(Object value);

    /**
     * JSON 文字 → type 的实例；type 是属性的声明类型，带泛型（例如 {@code List<Address>}），json 不为空白
     */
    Object decode(String json, Type type);
}
