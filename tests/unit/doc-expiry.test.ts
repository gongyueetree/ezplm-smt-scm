import { describe, expect, it } from "vitest";
import {
  COMPLIANCE_DOC_KINDS,
  DOC_EXPIRY_BUCKETS,
  daysUntilExpiry,
  expiryBucket,
  expiryTone,
  summarizeCompliance,
} from "@/lib/domain/doc-expiry";

const TODAY = "2026-07-31";

describe("有效期分桶", () => {
  it("按剩余天数分档", () => {
    expect(expiryBucket("2026-06-30", TODAY)).toBe("已过期");
    expect(expiryBucket("2026-08-10", TODAY)).toBe("30天内到期");
    expect(expiryBucket("2026-10-01", TODAY)).toBe("90天内到期");
    expect(expiryBucket("2027-06-01", TODAY)).toBe("有效");
  });

  it("**未标注有效期单列一档,绝不并入「有效」**", () => {
    expect(expiryBucket(null, TODAY)).toBe("未标注有效期");
  });

  it("日期不可解析也按未标注处理,不猜", () => {
    expect(expiryBucket("下个月", TODAY)).toBe("未标注有效期");
  });

  it("剩余天数:已过期为负,未填为 null(不是 0)", () => {
    expect(daysUntilExpiry("2026-07-21", TODAY)).toBe(-10);
    expect(daysUntilExpiry(null, TODAY)).toBeNull();
  });

  it("边界日:当天到期算 30 天内而不是已过期", () => {
    expect(expiryBucket(TODAY, TODAY)).toBe("30天内到期");
  });
});

describe("风险色", () => {
  it("**未标注按告警显示,不按正常** —— 未知不是好消息", () => {
    expect(expiryTone("未标注有效期")).toBe("amber");
    expect(expiryTone("有效")).toBe("green");
    expect(expiryTone("已过期")).toBe("red");
  });
});

describe("合规汇总", () => {
  const docs = [
    { partId: "p1", internalPn: "A", kind: "ROHS_REPORT", validUntil: "2026-06-01" },
    { partId: "p1", internalPn: "A", kind: "REACH_REPORT", validUntil: null },
    { partId: "p2", internalPn: "B", kind: "ROHS_REPORT", validUntil: "2027-01-01" },
    // 数据手册不参与有效期管控
    { partId: "p2", internalPn: "B", kind: "DATASHEET", validUntil: null },
  ];

  it("只统计合规类文档,数据手册不计入", () => {
    const s = summarizeCompliance(docs, ["p1", "p2"], TODAY);
    const total = s.buckets.reduce((a, b) => a + b.count, 0);
    expect(total).toBe(3);
  });

  it("紧急数 = 已过期 + 30 天内", () => {
    const s = summarizeCompliance(docs, ["p1", "p2"], TODAY);
    expect(s.urgentCount).toBe(1);
  });

  it("**未标注份数单独暴露**,说明这部分状态不可知", () => {
    const s = summarizeCompliance(docs, ["p1", "p2"], TODAY);
    expect(s.unknownCount).toBe(1);
  });

  it("**缺文档与文档过期是两件事**,分别统计", () => {
    const s = summarizeCompliance(docs, ["p1", "p2", "p3"], TODAY);
    const coc = s.missingByKind.find((m) => m.kind === "COC")!;
    // 三颗料都没有 COC
    expect(coc.missingParts).toBe(3);
    const rohs = s.missingByKind.find((m) => m.kind === "ROHS_REPORT")!;
    expect(rohs.missingParts).toBe(1);
  });

  it("空数据不报错", () => {
    const s = summarizeCompliance([], [], TODAY);
    expect(s.urgentCount).toBe(0);
    expect(s.buckets).toHaveLength(DOC_EXPIRY_BUCKETS.length);
  });

  it("管控三类合规文档", () => {
    expect([...COMPLIANCE_DOC_KINDS]).toEqual(["ROHS_REPORT", "REACH_REPORT", "COC"]);
  });
});
