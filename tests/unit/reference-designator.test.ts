/**
 * REF-2a:canonical 位号解析。
 * 规则采纳自 bom2buy references.ts,但刻意保留本仓的两条口径(不去重、跨度上限 10000)。
 */
import { describe, expect, it } from "vitest";
import {
  compactReferences,
  looksLikeReferenceList,
  MAX_RANGE_SPAN,
  parseReferences,
  referenceCount,
} from "@/modules/bom/domain/reference-designator";
import { countRefDes, looksLikeRefDesList } from "@/lib/domain/bom-parse";
import { expandRefDes } from "@/lib/domain/bom-validate";

describe("parseReferences:分隔符", () => {
  it("半角逗号 / 空格 / 分号 / 顿号", () => {
    expect(parseReferences("R1,R2").refs).toEqual(["R1", "R2"]);
    expect(parseReferences("R1 R2").refs).toEqual(["R1", "R2"]);
    expect(parseReferences("R1;R2").refs).toEqual(["R1", "R2"]);
    expect(parseReferences("R1、R2").refs).toEqual(["R1", "R2"]);
  });

  it("**全角逗号 / 全角分号**(旧实现从未处理:两对分隔符全是 ASCII)", () => {
    expect(parseReferences("C1，C2").refs).toEqual(["C1", "C2"]);
    expect(parseReferences("C1；C2").refs).toEqual(["C1", "C2"]);
  });
});

describe("parseReferences:范围", () => {
  it("连字符 / 半角波浪 / 结束端省略前缀", () => {
    expect(referenceCount("R1-R10")).toBe(10);
    expect(referenceCount("R1~R10")).toBe(10);
    expect(parseReferences("R1-5").refs).toEqual(["R1", "R2", "R3", "R4", "R5"]);
  });

  it("连接号 / 破折号 / 全角波浪 / 省略号(旧 expandRefDes 对 `R1–R10` 只算 1 个)", () => {
    for (const sep of ["–", "—", "～", "…"]) {
      expect(referenceCount(`R1${sep}R10`), JSON.stringify(sep)).toBe(10);
    }
  });

  it("**不猜**:前缀不一致 / 反向 / 超跨度 → 原样计 1 个并登记 unparsed", () => {
    for (const s of ["R1-C5", "R10-R1", `R1-R${MAX_RANGE_SPAN + 2}`]) {
      const p = parseReferences(s);
      expect(p.refs, s).toHaveLength(1);
      expect(p.unparsed, s).toEqual([s]);
      expect(p.expandedRanges, s).toEqual([]);
    }
  });

  it("成功展开的范围登记到 expandedRanges(原样)", () => {
    expect(parseReferences("R1-R3, C1").expandedRanges).toEqual(["R1-R3"]);
  });
});

describe("parseReferences:本仓口径(与 bom2buy 刻意不同)", () => {
  it("**不去重** —— 重复位号检测正是要看见重复", () => {
    expect(parseReferences("R1, R1, r1").refs).toEqual(["R1", "R1", "R1"]);
  });

  it("原始串原样保留,展开结果另存", () => {
    const p = parseReferences("r1-r3");
    expect(p.original).toBe("r1-r3");
    expect(p.refs).toEqual(["R1", "R2", "R3"]);
  });

  it("非范围的怪写法按一个位号计(`!PCB700` / `SH-J700` 这类真实存在)", () => {
    expect(parseReferences("!PCB700, SH-J700").refs).toEqual(["!PCB700", "SH-J700"]);
  });

  it("空值安全", () => {
    expect(parseReferences(null).refs).toEqual([]);
    expect(referenceCount("   ")).toBe(0);
  });
});

describe("looksLikeReferenceList:识别折行的位号续行", () => {
  it("逗号 / 空格 / 范围 / 全角都认", () => {
    for (const s of ["C103, C201", "C3 C4", "R11~R20", "C1，C2", "R1-R10"]) {
      expect(looksLikeReferenceList(s), s).toBe(true);
    }
  });

  it("散文不认(备注、页码、纯中文)", () => {
    for (const s of ["备注:以上为主料", "see note 1", "Page 1 of 3", "测试点", ""]) {
      expect(looksLikeReferenceList(s), s).toBe(false);
    }
  });
});

describe("compactReferences:仅用于展示/导出", () => {
  it("连号 ≥3 合并,恰好 2 个分开写", () => {
    expect(compactReferences(["R1", "R2", "R3", "R5", "R6", "C1"])).toBe("C1,R1-R3,R5,R6");
  });

  it("无法解析的原样附在末尾", () => {
    expect(compactReferences(["R1", "!PCB700"])).toBe("R1,!PCB700");
  });
});

describe("兼容层:旧函数名转调 canonical,旧口径与新口径一致", () => {
  it("countRefDes 现在展开范围(修正续行合并判据)", () => {
    expect(countRefDes("R1-R10")).toBe(10);
    expect(countRefDes("C1，C2")).toBe(2);
  });

  it("expandRefDes ≡ parseReferences().refs", () => {
    for (const s of ["R1,R2", "R1-R5", "C1~C3", "R1 R2", "R1-C5", "R1–R3"]) {
      expect(expandRefDes(s), s).toEqual(parseReferences(s).refs);
    }
  });

  it("looksLikeRefDesList ≡ looksLikeReferenceList", () => {
    for (const s of ["C3 C4", "R11~R20", "备注:以上为主料"]) {
      expect(looksLikeRefDesList(s), s).toBe(looksLikeReferenceList(s));
    }
  });
});
