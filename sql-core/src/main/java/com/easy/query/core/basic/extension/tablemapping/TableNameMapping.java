package com.easy.query.core.basic.extension.tablemapping;

import java.util.ArrayDeque;
import java.util.Collections;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.function.Supplier;

/**
 * fork：一段代码里把实体映射到别的表（典型：热表 ↔ 归档表）。在作用域内执行的所有 SQL——主表、隐式 join、隐式子查询、
 * include / selectAutoInclude 拉取的关联查询——凡用到映射里的实体，表名都换成映射的表名：
 * <pre>{@code
 * static final TableNameMapping ARCHIVE = TableNameMapping.builder()
 *     .map(InstanceEntity.class, "flow_instance_archive")
 *     .map(WorkItemEntity.class, "flow_work_item_archive")
 *     .build();
 *
 * List<TodoItem> rows = ARCHIVE.call(() -> db.queryable(WorkItemEntity.class).where(...).selectAutoInclude(TodoItem.class).toList());
 * }</pre>
 * 作用域跟着当前线程（与 easy-query 的事务一样），要在作用域内执行完（toList、count 等终结方法）；嵌套时内层的映射覆盖外层同一实体的映射。
 * 显式的 {@code asTable(..)} 和分表路由优先于这里的映射。实例不可变，可以做成常量共用。
 */
public final class TableNameMapping {
    private static final TableNameMapping EMPTY = new TableNameMapping(Collections.<Class<?>, String>emptyMap());
    private static final ThreadLocal<Deque<TableNameMapping>> SCOPES = new ThreadLocal<>();

    private final Map<Class<?>, String> tables;

    private TableNameMapping(Map<Class<?>, String> tables) {
        this.tables = tables;
    }

    public static Builder builder() {
        return new Builder();
    }

    /** 什么也不映射：{@code (archived ? ARCHIVE : TableNameMapping.empty()).call(...)} */
    public static TableNameMapping empty() {
        return EMPTY;
    }

    /** 这个映射里 entityClass 对应的表名；没有映射时为 null（例：搬数据时取目标表，{@code InsertSelect…into(ARCHIVE.tableName(X.class))}） */
    public String tableName(Class<?> entityClass) {
        return tables.get(entityClass);
    }

    /** 在这个映射下执行并返回结果 */
    public <T> T call(Supplier<T> work) {
        try (Scope ignored = open()) {
            return work.get();
        }
    }

    /** 在这个映射下执行 */
    public void run(Runnable work) {
        try (Scope ignored = open()) {
            work.run();
        }
    }

    /** 打开作用域，配合 try-with-resources 使用；关闭时恢复外层的映射 */
    public Scope open() {
        Deque<TableNameMapping> scopes = SCOPES.get();
        if (scopes == null) {
            scopes = new ArrayDeque<>();
            SCOPES.set(scopes);
        }
        scopes.push(this);
        return new Scope();
    }

    /**
     * 当前线程上生效的、entityClass 的映射表名；没有时为 null。生成表名的地方（TableSQLExpressionImpl）调用。
     */
    public static String currentTableName(Class<?> entityClass) {
        Deque<TableNameMapping> scopes = SCOPES.get();
        if (scopes == null) {
            return null;
        }
        for (TableNameMapping mapping : scopes) {
            String table = mapping.tables.get(entityClass);
            if (table != null) {
                return table;
            }
        }
        return null;
    }

    /** 一层作用域；关闭两次无害 */
    public static final class Scope implements AutoCloseable {
        private boolean closed;

        private Scope() { }

        @Override
        public void close() {
            if (closed) {
                return;
            }
            closed = true;
            Deque<TableNameMapping> scopes = SCOPES.get();
            if (scopes != null) {
                scopes.pop();
                if (scopes.isEmpty()) {
                    SCOPES.remove();
                }
            }
        }
    }

    public static final class Builder {
        private final Map<Class<?>, String> tables = new LinkedHashMap<>();

        private Builder() { }

        /** entityClass 映射到 tableName（不加引号的表名，按方言加引号） */
        public Builder map(Class<?> entityClass, String tableName) {
            Objects.requireNonNull(entityClass, "entityClass");
            if (tableName == null || tableName.trim().isEmpty()) {
                throw new IllegalArgumentException("tableName for " + entityClass.getName() + " is empty");
            }
            tables.put(entityClass, tableName);
            return this;
        }

        public TableNameMapping build() {
            return new TableNameMapping(Collections.unmodifiableMap(new LinkedHashMap<>(tables)));
        }
    }
}
