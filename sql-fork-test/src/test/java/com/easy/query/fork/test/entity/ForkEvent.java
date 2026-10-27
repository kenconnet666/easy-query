package com.easy.query.fork.test.entity;

import com.easy.query.core.annotation.Column;
import com.easy.query.core.annotation.EntityProxy;
import com.easy.query.core.annotation.Table;
import com.easy.query.core.proxy.ProxyEntityAvailable;
import com.easy.query.fork.test.entity.proxy.ForkEventProxy;
import lombok.Data;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;

/** fork 用例：带时区的时刻类型的列（M1.4）。 */
@Data
@Table("t_fork_event")
@EntityProxy
public class ForkEvent implements ProxyEntityAvailable<ForkEvent, ForkEventProxy> {
    @Column(primaryKey = true)
    private String id;
    private String kind;
    private Instant createdAt;
    private Instant completedAt;
    private OffsetDateTime dueAt;
    private ZonedDateTime seenAt;
}
