package com.easy.query.hana.func;

import com.easy.query.core.enums.SQLLikeEnum;
import com.easy.query.core.expression.lambda.SQLActionExpression1;
import com.easy.query.core.expression.parser.core.SQLTableOwner;
import com.easy.query.core.func.SQLFuncImpl;
import com.easy.query.core.func.SQLFunction;
import com.easy.query.core.func.column.ColumnExpression;
import com.easy.query.core.func.column.ColumnFuncSelector;
import com.easy.query.core.func.def.enums.DateTruncEnum;
import com.easy.query.core.func.column.impl.ColumnFuncValueExpressionImpl;
import com.easy.query.core.func.def.AnySQLFunction;
import com.easy.query.core.func.def.enums.DateTimeDurationEnum;
import com.easy.query.core.func.def.enums.DateTimeUnitEnum;
import com.easy.query.core.func.def.enums.MathMethodEnum;
import com.easy.query.core.func.def.enums.TimeUnitEnum;
import com.easy.query.core.func.def.impl.SubStringSQLFunction;
import com.easy.query.core.expression.parser.core.available.TableAvailable;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * fork：HANA 的函数。只覆盖与核心默认（MySQL 写法）不同的：
 * <ul>
 *   <li>拼接用 {@code ||}（HANA 的 CONCAT 只接受两个参数），LIKE 的模式也用 {@code ||} 拼；</li>
 *   <li>{@code LOCATE(文字, 子串)} 参数顺序与 MySQL 相反；子串用 SUBSTRING；长度用 LENGTH（按 UTF-16 单元计，与 MySQL 的
 *       CHAR_LENGTH 只在 emoji 等补充字符上不同）；</li>
 *   <li>字符串聚合用 STRING_AGG（不支持 distinct，要去重先在子查询里去）；多列极值用 GREATEST / LEAST，先用 COALESCE 补掉 NULL；</li>
 *   <li>SELECT 里不能直接放谓词，布尔表达式包成 CASE；</li>
 *   <li>日期加减用 ADD_DAYS / ADD_MONTHS / ADD_YEARS / ADD_SECONDS / ADD_NANO100，间隔用 NANO100_BETWEEN（TIMESTAMP 精度 100ns）；</li>
 *   <li>格式化用 TO_NVARCHAR 的格式串（见 {@link HanaDateTimeFormatSQLFunction}）；JSON 用 JSON_VALUE / JSON_QUERY。</li>
 * </ul>
 */
public class HanaSQLFuncImpl extends SQLFuncImpl {
    @Override
    public SQLFunction concat(List<ColumnExpression> concatExpressions) {
        if (concatExpressions.isEmpty()) {
            throw new IllegalArgumentException("concat requires at least one argument");
        }
        return new AnySQLFunction("(" + placeholders(0, concatExpressions.size(), " || ") + ")", concatExpressions);
    }

    @Override
    public SQLFunction nullOrDefault(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        List<ColumnExpression> expressions = getColumnExpressions(sqlExpression);
        return new AnySQLFunction("COALESCE(" + placeholders(0, expressions.size(), ",") + ")", expressions);
    }

    @Override
    public SQLFunction indexOf(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        return anySQLFunction("(LOCATE({0},{1}) - 1)", sqlExpression);
    }

    @Override
    public SQLFunction length(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        return anySQLFunction("LENGTH({0})", sqlExpression);
    }

    @Override
    public SQLFunction subString(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        // 起始位置的 +1 由核心的 SubStringSQLFunction 处理，只换函数名
        return new SubStringSQLFunction(getColumnExpressions(sqlExpression)) {
            @Override
            public String sqlSegment(TableAvailable defaultTable) {
                return "SUBSTRING({0},{1},{2})";
            }
        };
    }

