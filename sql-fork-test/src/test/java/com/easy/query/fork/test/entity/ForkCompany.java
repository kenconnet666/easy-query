package com.easy.query.fork.test.entity;

import com.easy.query.core.annotation.Column;
import com.easy.query.core.annotation.EntityProxy;
import com.easy.query.core.annotation.Table;
import com.easy.query.core.proxy.ProxyEntityAvailable;
import com.easy.query.fork.test.entity.proxy.ForkCompanyProxy;
import lombok.Data;

/** fork 用例的公司表。 */
@Data
@Table("t_fork_company")
@EntityProxy
public class ForkCompany implements ProxyEntityAvailable<ForkCompany, ForkCompanyProxy> {
    @Column(primaryKey = true)
    private String id;
    private String name;
}
