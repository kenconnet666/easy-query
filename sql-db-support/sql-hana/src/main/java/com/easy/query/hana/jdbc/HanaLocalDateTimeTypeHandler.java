package com.easy.query.hana.jdbc;

import com.easy.query.core.basic.jdbc.executor.internal.merge.result.StreamResultSet;
import com.easy.query.core.basic.jdbc.executor.internal.props.JdbcProperty;
import com.easy.query.core.basic.jdbc.types.EasyParameter;
import com.easy.query.core.basic.jdbc.types.handler.JdbcTypeHandler;

import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Calendar;
import java.util.TimeZone;

/**
 * fork：HANA 上的 LocalDateTime。核心的写法经 {@code Timestamp.valueOf} 按 JVM 时区换算，JVM 时区有夏令时时，
 * 跳过的那一小时里的时刻（如柏林的 2026-03-29 02:30）会被挪成 03:30。这里在 UTC 日历下绑定和读取，墙上时间原样进出，与 JVM 时区无关。
 */
public final class HanaLocalDateTimeTypeHandler implements JdbcTypeHandler {
    public static final HanaLocalDateTimeTypeHandler INSTANCE = new HanaLocalDateTimeTypeHandler();

    private static final TimeZone UTC = TimeZone.getTimeZone("UTC");

    private HanaLocalDateTimeTypeHandler() { }

    @Override
    public Object getValue(JdbcProperty jdbcProperty, StreamResultSet streamResultSet) throws SQLException {
        Timestamp timestamp = streamResultSet.getResultSet().getTimestamp(jdbcProperty.getJdbcIndex(), utcCalendar());
        return timestamp == null ? null : LocalDateTime.ofInstant(timestamp.toInstant(), ZoneOffset.UTC);
    }

    @Override
    public void setParameter(EasyParameter parameter) throws SQLException {
        LocalDateTime value = (LocalDateTime) parameter.getValue();
        parameter.getPs().setTimestamp(parameter.getIndex(), Timestamp.from(value.toInstant(ZoneOffset.UTC)), utcCalendar());
    }

    /** Calendar 不是线程安全的，每次新建 */
    private static Calendar utcCalendar() {
        return Calendar.getInstance(UTC);
    }
}