    @Override
    public SQLFunction like(SQLActionExpression1<ColumnFuncSelector> sqlExpression, boolean like, SQLLikeEnum sqlLike) {
        HanaLikeSQLFunction likeSQLFunction = new HanaLikeSQLFunction(getColumnExpressions(sqlExpression), sqlLike);
        if (!like) {
            return not(x -> x.sqlFunc(likeSQLFunction));
        }
        return likeSQLFunction;
    }

    @Override
    public SQLFunction joining(SQLActionExpression1<ColumnFuncSelector> sqlExpression, boolean distinct) {
        if (distinct) {
            throw new UnsupportedOperationException("HANA STRING_AGG has no DISTINCT; remove duplicates in a sub query before joining");
        }
        List<ColumnExpression> expressions = getColumnExpressions(sqlExpression);
        String ordering = expressions.size() > 2 ? " ORDER BY {2}" : "";
        return new AnySQLFunction("STRING_AGG({1},{0}" + ordering + ")", expressions);
    }

    @Override
    public SQLFunction maxColumns(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        return extremeColumns(getColumnExpressions(sqlExpression), "GREATEST");
    }

    @Override
    public SQLFunction minColumns(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        return extremeColumns(getColumnExpressions(sqlExpression), "LEAST");
    }

    /** GREATEST / LEAST 遇到 NULL 结果就是 NULL：每一项先换成第一个非空值，全为空时仍是 NULL */
    private static SQLFunction extremeColumns(List<ColumnExpression> expressions, String function) {
        if (expressions.size() == 1) {
            return new AnySQLFunction("{0}", expressions);
        }
        String firstNonNull = "COALESCE(" + placeholders(0, expressions.size(), ",") + ")";
        List<String> values = new ArrayList<>();
        for (int i = 0; i < expressions.size(); i++) {
            values.add("COALESCE({" + i + "}," + firstNonNull + ")");
        }
        return new AnySQLFunction(function + "(" + String.join(",", values) + ")", expressions);
    }

    @Override
    public SQLFunction booleanSQLFunction(String sqlSegment, SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        SQLFunction predicate = anySQLFunction(sqlSegment, sqlExpression);
        // 第二个 WHEN 保留 UNKNOWN：谓词为 NULL 时结果是 NULL，而不是 FALSE
        return anySQLFunction("(CASE WHEN {0} THEN TRUE WHEN NOT ({0}) THEN FALSE ELSE NULL END)", x -> x.sqlFunc(predicate));
    }

    @Override
    public SQLFunction now() {
        return anySQLFunction("CURRENT_TIMESTAMP", x -> { });
    }

    @Override
    public SQLFunction utcNow() {
        return anySQLFunction("CURRENT_UTCTIMESTAMP", x -> { });
    }

    @Override
    public SQLFunction math(SQLActionExpression1<ColumnFuncSelector> sqlExpression, MathMethodEnum mathMethodEnum) {
        switch (mathMethodEnum) {
            case Log:
                return anySQLFunction("LN({0})", sqlExpression);
            case Log10:
                return anySQLFunction("LOG(10,{0})", sqlExpression);
            case Pow:
                return anySQLFunction("POWER({0},{1})", sqlExpression);
            case Ceiling:
                return anySQLFunction("CEIL({0})", sqlExpression);
            case Truncate:
                // 向零截断；HANA 没有 TRUNCATE 函数，FLOOR 对负数结果不同
                return anySQLFunction("ROUND({0},0,ROUND_DOWN)", sqlExpression);
            default:
                return super.math(sqlExpression, mathMethodEnum);
        }
    }

    @Override
    public SQLFunction plusDateTime(SQLActionExpression1<ColumnFuncSelector> sqlExpression, long duration, TimeUnit timeUnit) {
        List<ColumnExpression> expressions = new ArrayList<>(getColumnExpressions(sqlExpression));
        // 统一换成 100 纳秒（HANA TIMESTAMP 的精度）
        expressions.add(new ColumnFuncValueExpressionImpl(Math.multiplyExact(timeUnit.toMicros(duration), 10L)));
        return new AnySQLFunction("ADD_NANO100({0},{1})", expressions);
    }

