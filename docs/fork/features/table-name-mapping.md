# 把实体换到别的表：TableNameMapping

一段代码里，让实体读写另一张结构相同的表（典型：归档表、按年分的历史表），导航、隐式子查询、include / selectAutoInclude 全部跟着换：

```java
static final TableNameMapping ARCHIVE = TableNameMapping.builder()
    .map(InstanceEntity.class, "flow_instance_archive")
    .map(WorkItemEntity.class, "flow_work_item_archive")
    .build();

// 待办（归档）带上它的实例：selectAutoInclude 拉实例时也读 flow_instance_archive
List<TodoItem> rows = ARCHIVE.call(() -> db.queryable(WorkItemEntity.class)
    .where(w -> w.instance().processKey().eq(key))     // 隐式 join 也是归档表
    .selectAutoInclude(TodoItem.class)
    .toList());

// 条件成立时才映射
(archived ? ARCHIVE : TableNameMapping.empty()).call(() -> ...);

// 多条语句
try (TableNameMapping.Scope ignored = ARCHIVE.open()) {
    ...
}
```

- 只换映射里列出的实体，其余照旧。
- 显式的 `asTable(..)` 与分表路由优先。
- 作用域跟着当前线程（与事务一样）：终结方法（toList、count、firstOrNull…）要在作用域里执行。
- 嵌套时内层覆盖外层同一实体的映射；离开作用域恢复原样。
- 写入（insertable / updatable / deletable）在作用域里同样换表。
