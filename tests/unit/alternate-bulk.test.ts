import { describe, expect, it } from "vitest";
import {
  TEMPLATE_HEADER_LABELS,
  parseAlternateImportGrid,
  resolveRows,
} from "@/lib/domain/alternate-bulk";

/**
 * E3 / 客户 Q9:「物料替代的批量导入导出需要输入口」。
 *
 * 三条硬规矩:逐行报错、不自动建料、兼容级别写错就是错(不回落 UNKNOWN)。
 */

const HEAD = TEMPLATE_HEADER_LABELS;

function grid(...rows: string[][]) {
  return [HEAD, ...rows];
}

/** 一条完整合法行 */
function ok(basePn = "EE-001", altPn = "EE-002"): string[] {
  return [basePn, "Yageo", "M-A", altPn, "Murata", "M-B", "EXACT", "MINOR_VARIATION", "PIN_TO_PIN", "同规格", "MANUAL", "张工", ""];
}

describe("解析与逐行校验", () => {
  it("正常行解析出三个兼容维度与两端料号", () => {
    const r = parseAlternateImportGrid(grid(ok()));
    expect(r.fatal).toBeNull();
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      basePn: "EE-001",
      altPn: "EE-002",
      functional: "EXACT",
      packageCompat: "MINOR_VARIATION",
      pin: "PIN_TO_PIN",
      reason: "同规格",
    });
  });

  it("缺必需列时整表拒绝,并说清缺哪几列", () => {
    const r = parseAlternateImportGrid([["基准内部料号", "替代内部料号"], ["EE-1", "EE-2"]]);
    expect(r.fatal).toContain("缺少必需列");
    expect(r.fatal).toContain("功能等效");
    expect(r.rows).toHaveLength(0);
  });

  it("**兼容级别写错就是错,不回落 UNKNOWN** —— 笔误不该变成系统结论", () => {
    const bad = ok();
    bad[6] = "FUNCTIONAL"; // 旧模式名,不是新维度取值
    const r = parseAlternateImportGrid(grid(bad));
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0].message).toContain("不是合法取值");
    expect(r.errors[0].message).toContain("EXACT");
  });

  it("兼容级别留空报错,而不是当成未知", () => {
    const bad = ok();
    bad[8] = "";
    const r = parseAlternateImportGrid(grid(bad));
    expect(r.errors[0].message).toContain("引脚兼容为空");
    expect(r.errors[0].message).toContain("显式填 UNKNOWN");
  });

  it("大小写与连字符无关,但取值本身必须对", () => {
    const v = ok();
    v[8] = "pin to pin";
    expect(parseAlternateImportGrid(grid(v)).rows[0].pin).toBe("PIN_TO_PIN");
  });

  it("**坏行报错,好行照常解析** —— 不是整批一句「格式不对」", () => {
    const bad = ok("EE-BAD", "EE-BAD2");
    bad[7] = "什么鬼";
    const r = parseAlternateImportGrid(grid(ok("EE-1", "EE-2"), bad, ok("EE-3", "EE-4")));
    expect(r.rows.map((x) => x.basePn)).toEqual(["EE-1", "EE-3"]);
    expect(r.errors).toHaveLength(1);
    // 行号要指得回原表
    expect(r.errors[0].rowNo).toBe(3);
  });

  it("基准料与替代料相同时拒绝", () => {
    const r = parseAlternateImportGrid(grid(ok("EE-9", "EE-9")));
    expect(r.errors[0].message).toContain("同一个料号");
  });

  it("两端料号缺一个都报错,并指明缺哪一端", () => {
    const noBase = ok();
    noBase[0] = "";
    expect(parseAlternateImportGrid(grid(noBase)).errors[0].message).toContain("基准内部料号为空");
    const noAlt = ok();
    noAlt[3] = "";
    expect(parseAlternateImportGrid(grid(noAlt)).errors[0].message).toContain("替代内部料号为空");
  });
});

describe("料号解析:绝不自动建料", () => {
  const ctx = { partIdByInternalPn: new Map([["EE001", "p1"], ["EE002", "p2"]]) };

  it("两端都在库里 → 解析出 partId", () => {
    const { rows } = parseAlternateImportGrid(grid(ok("EE-001", "EE-002")));
    const r = resolveRows(rows, ctx);
    expect(r.errors).toEqual([]);
    expect(r.resolved[0]).toMatchObject({ basePartId: "p1", altPartId: "p2" });
  });

  it("**基准料不存在 → 报错,不建料**", () => {
    const { rows } = parseAlternateImportGrid(grid(ok("EE-NOPE", "EE-002")));
    const r = resolveRows(rows, ctx);
    expect(r.resolved).toHaveLength(0);
    expect(r.errors[0].message).toContain("不存在");
    expect(r.errors[0].message).toContain("系统不会自动建");
  });

  it("**替代料不存在 → 报错,不建料**", () => {
    const { rows } = parseAlternateImportGrid(grid(ok("EE-001", "EE-NOPE")));
    const r = resolveRows(rows, ctx);
    expect(r.resolved).toHaveLength(0);
    expect(r.errors[0].message).toContain("EE-NOPE");
  });

  it("料号归一化只做大小写与分隔符 —— 前缀相同的两颗料不互相命中", () => {
    const { rows } = parseAlternateImportGrid(grid(ok("ee 001", "EE_002")));
    expect(resolveRows(rows, ctx).resolved).toHaveLength(1);
    const { rows: r2 } = parseAlternateImportGrid(grid(ok("EE-0011", "EE-002")));
    expect(resolveRows(r2, ctx).resolved).toHaveLength(0);
  });
});