    @Override
    public SQLFunction plusDateTime2(SQLActionExpression1<ColumnFuncSelector> sqlExpression, TimeUnitEnum timeUnit) {
        return anySQLFunction(plusTemplate(timeUnit), sqlExpression);
    }

    @Override
    public SQLFunction plusDateTimeMonths(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        return anySQLFunction(plusTemplate(TimeUnitEnum.MONTHS), sqlExpression);
    }

    @Override
    public SQLFunction plusDateTimeYears(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        return anySQLFunction(plusTemplate(TimeUnitEnum.YEARS), sqlExpression);
    }

    private static String plusTemplate(TimeUnitEnum timeUnit) {
        switch (timeUnit) {
            case MILLISECONDS: return "ADD_NANO100({0},({1}) * 10000)";
            case SECONDS: return "ADD_SECONDS({0},{1})";
            case MINUTES: return "ADD_SECONDS({0},({1}) * 60)";
            case HOURS: return "ADD_SECONDS({0},({1}) * 3600)";
            case DAYS: return "ADD_DAYS({0},{1})";
            case MONTHS: return "ADD_MONTHS({0},{1})";
            case YEARS: return "ADD_YEARS({0},{1})";
            default: throw new UnsupportedOperationException("HANA plusDateTime does not support " + timeUnit);
        }
    }

    @Override
    public SQLFunction dateTimeProperty(SQLActionExpression1<ColumnFuncSelector> sqlExpression, DateTimeUnitEnum dateTimeUnitEnum) {
        switch (dateTimeUnitEnum) {
            case Year: return anySQLFunction("YEAR({0})", sqlExpression);
            case Month: return anySQLFunction("MONTH({0})", sqlExpression);
            case Day: return anySQLFunction("DAYOFMONTH({0})", sqlExpression);
            case Hour: return anySQLFunction("HOUR({0})", sqlExpression);
            case Minute: return anySQLFunction("MINUTE({0})", sqlExpression);
            // HANA 的 SECOND 带小数秒
            case Second: return anySQLFunction("FLOOR(SECOND({0}))", sqlExpression);
            case DayOfYear: return anySQLFunction("DAYOFYEAR({0})", sqlExpression);
            // WEEKDAY：周一 0 … 周日 6；DayOfWeek 约定周日 0 … 周六 6
            case DayOfWeek: return anySQLFunction("MOD(WEEKDAY({0}) + 1,7)", sqlExpression);
            case DayOfWeekSunDayLastDay: return anySQLFunction("(WEEKDAY({0}) + 1)", sqlExpression);
            default: throw new UnsupportedOperationException("HANA dateTimeProperty does not support " + dateTimeUnitEnum);
        }
    }

    @Override
    public SQLFunction duration(SQLActionExpression1<ColumnFuncSelector> sqlExpression, DateTimeDurationEnum durationEnum) {
        // 与核心的 timestampdiff(unit, {1}, {0}) 同向：{0} - {1}
        return anySQLFunction(durationTemplate("NANO100_BETWEEN({1},{0})", durationEnum), sqlExpression);
    }

    @Override
    public SQLFunction duration2(SQLActionExpression1<ColumnFuncSelector> sqlExpression, DateTimeDurationEnum durationEnum) {
        return anySQLFunction(durationTemplate("NANO100_BETWEEN({0},{1})", durationEnum), sqlExpression);
    }

    /** 整单位向零截断，与 MySQL 的 TIMESTAMPDIFF 一致 */
    private static String durationTemplate(String nano100, DateTimeDurationEnum durationEnum) {
        long ticks;
        switch (durationEnum) {
            case Days: ticks = 864_000_000_000L; break;
            case Hours: ticks = 36_000_000_000L; break;
            case Minutes: ticks = 600_000_000L; break;
            case Seconds: ticks = 10_000_000L; break;
            default: throw new UnsupportedOperationException("HANA duration does not support " + durationEnum);
        }
        return "CAST(ROUND(" + nano100 + " / " + ticks + ",0,ROUND_DOWN) AS BIGINT)";
    }

