# JSON 列：JsonValueConverter + JsonCodec

把属性存成 JSON 文字列，读回时按属性的**声明类型**（含泛型）解码：

```java
@Column(conversion = JsonValueConverter.class)
private List<Address> addresses;          // 读回的是 List<Address>，不是 List<Map>
@Column(conversion = JsonValueConverter.class)
private Map<String, Object> extra;
```

- **Spring Boot starter**：自动注册。有 `JsonCodec` bean 时用它；否则类路径上有 Jackson 2 时用应用的 `ObjectMapper` bean（没有就 new 一个）。
- **非 Spring / Solon**：注册一次 `configuration.applyValueConverter(new JsonValueConverter(codec))`。
- **换 JSON 库**：实现 `JsonCodec` 的两个方法（`encode(Object)`、`decode(String, Type)`），fastjson2、Gson、json-wire 都是几行。

读取时接受驱动给出的各种载体：String、byte[]（UTF-8）、`Clob`（HANA NCLOB）、其它对象取 `toString()`（PG 的 PGobject）。空白与 NULL 读成 null。

注意：

- 写入的是字符串参数。PostgreSQL 的 json / jsonb 列需要连接串加 `stringtype=unspecified`（否则报"column is of type jsonb but expression is of type character varying"）。
- Spring Boot 4 默认是 Jackson 3（`tools.jackson`），starter 目前只自动适配 Jackson 2；只有 Jackson 3 时请自己提供 `JsonCodec` bean（见 BACKLOG）。
- 解码类型取同名字段（含父类）的泛型类型；没有同名字段时退回属性的原始类型。

实测：MySQL 8.0.18 的 JSON 列、HANA 2.0 的 NCLOB（`sql-fork-test` 的 `JsonValueConverterLiveTest`）。
