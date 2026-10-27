package com.easy.query.fork.test.entity;

import com.easy.query.core.annotation.Column;
import com.easy.query.core.annotation.EntityProxy;
import com.easy.query.core.annotation.Table;
import com.easy.query.core.proxy.ProxyEntityAvailable;
import com.easy.query.fork.test.entity.proxy.ForkAutoIdProxy;
import lombok.Data;

import java.time.LocalDateTime;

/** fork 用例：数据库生成的自增主键（生成键回填）与时间列。 */
@Data
@Table("t_fork_auto")
@EntityProxy
public class ForkAutoId implements ProxyEntityAvailable<ForkAutoId, ForkAutoIdProxy> {
    @Column(primaryKey = true, generatedKey = true)
    private Long id;
    private String name;
    private LocalDateTime at;
}