    @Override
    public SQLFunction dateTimeFormat(SQLActionExpression1<ColumnFuncSelector> sqlExpression, String javaFormat) {
        return new HanaDateTimeFormatSQLFunction(getColumnExpressions(sqlExpression), javaFormat);
    }

    @Override
    public SQLFunction dateTimeSQLFormat(SQLTableOwner tableOwner, String property, String format) {
        return anySQLFunction("TO_NVARCHAR({0},{1})", x -> x.column(getTable(tableOwner), property).value(format));
    }

    @Override
    public SQLFunction cast(SQLActionExpression1<ColumnFuncSelector> sqlExpression, Class<?> targetClazz) {
        return anySQLFunction(castTemplate(targetClazz), sqlExpression);
    }

    private static String castTemplate(Class<?> target) {
        switch (target.getName()) {
            case "boolean":
            case "java.lang.Boolean": return "CAST({0} AS BOOLEAN)";
            // HANA 的 TINYINT 是无符号的，装不下 Java byte 的负数
            case "byte":
            case "java.lang.Byte":
            case "short":
            case "java.lang.Short": return "CAST({0} AS SMALLINT)";
            case "int":
            case "java.lang.Integer": return "CAST({0} AS INTEGER)";
            case "long":
            case "java.lang.Long": return "CAST({0} AS BIGINT)";
            case "float":
            case "java.lang.Float": return "CAST({0} AS REAL)";
            case "double":
            case "java.lang.Double": return "CAST({0} AS DOUBLE)";
            case "java.math.BigDecimal": return "CAST({0} AS DECIMAL(36,18))";
            case "java.sql.Date":
            case "java.time.LocalDate": return "CAST({0} AS DATE)";
            case "java.sql.Time":
            case "java.time.LocalTime": return "CAST({0} AS TIME)";
            case "java.sql.Timestamp":
            case "java.util.Date":
            case "java.time.LocalDateTime": return "CAST({0} AS TIMESTAMP)";
            case "char":
            case "java.lang.Character": return "SUBSTRING(TO_NVARCHAR({0}),1,1)";
            // 不写 NVARCHAR(n)：显式长度会把 NCLOB 静默截短
            case "java.lang.String": return "TO_NVARCHAR({0})";
            case "java.util.UUID": return "LOWER(TO_NVARCHAR({0}))";
            default: throw new UnsupportedOperationException("HANA cast does not support " + target.getName());
        }
    }

    @Override
    public SQLFunction jsonObjectField(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        return jsonPath("JSON_VALUE", getColumnExpressions(sqlExpression), false);
    }

    @Override
    public SQLFunction jsonObjectExtract(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        return jsonPath("JSON_QUERY", getColumnExpressions(sqlExpression), false);
    }

    @Override
    public SQLFunction jsonObjectContainsKey(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        // JSON_QUERY 取不到时为 NULL；WITH CONDITIONAL WRAPPER 让标量值也能取到
        SQLFunction query = jsonPath("JSON_QUERY", getColumnExpressions(sqlExpression), false, " WITH CONDITIONAL WRAPPER");
        return anySQLFunction("({0} IS NOT NULL)", x -> x.sqlFunc(query));
    }

    @Override
    public SQLFunction jsonArrayByIndex(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        return jsonPath("JSON_VALUE", getColumnExpressions(sqlExpression), true);
    }

    @Override
    public SQLFunction jsonArrayExtractByIndex(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        return jsonPath("JSON_QUERY", getColumnExpressions(sqlExpression), true);
    }

    @Override
    public SQLFunction jsonArrayLength(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        throw new UnsupportedOperationException("HANA has no JSON array length function");
    }

