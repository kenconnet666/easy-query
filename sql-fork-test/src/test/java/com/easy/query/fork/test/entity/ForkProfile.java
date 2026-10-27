package com.easy.query.fork.test.entity;

import com.easy.query.core.annotation.Column;
import com.easy.query.core.annotation.EntityProxy;
import com.easy.query.core.annotation.Table;
import com.easy.query.core.basic.extension.conversion.json.JsonValueConverter;
import com.easy.query.core.proxy.ProxyEntityAvailable;
import com.easy.query.fork.test.entity.proxy.ForkProfileProxy;
import lombok.Data;

import java.util.List;
import java.util.Map;

/** fork 用例：JSON 列（M3.3），泛型属性按声明类型解码。 */
@Data
@Table("t_fork_profile")
@EntityProxy
public class ForkProfile implements ProxyEntityAvailable<ForkProfile, ForkProfileProxy> {
    @Column(primaryKey = true)
    private String id;
    @Column(conversion = JsonValueConverter.class)
    private List<Address> addresses;
    @Column(conversion = JsonValueConverter.class)
    private Map<String, Object> extra;

    @Data
    public static class Address {
        private String city;
        private Integer zip;
    }
}
