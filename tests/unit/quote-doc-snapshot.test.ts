import { describe, expect, it } from "vitest";
import { buildQuoteSnapshot, type QuoteDocHeader, type QuoteDocLine } from "@/lib/domain/quote-status";
import type { QuoteSummary } from "@/lib/domain/quote-calc";

const SUMMARY = {
  currency: "CNY",
  lines: [],
  byCategory: {},
  grandTotal: "0",
} as unknown as QuoteSummary;

const BASE = {
  quoteCode: "Q-20260730-001",
  revision: 1,
  status: "PENDING_APPROVAL" as const,
  currency: "CNY",
  summary: SUMMARY,
  laborTemplate: null,
  frozenById: "u1",
  frozenAt: "2026-07-30T00:00:00.000Z",
};

const DOC: QuoteDocHeader = {
  customerName: "联创科技",
  customerCode: "LC",
  validUntil: "2026-08-30",
  sellerName: "乾创电子(苏州)",
};

const DOC_LINES: QuoteDocLine[] = [
  {
    lineNo: 1,
    quotedMfg: "ST",
    quotedMpn: "STM32F103C8T6",
    materialCategory: "IC",
    altMfg: "GD",
    altMpn: "GD32F103C8T6",
    note: null,
  },
];

describe("正式报价单字段随快照冻结", () => {
  it("传入 doc / docLines 时逐字节固化进快照", () => {
    const snap = buildQuoteSnapshot({ ...BASE, doc: DOC, docLines: DOC_LINES });
    expect(snap.doc).toEqual(DOC);
    expect(snap.docLines).toEqual(DOC_LINES);
  });

  it("**不传时不得凭空补键** —— 旧快照必须能如实呈现为「缺该信息」", () => {
    const snap = buildQuoteSnapshot(BASE);
    expect("doc" in snap).toBe(false);
    expect("docLines" in snap).toBe(false);
    expect(snap.doc).toBeUndefined();
  });

  it("有效期未设置时存 null,而不是编一个日期", () => {
    const snap = buildQuoteSnapshot({
      ...BASE,
      doc: { ...DOC, validUntil: null },
      docLines: [],
    });
    expect(snap.doc?.validUntil).toBeNull();
  });

  it("计算结果与展示字段分离:summary 不被 doc 污染", () => {
    const snap = buildQuoteSnapshot({ ...BASE, doc: DOC, docLines: DOC_LINES });
    expect(snap.summary).toBe(SUMMARY);
    expect(JSON.stringify(snap.summary)).not.toContain("联创科技");
  });
});
