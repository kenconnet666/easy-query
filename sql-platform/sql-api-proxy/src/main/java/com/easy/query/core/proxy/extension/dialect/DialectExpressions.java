package com.easy.query.core.proxy.extension.dialect;

import com.easy.query.core.context.QueryRuntimeContext;
import com.easy.query.core.expression.parser.core.available.TableAvailable;
import com.easy.query.core.func.SQLFunc;
import com.easy.query.core.func.SQLFunction;
import com.easy.query.core.func.column.ColumnFuncSelector;
import com.easy.query.core.proxy.PropTypeColumn;
import com.easy.query.core.proxy.core.EntitySQLContext;
import com.easy.query.core.proxy.extension.functions.type.AnyTypeExpression;
import com.easy.query.core.proxy.extension.functions.type.BooleanTypeExpression;
import com.easy.query.core.proxy.extension.functions.type.NumberTypeExpression;
import com.easy.query.core.proxy.extension.functions.type.StringTypeExpression;
import com.easy.query.core.proxy.extension.functions.type.impl.AnyTypeExpressionImpl;
import com.easy.query.core.proxy.extension.functions.type.impl.BooleanTypeExpressionImpl;
import com.easy.query.core.proxy.extension.functions.type.impl.NumberTypeExpressionImpl;
import com.easy.query.core.proxy.extension.functions.type.impl.StringTypeExpressionImpl;

import java.util.function.Function;

/**
 * 写方言专属函数用的工具：内置的方言入口（如 {@code MySQL.json(u.attrs())}）和用户自己写的扩展都用它，两者没有差别。
 * <p>约定：
 * <ul>
 *   <li>入口按列包装：第一个参数是列（或别的列函数），由它确定所在的表和查询上下文，所以普通 where、隐式子查询
 *       （{@code u.posts().any(p -> ...)}）、select、orderBy 里都能用；</li>
 *   <li>方言模块在自己的 {@code DatabaseConfiguration} 里注册一个标记类，入口构造表达式时用 {@link #require} 检查，
 *       用在别的方言上立刻报错（而不是生成对方不认识的 SQL）；兼容的方言注册同一个标记即可共用；</li>
 *   <li>SQL 模板里用 {@code {0}}、{@code {1}}… 引用参数：参数可以是列、列函数或普通值（普通值写成 {@code ?} 参数）。</li>
 * </ul>
 * <pre>{@code
 * // 用户自己的方言函数：SOUNDEX(col) = SOUNDEX(?)
 * public static void soundsLike(PropTypeColumn<String> column, String word) {
 *     DialectExpressions.predicate(column, "SOUNDEX({0}) = SOUNDEX({1})", column, word);
 * }
 * }</pre>
 */
public final class DialectExpressions {
    private DialectExpressions() { }

    /**
     * 检查当前查询所用的方言注册了 marker；没有时抛 {@link UnsupportedOperationException}，消息里写明函数名与当前方言。
     *
     * @param anchor   函数作用的列，用来取运行时上下文
     * @param marker   方言在 DatabaseConfiguration 里注册的标记类
     * @param function 报错时显示的函数名，如 {@code "MySQL.json"}
     */
    public static void require(PropTypeColumn<?> anchor, Class<?> marker, String function) {
        require(anchor.getEntitySQLContext().getRuntimeContext(), marker, function);
    }

    /** 同上，用于不经过列的方言能力（如 {@code PgSQL.returning(deletable)}） */
    public static void require(QueryRuntimeContext runtime, Class<?> marker, String function) {
        try {
            runtime.getService(marker);
        } catch (IllegalArgumentException notRegistered) {
            throw new UnsupportedOperationException(function + " is not supported by the current dialect ("
                + runtime.getQueryConfiguration().getDialect().getClass().getSimpleName() + ")", notRegistered);
        }
    }

    /** 作为条件加到当前的 where / having / on 里（与 {@code u.name().eq(..)} 一样是语句，受 or / and 分组约束）。 */
    public static void predicate(PropTypeColumn<?> anchor, String template, Object... args) {
        bool(anchor, template, args).executeSQL();
    }

    /** 结果是布尔值的表达式（select 里取值，或接着 {@code .eq(true)} 之类比较）。 */
    public static BooleanTypeExpression<Boolean> bool(PropTypeColumn<?> anchor, String template, Object... args) {
        return new BooleanTypeExpressionImpl<>(context(anchor), table(anchor), null, function(template, args), Boolean.class);
    }

    /**
     * 结果与 anchor 同类型的表达式，例如改写后的 JSON 列：可以直接 {@code u.attrs().set(..)} 写回这一列，类型化的 JSON 属性也适用。
     */
    public static <T> AnyTypeExpression<T> sameType(PropTypeColumn<T> anchor, String template, Object... args) {
        return new AnyTypeExpressionImpl<>(context(anchor), table(anchor), null, function(template, args), anchor.getPropertyType());
    }

    /** 结果是文字的表达式，可以继续链式调用字符串函数与比较。 */
    public static StringTypeExpression<String> string(PropTypeColumn<?> anchor, String template, Object... args) {
        return new StringTypeExpressionImpl<>(context(anchor), table(anchor), null, function(template, args), String.class);
    }

    /** 结果是数的表达式，type 是 select 到 Java 时的类型。 */
    public static <T extends Number> NumberTypeExpression<T> number(PropTypeColumn<?> anchor, Class<T> type, String template, Object... args) {
        return new NumberTypeExpressionImpl<>(context(anchor), table(anchor), null, function(template, args), type);
    }

    /** 模板 + 参数 → SQL 函数；参数经 {@link PropTypeColumn#acceptAnyValue} 处理：列、列函数原样引用，其余写成参数。 */
    private static Function<SQLFunc, SQLFunction> function(String template, Object[] args) {
        return fx -> fx.anySQLFunction(template, selector -> accept(selector, args));
    }

    private static void accept(ColumnFuncSelector selector, Object[] args) {
        for (Object arg : args) {
            PropTypeColumn.acceptAnyValue(selector, arg);
        }
    }

    private static EntitySQLContext context(PropTypeColumn<?> anchor) {
        return anchor.getEntitySQLContext();
    }

    private static TableAvailable table(PropTypeColumn<?> anchor) {
        return anchor.getTable();
    }
}
