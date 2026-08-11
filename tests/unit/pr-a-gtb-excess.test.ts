/**
 * PR-A / PR2-PROC-05:建议采购量(GTB)加入 Excess,以及跨客户占用护栏。
 *
 * 两条硬纪律:
 * - **Excess 未接入时不按 0 参与计算**,也不显示成 0 —— 0 会被读成"没有多余料";
 * - **绝不自动跨客户占用** —— 把 A 客户的客供料算给 B 客户是业务事故。
 */
import { describe, expect, it } from "vitest";
import { calculateGtb } from "@/lib/domain/gtb";
import {
  createUnconfiguredExcessProvider,
  splitExcessByOwnership,
  type ExcessAvailability,
} from "@/lib/providers/excess";

describe("建议采购量的 Excess 项", () => {
  it("传入 Excess 时参与扣减", () => {
    const r = calculateGtb({ demandQty: 1000, stockQty: 100, excessQty: 200, inTransitQty: 50 });
    // 1000 - 100 - 200 - 50 = 650
    expect(r.netDemand).toBe("650");
    expect(r.excessApplied).toBe("200");
  });

  it("**未接入时 excessApplied 为 null,不是 0**", () => {
    const r = calculateGtb({ demandQty: 1000, stockQty: 100, inTransitQty: 50 });
    expect(r.excessApplied).toBeNull();
    expect(r.netDemand).toBe("850");
  });

  it("未接入时公式拆解里写明「未配置」,而不是摆一个 0", () => {
    const r = calculateGtb({ demandQty: 100 });
    const row = r.breakdown.find((b) => b.label === "可用 Excess")!;
    expect(row.value).toBe("—");
    expect(row.note).toContain("未配置");
    expect(row.note).toContain("不按 0 计");
  });

  it("Excess 覆盖需求时采购量为 0,不被 MOQ 拉起来买一批", () => {
    const r = calculateGtb({ demandQty: 100, excessQty: 500, moq: 1000, spq: 100 });
    expect(r.purchaseQty).toBe(0);
  });
});

describe("公式拆解(客户问过「GTB 是做什么」)", () => {
  it("逐项可见:需求 → 损耗 → 库存 → Excess → 在途 → 圆整 → 建议采购量", () => {
    const r = calculateGtb({
      demandQty: 1000,
      scrapRate: "0.02",
      stockQty: 100,
      excessQty: 50,
      inTransitQty: 30,
      moq: 500,
      spq: 100,
    });
    expect(r.breakdown.map((b) => b.label)).toEqual([
      "需求量",
      "损耗",
      "可用库存",
      "可用 Excess",
      "在途",
      "MOQ / SPQ 圆整",
      "建议采购量",
    ]);
    // 损耗项给的是"加了多少",不是率
    expect(r.breakdown[1].value).toBe("20");
    expect(r.breakdown[1].note).toContain("待甲方确认");
    // 结果行标注技术名,便于对上客户原话里的 GTB
    expect(r.breakdown[6].note).toContain("GTB");
    expect(r.breakdown[6].value).toBe(String(r.purchaseQty));
  });

  it("圆整项如实显示补了多少量", () => {
    const r = calculateGtb({ demandQty: 10, moq: 100, spq: 1 });
    // 净需求 10 → MOQ 100,圆整补了 90
    expect(r.breakdown.find((b) => b.label === "MOQ / SPQ 圆整")!.value).toBe("90");
  });
});

describe("Excess Provider 未配置", () => {
  it("**返回空 + 明确原因,绝不给 Mock 数字**", async () => {
    const p = createUnconfiguredExcessProvider();
    const r = await p.lookup({ tenantId: "t1", mpns: ["A"] });
    expect(p.mode).toBe("unconfigured");
    expect(r.lines).toEqual([]);
    expect(r.unavailableReason).toContain("未配置");
    expect(r.snapshotAt).toBeNull();
  });
});

describe("跨客户占用护栏", () => {
  const line = (customerId: string | null, qty: string): ExcessAvailability => ({
    customerId,
    mpn: "MPN-A",
    internalPn: null,
    qty,
    availableQty: qty,
    source: "EXCEL_IMPORT",
    snapshotAt: "2026-08-01T00:00:00.000Z",
    notes: null,
  });

  it("通用库存(customerId 为空)可用于任何客户", () => {
    const r = splitExcessByOwnership([line(null, "100")], "C1");
    expect(r.usable).toHaveLength(1);
    expect(r.otherCustomers).toHaveLength(0);
  });

  it("本客户自己的 Excess 可用", () => {
    const r = splitExcessByOwnership([line("C1", "100")], "C1");
    expect(r.usable).toHaveLength(1);
  });

  it("**别家客户的 Excess 一律不可自动占用**,单列出来", () => {
    const r = splitExcessByOwnership([line("C2", "500")], "C1");
    expect(r.usable).toHaveLength(0);
    expect(r.otherCustomers).toHaveLength(1);
  });

  it("未指定客户时只有通用库存可用 —— 不因为没写客户就放开全部", () => {
    const r = splitExcessByOwnership([line(null, "100"), line("C2", "500")], null);
    expect(r.usable.map((l) => l.qty)).toEqual(["100"]);
    expect(r.otherCustomers).toHaveLength(1);
  });
});
