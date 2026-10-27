package com.easy.query.mysql.proxy;

import java.util.ArrayList;
import java.util.List;

/**
 * fork：一串 JSON 修改，按调用顺序套在列外面（{@code JSON_REMOVE(JSON_SET(col, …), …)}），由 {@code MySQL.json(col).edit(..)} 使用。
 * path 形如 {@code "$.a.b"}、{@code "$.tags[0]"}。
 */
public final class MySQLJsonEdit {
    private String template = "{0}";
    private final List<Object> args = new ArrayList<>();

    MySQLJsonEdit(Object column) {
        args.add(column);
    }

    /**
     * 把 path 处设为 value（没有就加上）：{@code JSON_SET(…, ?, ?)}。value 是文字或数；布尔、对象、数组用 {@link #setJson}
     * （JDBC 把 Java 布尔当成 1 / 0 传，写进 JSON 会变成数）。
     */
    public MySQLJsonEdit set(String path, Object value) {
        return wrap("JSON_SET", path, value, false);
    }

    /** 把 path 处设为一段 JSON（{@code "true"}、{@code "{\"a\":1}"}、{@code "[1,2]"}）：{@code JSON_SET(…, ?, CAST(? AS JSON))}。 */
    public MySQLJsonEdit setJson(String path, String json) {
        return wrap("JSON_SET", path, json, true);
    }

    /** 往 path 处的数组末尾追加 value：{@code JSON_ARRAY_APPEND(…, ?, ?)}。 */
    public MySQLJsonEdit arrayAppend(String path, Object value) {
        return wrap("JSON_ARRAY_APPEND", path, value, false);
    }

    /** 删掉这些 path：{@code JSON_REMOVE(…, ?, …)}。 */
    public MySQLJsonEdit remove(String... paths) {
        if (paths.length == 0) {
            throw new IllegalArgumentException("remove needs at least one path");
        }
        StringBuilder sql = new StringBuilder("JSON_REMOVE(").append(template);
        for (String path : paths) {
            sql.append(",{").append(args.size()).append('}');
            args.add(path);
        }
        template = sql.append(')').toString();
        return this;
    }

    private MySQLJsonEdit wrap(String function, String path, Object value, boolean json) {
        int pathIndex = args.size();
        args.add(path);
        args.add(value);
        String valueSQL = "{" + (pathIndex + 1) + "}";
        template = function + "(" + template + ",{" + pathIndex + "}," + (json ? "CAST(" + valueSQL + " AS JSON)" : valueSQL) + ")";
        return this;
    }

    String template() {
        return template;
    }

    Object[] args() {
        return args.toArray();
    }
}
