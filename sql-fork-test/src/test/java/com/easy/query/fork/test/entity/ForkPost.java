package com.easy.query.fork.test.entity;

import com.easy.query.core.annotation.Column;
import com.easy.query.core.annotation.EntityProxy;
import com.easy.query.core.annotation.Table;
import com.easy.query.core.proxy.ProxyEntityAvailable;
import com.easy.query.fork.test.entity.proxy.ForkPostProxy;
import lombok.Data;

import java.math.BigDecimal;

/** fork 用例的帖子表。 */
@Data
@Table("t_fork_post")
@EntityProxy
public class ForkPost implements ProxyEntityAvailable<ForkPost, ForkPostProxy> {
    @Column(primaryKey = true)
    private String id;
    private String userId;
    private String title;
    private BigDecimal amount;
}
