package com.easy.query.fork.test.live;

import com.easy.query.api.proxy.client.DefaultEasyEntityQuery;
import com.easy.query.api.proxy.client.EasyEntityQuery;
import com.easy.query.core.bootstrapper.DatabaseConfiguration;
import com.easy.query.core.bootstrapper.EasyQueryBootstrapper;
import com.easy.query.mysql.config.MySQLDatabaseConfiguration;
import com.easy.query.pgsql.config.PgSQLDatabaseConfiguration;
import com.mysql.cj.jdbc.MysqlDataSource;
import org.postgresql.ds.PGSimpleDataSource;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;

/**
 * 连 infra/dev 的本地实库（-Plive 才跑）。地址可用系统属性覆盖：{@code eq.live.host}（默认 127.0.0.1）。
 * fork 的用例用自己的库 {@code eq_fork}，不碰上游基线用的 {@code easy-query-test}。
 */
public final class LiveDatabases {
    /** 一个实库：名字（出现在用例名里）、方言、数据源。 */
    public static final class Live {
        public final String name;
        public final DataSource dataSource;
        private final DatabaseConfiguration dialect;

        Live(String name, DatabaseConfiguration dialect, DataSource dataSource) {
            this.name = name;
            this.dialect = dialect;
            this.dataSource = dataSource;
        }

        public EasyEntityQuery client() {
            return new DefaultEasyEntityQuery(EasyQueryBootstrapper.defaultBuilderConfiguration()
                .setDefaultDataSource(dataSource)
                .useDatabaseConfigure(dialect)
                .build());
        }

        /** 依次执行 DDL / 准备数据的语句。 */
        public void execute(String... sql) {
            try (Connection c = dataSource.getConnection(); Statement s = c.createStatement()) {
                for (String one : sql) s.execute(one);
            } catch (SQLException e) {
                throw new IllegalStateException(name + ": " + e.getMessage(), e);
            }
        }

        @Override
        public String toString() { return name; }
    }

    private static final String HOST = System.getProperty("eq.live.host", "127.0.0.1");

    private LiveDatabases() { }

    /** MySQL 8.4（3306）。 */
    public static Live mysql84() { return mysql("mysql-8.4", 3306); }

    /** MySQL 8.0.18（3318）：生产 PolarDB 的内核版本。 */
    public static Live mysql8018() { return mysql("mysql-8.0.18", 3318); }

    /** PostgreSQL 17（54321），库 easy-query-test 的 eq_fork schema。 */
    public static Live pg17() {
        PGSimpleDataSource admin = new PGSimpleDataSource();
        admin.setURL("jdbc:postgresql://" + HOST + ":54321/easy-query-test");
        admin.setUser("postgres");
        admin.setPassword("postgres");
        new Live("pg-admin", new PgSQLDatabaseConfiguration(), admin).execute("CREATE SCHEMA IF NOT EXISTS eq_fork");
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setURL("jdbc:postgresql://" + HOST + ":54321/easy-query-test?currentSchema=eq_fork");
        ds.setUser("postgres");
        ds.setPassword("postgres");
        return new Live("pg-17", new PgSQLDatabaseConfiguration(), ds);
    }

    private static Live mysql(String name, int port) {
        MysqlDataSource admin = new MysqlDataSource();
        admin.setURL("jdbc:mysql://" + HOST + ":" + port + "/?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=Asia/Shanghai");
        admin.setUser("root");
        admin.setPassword("root");
        new Live(name, new MySQLDatabaseConfiguration(), admin).execute("CREATE DATABASE IF NOT EXISTS eq_fork");
        MysqlDataSource ds = new MysqlDataSource();
        ds.setURL("jdbc:mysql://" + HOST + ":" + port + "/eq_fork?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=Asia/Shanghai");
        ds.setUser("root");
        ds.setPassword("root");
        return new Live(name, new MySQLDatabaseConfiguration(), ds);
    }
}
