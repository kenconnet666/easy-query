package com.easy.query.fork.test.upstream;

import com.easy.query.test.ForUpdateDialectToSQLSmokeTest;
import com.easy.query.test.GeneralFunctionsTest;
import com.easy.query.test.GenericTest2;
import com.easy.query.test.InjectTest;
import com.easy.query.test.NumberFunctionsTest;
import com.easy.query.test.SkipTest;
import com.easy.query.test.StringFunctionsTest;
import com.easy.query.test.h2.BasicTypeTest;
import com.easy.query.test.h2.H2DocTest;
import com.easy.query.test.h2.H2ForUpdateTest;
import com.easy.query.test.h2.H2OrderTest;
import com.easy.query.test.h2.H2QueryRelationTest;
import com.easy.query.test.h2.TreeCTETest;
import org.junit.runner.RunWith;
import org.junit.runners.Suite;

/**
 * 上游 sql-test 里不需要任何外部库就能跑、且在 3.3.1 基线上全部通过的用例（2026-10-27 用禁网的 runner 核实）。
 * fork 的改动不能让它们变红；上游的测试仍放在 sql-test/src/main/java，这里只是把它们接进 Maven 的测试阶段。
 * <p>没收进来的：H2QueryTest（testDDL、testDDL2 两个空白差异的断言在基线上就失败）、duckdb 包（在工作目录写文件、要 xlsx），
 * 以及要 MySQL / PG / Redis 等外部库的（本地用 infra/dev 跑，见 docs/fork/baseline.md）。
 */
@RunWith(Suite.class)
@Suite.SuiteClasses({
    ForUpdateDialectToSQLSmokeTest.class,
    GeneralFunctionsTest.class,
    GenericTest2.class,
    InjectTest.class,
    NumberFunctionsTest.class,
    SkipTest.class,
    StringFunctionsTest.class,
    BasicTypeTest.class,
    H2DocTest.class,
    H2ForUpdateTest.class,
    H2OrderTest.class,
    H2QueryRelationTest.class,
    TreeCTETest.class,
})
public class UpstreamNoDatabaseSuite {
}
