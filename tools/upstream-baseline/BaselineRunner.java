import org.junit.runner.*;
import org.junit.runner.notification.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/**
 * 逐个类跑上游 sql-test 的 JUnit 4 用例并写成 TSV：每个用例一行 CASE、每个类一行 CLASS；单个类超时就整个 JVM 退出，由 run.sh 换新 JVM 续跑。
 * 参数：类清单文件、结果 TSV（追加）、单类超时秒数。
 */
public class BaselineRunner {
    static String clean(String s) {
        if (s == null) return "";
        s = s.replace('\t', ' ').replace('\r', ' ').replace('\n', ' ');
        return s.length() > 400 ? s.substring(0, 400) : s;
    }
    public static void main(String[] a) throws Exception {
        List<String> classes = Files.readAllLines(Paths.get(a[0]), StandardCharsets.UTF_8);
        final PrintWriter out = new PrintWriter(new OutputStreamWriter(new FileOutputStream(a[1], true), StandardCharsets.UTF_8), true);
        final long timeout = Long.parseLong(a[2]);
        for (final String cn : classes) {
            cn.trim();
            if (cn.trim().isEmpty()) continue;
            final String c = cn.trim();
            final long t0 = System.currentTimeMillis();
            final int[] cnt = new int[4]; // run, fail, ign, 
            ExecutorService ex = Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r); t.setDaemon(true); return t; });
            Future<?> f = ex.submit(() -> {
                try {
                    Class<?> k;
                    try { k = Class.forName(c); } catch (Throwable e) {
                        Throwable root = e; while (root.getCause() != null && root.getCause() != root) root = root.getCause();
                        out.println("CASE\t" + c + "\t<init>\tERROR\t" + e.getClass().getName() + "\t" + clean(e.getMessage()) + " || ROOT " + root.getClass().getName() + ": " + clean(root.getMessage()));
                        out.println("CLASS\t" + c + "\tINITFAIL\t0\t1\t0\t0");
                        return;
                    }
                    JUnitCore core = new JUnitCore();
                    core.addListener(new RunListener() {
                        Set<Description> failed = new HashSet<>();
                        public void testFinished(Description d) {
                            if (!failed.contains(d)) out.println("CASE\t" + c + "\t" + d.getMethodName() + "\tPASS\t\t");
                        }
                        public void testFailure(Failure fl) {
                            failed.add(fl.getDescription());
                            Throwable t = fl.getException();
                            String st = (t instanceof AssertionError) ? "FAIL" : "ERROR";
                            Throwable root = t; while (root.getCause() != null && root.getCause() != root) root = root.getCause();
                            String m = clean(t.getMessage());
                            out.println("CASE\t" + c + "\t" + fl.getDescription().getMethodName() + "\t" + st + "\t" + t.getClass().getName() + "\t" + m + " || ROOT " + root.getClass().getName() + ": " + clean(root.getMessage()));
                        }
                        public void testAssumptionFailure(Failure fl) { failed.add(fl.getDescription()); out.println("CASE\t" + c + "\t" + fl.getDescription().getMethodName() + "\tSKIP\t\tassumption"); }
                        public void testIgnored(Description d) { out.println("CASE\t" + c + "\t" + d.getMethodName() + "\tIGNORED\t\t"); }
                    });
                    Result r = core.run(k);
                    out.println("CLASS\t" + c + "\tDONE\t" + r.getRunCount() + "\t" + r.getFailureCount() + "\t" + r.getIgnoreCount() + "\t" + (System.currentTimeMillis() - t0));
                } catch (Throwable e) {
                    out.println("CLASS\t" + c + "\tCRASH\t0\t0\t0\t" + clean(e.toString()));
                }
            });
            try { f.get(timeout, TimeUnit.SECONDS); }
            catch (TimeoutException e) {
                out.println("CLASS\t" + c + "\tTIMEOUT\t0\t0\t0\t" + (System.currentTimeMillis() - t0));
                out.flush();
                Runtime.getRuntime().halt(3);
            }
        }
        out.flush();
        System.exit(0);
    }
}
