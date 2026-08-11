import { describe, expect, it } from "vitest";
import {
  ageInMonths,
  deriveDcAging,
  deriveQuoteStats,
  deriveSlowMoving,
  parseDateCode,
  type InventoryAgingRow,
  type QuoteStatRow,
} from "@/lib/domain/management-kpi";

const NOW = "2026-07-28T00:00:00.000Z";

describe("报价统计(SPEC §16 管理层报价汇总 + 转化率)", () => {
  const rows: QuoteStatRow[] = [
    { status: "APPROVED", grandTotal: "1000.00", currency: "CNY" },
    { status: "APPROVED", grandTotal: "2500.50", currency: "CNY" },
    { status: "REJECTED", grandTotal: "800.00", currency: "CNY" },
    { status: "DRAFT", grandTotal: null, currency: "CNY" },
    { status: "PENDING_APPROVAL", grandTotal: "500.00", currency: "CNY" },
  ];

  it("按状态计数并汇总已批准金额", () => {
    const s = deriveQuoteStats(rows);
    expect(s.total).toBe(5);
    expect(s.byStatus.APPROVED).toBe(2);
    expect(s.approvedAmountByCurrency.CNY).toBe("3500.50");
  });

  it("只统计已批准金额,草稿与待审批不计入", () => {
    const s = deriveQuoteStats(rows);
    expect(s.approvedAmountByCurrency.CNY).not.toContain("500.00");
  });

  it("异币种不合并(不做汇率换算)", () => {
    const s = deriveQuoteStats([
      { status: "APPROVED", grandTotal: "100.00", currency: "CNY" },
      { status: "APPROVED", grandTotal: "50.00", currency: "USD" },
    ]);
    expect(s.approvedAmountByCurrency).toEqual({ CNY: "100.00", USD: "50.00" });
  });

  /*
   * PR-D 改名:这个指标一直算的是**内部审批通过率**,却顶着「转化率」的名字
   * 挂在管理看板上。真正的订单转化率靠人工标记中标,见 quote-outcome.ts。
   */
  it("审批通过率 = 已批准 /(已批准+已退回+已过期)", () => {
    expect(deriveQuoteStats(rows).approvalPassRate).toBe(0.6667);
  });

  it("无终局版本时审批通过率为 null,不显示成 0%", () => {
    const s = deriveQuoteStats([{ status: "DRAFT", grandTotal: null, currency: "CNY" }]);
    expect(s.approvalPassRate).toBeNull();
  });

  it("空集合安全", () => {
    expect(deriveQuoteStats([])).toMatchObject({ total: 0, approvalPassRate: null });
  });
});

describe("DC 日期码解析", () => {
  it("YYWW 解析为大致生产日期", () => {
    const d = parseDateCode("2523");
    expect(d?.getUTCFullYear()).toBe(2025);
    expect(d?.getUTCMonth()).toBe(5); // 第 23 周 ≈ 6 月
  });

  it("非法/缺失一律 null(不猜)", () => {
    for (const dc of [null, undefined, "", "abc", "25", "2599", "2500"]) {
      expect(parseDateCode(dc)).toBeNull();
    }
  });

  it("月龄按 DC 计算", () => {
    expect(ageInMonths("2601", NOW)).toBeGreaterThanOrEqual(6);
    expect(ageInMonths(null, NOW)).toBeNull();
  });
});

describe("DC Aging 分桶(SPEC §16)", () => {
  const rows: InventoryAgingRow[] = [
    { partId: "p1", mpn: "A", qtyOnHand: 100, qtySlowMoving: 0, dateCode: "2626", fetchedAt: NOW }, // 很新
    { partId: "p2", mpn: "B", qtyOnHand: 200, qtySlowMoving: 50, dateCode: "2523", fetchedAt: NOW }, // 约 13 月
    { partId: "p3", mpn: "C", qtyOnHand: 300, qtySlowMoving: null, dateCode: "2301", fetchedAt: NOW }, // 约 42 月
    { partId: "p4", mpn: "D", qtyOnHand: 400, qtySlowMoving: 0, dateCode: null, fetchedAt: NOW }, // DC 未知
  ];

  it("按月龄分桶", () => {
    const r = deriveDcAging(rows, NOW);
    const byLabel = Object.fromEntries(r.buckets.map((b) => [b.label, b]));
    expect(byLabel["0–6 月"].count).toBe(1);
    expect(byLabel["12–24 月"].count).toBe(1);
    expect(byLabel["24 月以上"].count).toBe(1);
  });

  it("DC 未知的行单列,绝不并入最新桶(不制造库存很新的假象)", () => {
    const r = deriveDcAging(rows, NOW);
    expect(r.unknownDateCode).toEqual({ count: 1, qty: 400 });
    const total = r.buckets.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(3); // 4 行中 1 行 DC 未知
  });

  it("分桶阈值可配置", () => {
    const r = deriveDcAging(rows, NOW, [0, 36]);
    expect(r.buckets.map((b) => b.label)).toEqual(["0–36 月", "36 月以上"]);
  });

  it("空集合安全", () => {
    const r = deriveDcAging([], NOW);
    expect(r.unknownDateCode.count).toBe(0);
    expect(r.buckets.every((b) => b.count === 0)).toBe(true);
  });
});

describe("呆滞汇总:未知与 0 严格区分", () => {
  const rows: InventoryAgingRow[] = [
    { partId: "p1", mpn: "A", qtyOnHand: 100, qtySlowMoving: 0, dateCode: null, fetchedAt: NOW },
    { partId: "p2", mpn: "B", qtyOnHand: 200, qtySlowMoving: 80, dateCode: null, fetchedAt: NOW },
    { partId: "p3", mpn: "C", qtyOnHand: 300, qtySlowMoving: null, dateCode: null, fetchedAt: NOW },
  ];

  it("呆滞数量未知的物料既不算呆滞也不算正常,单独计数", () => {
    const s = deriveSlowMoving(rows);
    expect(s).toEqual({
      totalParts: 3,
      slowMovingParts: 1,
      slowMovingQty: 80,
      unknownParts: 1,
    });
  });

  it("空集合安全", () => {
    expect(deriveSlowMoving([])).toMatchObject({ totalParts: 0, slowMovingParts: 0 });
  });
});