    private static SQLFunction jsonPath(String function, List<ColumnExpression> expressions, boolean index) {
        return jsonPath(function, expressions, index, "");
    }

    /**
     * HANA 的 JSON 路径必须是字面量：键、下标由核心以 format 的方式内联（与 Oracle 方言相同），
     * 写成 {@code '$.a.b'} 或 {@code '$[0]'}。
     */
    private static SQLFunction jsonPath(String function, List<ColumnExpression> expressions, boolean index, String suffix) {
        if (expressions.size() < 2) {
            throw new IllegalArgumentException(function + " requires a document and a path");
        }
        String path = index ? "'$[{1}]'" : "'$." + placeholders(1, expressions.size(), ".") + "'";
        return new AnySQLFunction(function + "({0}," + path + suffix + ")", expressions);
    }

    /** {from},{from+1},… 用 separator 连起来 */
    private static String placeholders(int from, int to, String separator) {
        StringBuilder sb = new StringBuilder();
        for (int i = from; i < to; i++) {
            if (i > from) sb.append(separator);
            sb.append('{').append(i).append('}');
        }
        return sb.toString();
    }
    /**
     * fork：HANA 2.0 没有 DATE_TRUNC，用 TO_VARCHAR 保留到该粒度、补零后 TO_SECONDDATE；季度、周再用 ADD_MONTHS / ADD_DAYS 回退（WEEKDAY 周一为 0）
     */
    @Override
    public SQLFunction dateTrunc(SQLActionExpression1<ColumnFuncSelector> sqlExpression, DateTruncEnum unit) {
        switch (unit) {
            case YEAR: return anySQLFunction("TO_SECONDDATE(TO_VARCHAR({0},'YYYY') || '-01-01 00:00:00','YYYY-MM-DD HH24:MI:SS')", sqlExpression);
            case QUARTER: return anySQLFunction("ADD_MONTHS(TO_SECONDDATE(TO_VARCHAR({0},'YYYY-MM') || '-01 00:00:00','YYYY-MM-DD HH24:MI:SS'), -MOD(MONTH({1}) - 1, 3))", twice(sqlExpression));
            case MONTH: return anySQLFunction("TO_SECONDDATE(TO_VARCHAR({0},'YYYY-MM') || '-01 00:00:00','YYYY-MM-DD HH24:MI:SS')", sqlExpression);
            case WEEK: return anySQLFunction("ADD_DAYS(TO_SECONDDATE(TO_VARCHAR({0},'YYYY-MM-DD'),'YYYY-MM-DD'), -WEEKDAY({1}))", twice(sqlExpression));
            case DAY: return anySQLFunction("TO_SECONDDATE(TO_VARCHAR({0},'YYYY-MM-DD'),'YYYY-MM-DD')", sqlExpression);
            case HOUR: return anySQLFunction("TO_SECONDDATE(TO_VARCHAR({0},'YYYY-MM-DD HH24') || ':00:00','YYYY-MM-DD HH24:MI:SS')", sqlExpression);
            case MINUTE: return anySQLFunction("TO_SECONDDATE(TO_VARCHAR({0},'YYYY-MM-DD HH24:MI') || ':00','YYYY-MM-DD HH24:MI:SS')", sqlExpression);
            case SECOND: return anySQLFunction("TO_SECONDDATE(TO_VARCHAR({0},'YYYY-MM-DD HH24:MI:SS'),'YYYY-MM-DD HH24:MI:SS')", sqlExpression);
            default: throw new UnsupportedOperationException("HANA dateTrunc does not support " + unit);
        }
    }

    /** 模板里同一个参数要出现两次时选两次（占位符不能重复，参数按选择的顺序绑定） */
    private static SQLActionExpression1<ColumnFuncSelector> twice(SQLActionExpression1<ColumnFuncSelector> sqlExpression) {
        return s -> {
            sqlExpression.apply(s);
            sqlExpression.apply(s);
        };
    }
}
