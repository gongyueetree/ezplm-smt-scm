/**
 * REF-0.8:对拍框架自身的单测。
 *
 * 这套框架将来要给 REF-1..REF-4 当门禁用 —— 它自己必须先可信:
 * 新实现绝不影响生产、旧实现故障不被吞、默认脱敏、截断显式、结果确定。
 */
import { describe, expect, it } from "vitest";
import {
  describeValue,
  diffValues,
  shadowRun,
  summarizeShadowRuns,
  type ShadowOutcome,
} from "@/lib/domain/shadow-compare";

describe("diffValues", () => {
  it("完全一致 → 零差异", () => {
    const a = { mpn: "STM32", lines: [{ qty: 1 }, { qty: 2 }] };
    const b = { mpn: "STM32", lines: [{ qty: 1 }, { qty: 2 }] };
    expect(diffValues(a, b).total).toBe(0);
  });

  it("值不同 → CHANGED,路径精确到叶子", () => {
    const r = diffValues({ lines: [{ qty: 1 }] }, { lines: [{ qty: 2 }] });
    expect(r.diffs).toHaveLength(1);
    expect(r.diffs[0].path).toBe("lines[0].qty");
    expect(r.diffs[0].kind).toBe("CHANGED");
  });

  it("新增/缺失字段分别是 EXTRA_IN_NEXT / MISSING_IN_NEXT", () => {
    const r = diffValues({ a: 1 }, { b: 2 });
    const kinds = Object.fromEntries(r.diffs.map((d) => [d.path, d.kind]));
    expect(kinds.a).toBe("MISSING_IN_NEXT");
    expect(kinds.b).toBe("EXTRA_IN_NEXT");
  });

  it("类型变了单独标 TYPE_CHANGED —— '100' 与 100 不是同一回事", () => {
    const r = diffValues({ qty: "100" }, { qty: 100 });
    expect(r.diffs[0].kind).toBe("TYPE_CHANGED");
  });

  it("数组长度不同时逐位比,不是整体判不等", () => {
    const r = diffValues({ l: [1, 2] }, { l: [1, 2, 3] });
    expect(r.diffs).toHaveLength(1);
    expect(r.diffs[0].path).toBe("l[2]");
    expect(r.diffs[0].kind).toBe("EXTRA_IN_NEXT");
  });

  it("Date 按 ISO 比较,实例不同但时刻相同 → 不算差异", () => {
    const t = "2026-09-18T00:00:00.000Z";
    expect(diffValues({ at: new Date(t) }, { at: new Date(t) }).total).toBe(0);
  });

  it("**默认脱敏**:diff 里只有类型/长度,不含值内容", () => {
    const r = diffValues({ mpn: "SECRET-MPN-001" }, { mpn: "SECRET-MPN-002" });
    expect(r.diffs[0].old).toBe("string(14)");
    expect(r.diffs[0].next).toBe("string(14)");
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });

  it("显式 redact:false 才输出值(仅限本地排查)", () => {
    const r = diffValues({ mpn: "A" }, { mpn: "B" }, { redact: false });
    expect(r.diffs[0].old).toBe("A");
    expect(r.diffs[0].next).toBe("B");
  });

  it("截断必须显式上报 total 与 truncated —— 不能让人以为只有这么点差异", () => {
    const old = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]));
    const next = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i + 1]));
    const r = diffValues(old, next, { maxDiffs: 10 });
    expect(r.diffs).toHaveLength(10);
    expect(r.total).toBe(50);
    expect(r.truncated).toBe(true);
  });

  it("结果确定:键序不同的等价对象给出完全一致的报告", () => {
    const r1 = diffValues({ a: 1, b: 2 }, { b: 2, a: 9 });
    const r2 = diffValues({ b: 2, a: 1 }, { a: 9, b: 2 });
    expect(r1).toEqual(r2);
    expect(r1.diffs.map((d) => d.path)).toEqual(["a"]);
  });

  it("null 与 undefined 不混为一谈", () => {
    expect(diffValues({ x: null }, { x: undefined }).total).toBe(1);
    expect(diffValues({ x: null }, { x: null }).total).toBe(0);
  });
});

