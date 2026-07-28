import { describe, expect, it } from "vitest";
import {
  detectDuplicateRefDes,
  detectEolParts,
  detectFootprintMismatch,
  detectQtyRefDesMismatch,
  expandRefDes,
  normalizeFootprint,
  validateBomLines,
} from "@/lib/domain/bom-validate";
import type { ParsedBomLine } from "@/lib/domain/bom-parse";

function line(patch: Partial<ParsedBomLine>): ParsedBomLine {
  return {
    sourceRow: 1,
    lineNo: 1,
    refDes: null,
    qty: 1,
    mpn: null,
    manufacturer: null,
    customerPn: null,
    internalPn: null,
    description: null,
    footprint: null,
    issues: [],
    ...patch,
  };
}

describe("位号展开", () => {
  it("逗号/空格/中文分隔符", () => {
    expect(expandRefDes("R1,R2 R3、C1")).toEqual(["R1", "R2", "R3", "C1"]);
  });

  it("区间展开:R1-R5 / C1~C3 / R1-5", () => {
    expect(expandRefDes("R1-R5")).toEqual(["R1", "R2", "R3", "R4", "R5"]);
    expect(expandRefDes("C1~C3")).toEqual(["C1", "C2", "C3"]);
    expect(expandRefDes("R1-5")).toEqual(["R1", "R2", "R3", "R4", "R5"]);
  });

  it("前缀不一致的区间不展开(不臆造位号)", () => {
    expect(expandRefDes("R1-C5")).toEqual(["R1-C5"]);
  });

  it("大小写归一,空值安全", () => {
    expect(expandRefDes("r1,c2")).toEqual(["R1", "C2"]);
    expect(expandRefDes(null)).toEqual([]);
    expect(expandRefDes("")).toEqual([]);
  });
});

describe("重复位号检测(SPEC §6)", () => {
  it("跨行重复被判为 error 并列出行号", () => {
    const issues = detectDuplicateRefDes([
      line({ lineNo: 1, refDes: "R1,R2" }),
      line({ lineNo: 2, refDes: "R2,R3" }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("error");
    expect(issues[0].refDes).toBe("R2");
    expect(issues[0].lineNos).toEqual([1, 2]);
  });

  it("区间展开后的重叠也能检出(R1-R5 与 R3)", () => {
    const issues = detectDuplicateRefDes([
      line({ lineNo: 1, refDes: "R1-R5" }),
      line({ lineNo: 2, refDes: "R3" }),
    ]);
    expect(issues.map((i) => i.refDes)).toEqual(["R3"]);
  });

  it("行内自重复也算重复", () => {
    const issues = detectDuplicateRefDes([line({ lineNo: 1, refDes: "R1,R1" })]);
    expect(issues).toHaveLength(1);
    expect(issues[0].refDes).toBe("R1");
  });

  it("无重复时无告警", () => {
    expect(
      detectDuplicateRefDes([line({ lineNo: 1, refDes: "R1" }), line({ lineNo: 2, refDes: "R2" })]),
    ).toEqual([]);
  });
});

describe("数量与位号个数一致性(提示级)", () => {
  it("不一致给 warning", () => {
    const issues = detectQtyRefDesMismatch([line({ lineNo: 1, refDes: "R1,R2,R3", qty: 2 })]);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("warning");
  });

  it("一致或无位号时不告警", () => {
    expect(detectQtyRefDesMismatch([line({ refDes: "R1,R2", qty: 2 })])).toEqual([]);
    expect(detectQtyRefDesMismatch([line({ refDes: null, qty: 100 })])).toEqual([]);
  });
});

describe("EOL / 停产检测(SPEC §6)", () => {
  const lookup = (mpn: string) =>
    ({ MAX232CPE: "EOL", OLDPART: "OBSOLETE", "RC0603FR-0710KL": "NRND", GOOD: "ACTIVE" })[
      mpn
    ] as never;

  it("EOL 与 OBSOLETE 判为 error", () => {
    const issues = detectEolParts(
      [line({ lineNo: 1, mpn: "MAX232CPE" }), line({ lineNo: 2, mpn: "OLDPART" })],
      lookup,
    );
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.level === "error")).toBe(true);
  });

  it("NRND 判为 warning(可用但不推荐新设计)", () => {
    const issues = detectEolParts([line({ lineNo: 1, mpn: "RC0603FR-0710KL" })], lookup);
    expect(issues[0].level).toBe("warning");
  });

  it("ACTIVE 与未知不告警(未知交人工,不臆断)", () => {
    expect(detectEolParts([line({ mpn: "GOOD" }), line({ mpn: "NEVER-SEEN" })], lookup)).toEqual([]);
  });
});

describe("封装不一致检测(SPEC §6)", () => {
  const lookup = (mpn: string) => ({ A: "0603", B: "SOIC-16" })[mpn];

  it("封装不同判为 error", () => {
    const issues = detectFootprintMismatch([line({ lineNo: 1, mpn: "A", footprint: "0805" })], lookup);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("封装不一致");
  });

  it("写法差异不算不一致(SOIC-16 ≡ SOIC16)", () => {
    expect(detectFootprintMismatch([line({ mpn: "B", footprint: "SOIC16" })], lookup)).toEqual([]);
    expect(normalizeFootprint("SOIC-16")).toBe(normalizeFootprint("soic 16"));
  });

  it("主数据无封装时不告警(缺数据不等于不一致)", () => {
    expect(detectFootprintMismatch([line({ mpn: "UNKNOWN", footprint: "0603" })], lookup)).toEqual(
      [],
    );
  });
});

describe("汇总校验", () => {
  it("有 error 即 blocked,warning 不阻断", () => {
    const report = validateBomLines([
      line({ lineNo: 1, refDes: "R1", qty: 1, mpn: "A" }),
      line({ lineNo: 2, refDes: "R1", qty: 1, mpn: "B" }), // 位号重复 → error
      line({ lineNo: 3, refDes: "C1,C2", qty: 1, mpn: "C" }), // 数量不符 → warning
    ]);
    expect(report.errorCount).toBeGreaterThan(0);
    expect(report.warningCount).toBeGreaterThan(0);
    expect(report.blocked).toBe(true);
  });

  it("解析阶段的 issue 汇入总报告", () => {
    const report = validateBomLines([line({ lineNo: 1, issues: ["数量无法解析:abc"] })]);
    expect(report.issues.some((i) => i.code === "parse_issue")).toBe(true);
    expect(report.blocked).toBe(true);
  });

  it("干净 BOM 不阻断", () => {
    const report = validateBomLines([
      line({ lineNo: 1, refDes: "R1", qty: 1, mpn: "A" }),
      line({ lineNo: 2, refDes: "R2", qty: 1, mpn: "B" }),
    ]);
    expect(report.blocked).toBe(false);
    expect(report.issues).toEqual([]);
  });
});
