package com.easy.query.hana.func;

import com.easy.query.core.expression.parser.core.available.TableAvailable;
import com.easy.query.core.func.column.ColumnExpression;
import com.easy.query.core.func.def.AbstractExpressionSQLFunction;

import java.util.ArrayList;
import java.util.List;

/**
 * fork：Java 日期格式（{@code yyyy-MM-dd HH:mm:ss}）翻译成 HANA 的 {@code TO_NVARCHAR(值, 'YYYY-MM-DD HH24:MI:SS')}。
 * <p>认得的模式：yyyy、yy、MM、dd、HH、hh、mm、ss、S…（最多 7 位，HANA 的 TIMESTAMP 只到 100ns）、a；
 * 单字母的 M、d、H、m、s（不补零）换成取数后转文字；分隔符 {@code - / : . , 空格} 原样留在格式串里；
 * 其余字符和单引号里的文字拼成字面量。其它模式字母（如 E、z）报错，而不是生成意思不对的格式。
 */
public class HanaDateTimeFormatSQLFunction extends AbstractExpressionSQLFunction {
    private static final String DEFAULT = "TO_NVARCHAR({0},'YYYY-MM-DD HH24:MI:SS.FF6')";
    private static final String SEPARATORS = "-/:., ";

    private final List<ColumnExpression> columnExpressions;
    private final String sqlSegment;

    public HanaDateTimeFormatSQLFunction(List<ColumnExpression> columnExpressions, String javaFormat) {
        this.columnExpressions = columnExpressions;
        this.sqlSegment = javaFormat == null ? DEFAULT : translate(javaFormat);
    }

    @Override
    public String sqlSegment(TableAvailable defaultTable) {
        return sqlSegment;
    }

    @Override
    public int paramMarks() {
        return columnExpressions.size();
    }

    @Override
    protected List<ColumnExpression> getColumnExpressions() {
        return columnExpressions;
    }

    /** 逐段翻译：能进同一个格式串的连在一起，其余拼成 {@code ||} 的各段 */
    static String translate(String format) {
        List<String> parts = new ArrayList<>();
        StringBuilder mask = new StringBuilder();
        StringBuilder literal = new StringBuilder();
        int i = 0;
        while (i < format.length()) {
            char c = format.charAt(i);
            if (c == '\'') {
                int end = format.indexOf('\'', i + 1);
                if (end < 0) {
                    throw new IllegalArgumentException("unterminated quote in date format: " + format);
                }
                flushMask(parts, mask);
                literal.append(end == i + 1 ? "'" : format.substring(i + 1, end));
                i = end + 1;
                continue;
            }
            if (isPatternLetter(c)) {
                int end = i;
                while (end < format.length() && format.charAt(end) == c) end++;
                String token = format.substring(i, end);
                String maskToken = maskToken(token);
                if (maskToken != null) {
                    flushLiteral(parts, literal);
                    mask.append(maskToken);
                } else {
                    flushMask(parts, mask);
                    flushLiteral(parts, literal);
                    parts.add(numberToken(token, format));
                }
                i = end;
                continue;
            }
            if (SEPARATORS.indexOf(c) >= 0 && literal.length() == 0) {
                mask.append(c);
            } else {
                flushMask(parts, mask);
                literal.append(c);
            }
            i++;
        }
        flushMask(parts, mask);
        flushLiteral(parts, literal);
        return parts.size() == 1 ? parts.get(0) : "(" + String.join(" || ", parts) + ")";
    }

    /** 只有 ASCII 字母是模式字母（同 Java 的 DateTimeFormatter），中文等其余字符都是字面量 */
    private static boolean isPatternLetter(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
    }

    private static String maskToken(String token) {
        switch (token) {
            case "yyyy": return "YYYY";
            case "yy": return "YY";
            case "MM": return "MM";
            case "dd": return "DD";
            case "HH": return "HH24";
            case "hh": return "HH12";
            case "mm": return "MI";
            case "ss": return "SS";
            case "a": return "AM";
            default:
                if (token.charAt(0) == 'S' && token.length() <= 7) {
                    return "FF" + token.length();
                }
                return null;
        }
    }

    private static String numberToken(String token, String format) {
        switch (token) {
            case "M": return "TO_NVARCHAR(MONTH({0}))";
            case "d": return "TO_NVARCHAR(DAYOFMONTH({0}))";
            case "H": return "TO_NVARCHAR(HOUR({0}))";
            case "m": return "TO_NVARCHAR(MINUTE({0}))";
            case "s": return "TO_NVARCHAR(CAST(FLOOR(SECOND({0})) AS INTEGER))";
            default: throw new IllegalArgumentException("HANA date format does not support '" + token + "' in " + format);
        }
    }

    private static void flushMask(List<String> parts, StringBuilder mask) {
        if (mask.length() == 0) {
            return;
        }
        // 只有分隔符（如 M/d 中间的 /）时就是字面量，不必经过 TO_NVARCHAR
        boolean onlySeparators = mask.chars().allMatch(c -> SEPARATORS.indexOf(c) >= 0);
        parts.add(onlySeparators ? "'" + mask + "'" : "TO_NVARCHAR({0},'" + mask + "')");
        mask.setLength(0);
    }

    private static void flushLiteral(List<String> parts, StringBuilder literal) {
        if (literal.length() > 0) {
            parts.add("'" + literal.toString().replace("'", "''") + "'");
            literal.setLength(0);
        }
    }
}