describe("describeValue 脱敏摘要", () => {
  it("只暴露类型与规模", () => {
    expect(describeValue("abcd")).toBe("string(4)");
    expect(describeValue(3)).toBe("int");
    expect(describeValue(3.5)).toBe("float");
    expect(describeValue([1, 2, 3])).toBe("array(3)");
    expect(describeValue({ a: 1, b: 2 })).toBe("object(2)");
    expect(describeValue(null)).toBe("null");
    expect(describeValue(undefined)).toBe("undefined");
  });
});

describe("shadowRun:新实现绝不影响生产", () => {
  it("一致 → MATCH,返回旧结果", async () => {
    const o = await shadowRun({
      label: "bom:parse",
      old: () => ({ rows: 3 }),
      next: () => ({ rows: 3 }),
    });
    expect(o.status).toBe("MATCH");
    expect(o.result).toEqual({ rows: 3 });
  });

  it("有差异 → DIFF,**返回的仍是旧结果**(生产行为不变)", async () => {
    const o = await shadowRun({
      label: "bom:parse",
      old: () => ({ rows: 3 }),
      next: () => ({ rows: 4 }),
    });
    expect(o.status).toBe("DIFF");
    expect(o.result).toEqual({ rows: 3 });
    expect(o.report?.total).toBe(1);
  });

  it("新实现抛错 → NEXT_FAILED,不外溢,生产照常拿到旧结果", async () => {
    const o = await shadowRun({
      label: "bom:parse",
      old: () => ({ rows: 3 }),
      next: () => {
        throw new Error("新实现炸了");
      },
    });
    expect(o.status).toBe("NEXT_FAILED");
    expect(o.result).toEqual({ rows: 3 });
    expect(o.nextError).toContain("新实现炸了");
    expect(o.report).toBeNull();
  });

  it("新实现返回 reject 的 Promise 同样被接住", async () => {
    const o = await shadowRun({
      label: "x",
      old: async () => 1,
      next: async () => {
        throw new Error("async boom");
      },
    });
    expect(o.status).toBe("NEXT_FAILED");
    expect(o.result).toBe(1);
  });

  it("**旧实现抛错必须原样抛出** —— 真实故障不能被对拍框架吞掉", async () => {
    await expect(
      shadowRun({
        label: "x",
        old: () => {
          throw new Error("生产故障");
        },
        next: () => 1,
      }),
    ).rejects.toThrow("生产故障");
  });

  it("记录两侧耗时(用于判断新实现是否慢到不能上)", async () => {
    let t = 0;
    const o = await shadowRun({
      label: "x",
      old: () => {
        t += 10;
        return 1;
      },
      next: () => {
        t += 250;
        return 1;
      },
      now: () => t,
    });
    expect(o.durationMs.old).toBe(10);
    expect(o.durationMs.next).toBe(250);
  });
});

describe("summarizeShadowRuns:Compatibility Report 底座", () => {
  const run = (status: "MATCH" | "DIFF" | "NEXT_FAILED", paths: string[] = []) =>
    ({
      label: "l",
      status,
      result: null,
      report: paths.length
        ? {
            diffs: paths.map((p) => ({ path: p, kind: "CHANGED" as const, old: "", next: "" })),
            total: paths.length,
            truncated: false,
          }
        : null,
      nextError: null,
      durationMs: { old: 1, next: 1 },
    }) satisfies ShadowOutcome<unknown>;

  it("按 path 聚合,回答「差异集中在哪几个字段」", () => {
    const s = summarizeShadowRuns([
      run("DIFF", ["lines[0].mpn", "total"]),
      run("DIFF", ["lines[0].mpn"]),
      run("MATCH"),
    ]);
    expect(s.total).toBe(3);
    expect(s.diff).toBe(2);
    expect(s.match).toBe(1);
    expect(s.topPaths[0]).toEqual({ path: "lines[0].mpn", count: 2 });
  });

  it("差异清零才可 flip", () => {
    expect(summarizeShadowRuns([run("MATCH"), run("MATCH")]).readyToFlip).toBe(true);
    expect(summarizeShadowRuns([run("MATCH"), run("DIFF", ["a"])]).readyToFlip).toBe(false);
  });

  it("**新实现炸了同样不能切** —— 没有差异不等于跑通了", () => {
    expect(summarizeShadowRuns([run("MATCH"), run("NEXT_FAILED")]).readyToFlip).toBe(false);
  });

  it("一次都没跑过不算就绪", () => {
    expect(summarizeShadowRuns([]).readyToFlip).toBe(false);
  });
});
