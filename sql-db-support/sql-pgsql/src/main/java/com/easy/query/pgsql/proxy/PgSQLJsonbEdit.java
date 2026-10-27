package com.easy.query.pgsql.proxy;

import java.util.ArrayList;
import java.util.List;

/**
 * fork：一串 jsonb 修改，按调用顺序套在 {@code col::jsonb} 外面，由 {@code PgSQL.jsonb(col).edit(..)} 使用。
 * path 用点分隔（{@code "a.b"}、数组下标 {@code "tags.0"}），渲染成 PG 的路径数组 {@code '{a,b}'}；值是 JSON 文字。
 */
public final class PgSQLJsonbEdit {
    private String template = "({0})::jsonb";
    private final List<Object> args = new ArrayList<>();

    PgSQLJsonbEdit(Object column) {
        args.add(column);
    }

    /** 把 path 处设为 json（没有就加上）：{@code jsonb_set(…, ?::text[], ?::jsonb, true)}。 */
    public PgSQLJsonbEdit set(String path, String json) {
        template = "jsonb_set(" + template + "," + next(pathArray(path)) + "::text[]," + next(json) + "::jsonb,true)";
        return this;
    }

    /** 删掉 path 处（键或数组元素）：{@code … #- ?::text[]}。 */
    public PgSQLJsonbEdit remove(String path) {
        template = "(" + template + " #- " + next(pathArray(path)) + "::text[])";
        return this;
    }

    /** 与 document 合并（同名键以 document 为准，数组则拼接）：{@code … || ?::jsonb}。 */
    public PgSQLJsonbEdit merge(String document) {
        template = "(" + template + " || " + next(document) + "::jsonb)";
        return this;
    }

    private String next(Object value) {
        args.add(value);
        return "({" + (args.size() - 1) + "})";
    }

    private static String pathArray(String path) {
        if (path == null || path.trim().isEmpty()) {
            throw new IllegalArgumentException("jsonb path is empty");
        }
        return "{" + String.join(",", path.split("\\.")) + "}";
    }

    String template() {
        return template;
    }

    Object[] args() {
        return args.toArray();
    }
}
