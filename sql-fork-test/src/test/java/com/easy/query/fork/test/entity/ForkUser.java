package com.easy.query.fork.test.entity;

import com.easy.query.core.annotation.Column;
import com.easy.query.core.annotation.EntityProxy;
import com.easy.query.core.annotation.Navigate;
import com.easy.query.core.annotation.Table;
import com.easy.query.core.enums.RelationTypeEnum;
import com.easy.query.core.proxy.ProxyEntityAvailable;
import com.easy.query.fork.test.entity.proxy.ForkUserProxy;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/** fork 用例的用户表：多对一到公司、一对多到帖子，attrs 是 JSON 文字列。 */
@Data
@Table("t_fork_user")
@EntityProxy
public class ForkUser implements ProxyEntityAvailable<ForkUser, ForkUserProxy> {
    @Column(primaryKey = true)
    private String id;
    private String name;
    private Integer age;
    private String companyId;
    private String attrs;
    private LocalDateTime createdAt;

    @Navigate(value = RelationTypeEnum.ManyToOne, selfProperty = "companyId", targetProperty = "id")
    private ForkCompany company;

    @Navigate(value = RelationTypeEnum.OneToMany, targetProperty = "userId")
    private List<ForkPost> posts;
}
