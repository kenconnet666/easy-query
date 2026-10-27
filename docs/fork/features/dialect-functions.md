# 方言专属函数

只有某个数据库才有的函数，从该方言模块的入口类按列调用；条件方法直接写在 where 里，和 `u.name().eq(..)` 一样。

```java
import com.easy.query.mysql.MySQL;

List<User> vip = easyEntityQuery.queryable(User.class)
    .where(u -> {
        MySQL.json(u.attrs()).contains("\"vip\"", "$.tags");          // JSON_CONTAINS(attrs, ?, ?)
        u.posts().any(p -> MySQL.json(p.tags()).hasMember("java"));   // 隐式子查询里照样用
    })
    .orderBy(u -> MySQL.match(u.title()).score("easy query").desc())  // 全文相关度
    .toList();
```

用在别的方言上（例如 PG 的客户端调用 `MySQL.json`）时，构造表达式就报 `UnsupportedOperationException: MySQL.json is not supported by the current dialect (PgSQLSQLKeyword)`。

## 支持的函数

| 入口 | 方法 | SQL | 说明 |
|---|---|---|---|
| `MySQL.json(col)` | `contains(candidate[, path])` | `JSON_CONTAINS(col, ?[, ?])` | candidate 是 JSON 文字，如 `"\"vip\""` |
| | `overlaps(document)` | `JSON_OVERLAPS(col, ?)` | MySQL 8.0.17+ |
| | `hasMember(value[, path])` | `? MEMBER OF(col)` / `? MEMBER OF(JSON_EXTRACT(col, ?))` | MySQL 8.0.17+ |
| | `containsPath(paths...)` / `containsAllPaths(paths...)` | `JSON_CONTAINS_PATH(col, 'one' / 'all', ?, …)` | 有某个键 / 所有键 |
| | `edit(e -> e.set(path, v).setJson(path, json).arrayAppend(path, v).remove(paths...))` | `JSON_REMOVE(JSON_ARRAY_APPEND(JSON_SET(col, …), …), …)` | 按调用顺序套在列外；结果与列同类型，update 里 `u.attrs().set(MySQL.json(u.attrs()).edit(..))` 写回。布尔、对象、数组用 `setJson`（JDBC 把布尔传成 1 / 0） |
| `MySQL.match(cols...)` | `against(words[, mode])` | `MATCH(cols) AGAINST(? IN NATURAL LANGUAGE MODE)` | mode：`NATURAL_LANGUAGE`、`BOOLEAN`、`QUERY_EXPANSION`；要有 FULLTEXT 索引 |
| | `score(words[, mode])` | 同上，作为值 | select、orderBy 用 |
| `PgSQL.jsonb(col)` | `contains(document)` / `containedBy(document)` | `col::jsonb @> ?::jsonb` / `<@` | |
| | `hasKey(key)`、`hasAnyKey(keys...)`、`hasAllKeys(keys...)` | `jsonb_exists*(col::jsonb, …)` | 不用 `?` 运算符：会被 JDBC 当成占位符 |
| | `edit(e -> e.set(path, json).remove(path).merge(document))` | `jsonb_set(…, ?::text[], ?::jsonb, true)` / `… #- ?::text[]` / `… \|\| ?::jsonb` | path 用点分隔（`"a.b"`、`"tags.0"`）；值是 JSON 文字；结果与列同类型，update 里写回 |
| `Hana.text(cols...)` | `contains(query)` | `CONTAINS(col, ?)` / `CONTAINS((c1, c2), ?)` | EXACT：按词，支持 `"短语"`、`OR`、`-排除`、`*`；**列上要有 FULLTEXT INDEX**，否则按整列值匹配 |
| | `fuzzy(query, threshold)` | `CONTAINS(cols, ?, FUZZY(0.8))` | 容错匹配，threshold 0–1；索引建议带 `FUZZY SEARCH INDEX ON` |
| | `score()` | `SCORE()` | 本查询里 CONTAINS 的相关度，select / orderBy 用 |
| `PgSQL.array(col)` | `has(v)`、`hasAll(vs...)`、`hasAny(vs...)` | `? = ANY(col)`（多个值用 AND / OR 连） | 参数不必与元素类型完全一致；col 要是列（会被引用多次） |
| | `length()` | `cardinality(col)` | 值 |
| `PgSQL.fulltext(col)` | `matches([config, ]query)` | `to_tsvector('simple', col) @@ websearch_to_tsquery('simple', ?)` | 搜索引擎式查询串：`a b`、`"a b"`、`a or b`、`-a`；config 默认 `simple`，要走索引须与表达式索引一致 |
| | `rank([config, ]query)` | `ts_rank(…)` | 值，select / orderBy 用 |

MySQL 的函数都在 8.0.18（生产 PolarDB 的内核）上实测过。读 JSON 里的值不在这里，用已有的 `u.attrs().asJSONObject().getString("name")`。

## 写自己的方言函数

用 `DialectExpressions`，与内置入口完全同形：

```java
public final class MyFunctions {
    /** SOUNDEX(col) = SOUNDEX(?)：条件，写在 where 里 */
    public static void soundsLike(PropTypeColumn<String> column, String word) {
        DialectExpressions.predicate(column, "SOUNDEX({0}) = SOUNDEX({1})", column, word);
    }

    /** CHAR_LENGTH(col)：值，放 select / orderBy，或接着比较 */
    public static NumberTypeExpression<Integer> charLength(PropTypeColumn<String> column) {
        return DialectExpressions.number(column, Integer.class, "CHAR_LENGTH({0})", column);
    }
}
```

- 模板里 `{0}`、`{1}`… 依次对应后面的参数：列和列函数原样引用，其余值写成 `?` 参数。
- 第一个参数（anchor）决定表达式属于哪张表、哪个查询上下文，传函数作用的那一列。
- 只想在某个方言上可用：在自己的 `DatabaseConfiguration` 里注册一个标记类，函数开头调 `DialectExpressions.require(column, MyMarker.class, "MyFunctions.soundsLike")`。

## 限制

- 条件方法只能写在 where / having / on 里；要把布尔结果放进 select，用 `DialectExpressions.bool(..)` 自己包一个。
- JSON 候选值、文档是 JSON 文字，由数据库解析，写错时数据库报错。
