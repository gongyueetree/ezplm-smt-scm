import { describe, expect, it } from "vitest";
import { buildComparisonSet, validateSelection } from "@/lib/domain/sourcing";
import type { NormalizedOffer } from "@/lib/providers/common/normalized-offer";

function offer(patch: Partial<NormalizedOffer>): NormalizedOffer {
  return {
    provider: "DIGIKEY",
    providerPartNumber: null,
    manufacturer: "STMicroelectronics",
    mpn: "STM32F103C8T6",
    description: null,
    packaging: null,
    stock: 100000,
    moq: 1,
    spq: 1,
    leadTimeDays: 20,
    lifecycle: "ACTIVE",
    rohs: true,
    reach: true,
    currency: "CNY",
    priceBreaks: [{ minQty: 1, unitPrice: "20" }],
    sourceUpdatedAt: null,
    sourceUrl: null,
    ...patch,
  };
}

const BASE = { mpn: "STM32F103C8T6", manufacturer: "STMicroelectronics", demandQty: 1000, currency: "CNY" };

describe("比价集合构建(SPEC §11)", () => {
  it("展示全部报价,并同时标识推荐与最低总价", () => {
    const cheapButSlow = offer({
      providerPartNumber: "CHEAP",
      provider: "MOUSER",
      priceBreaks: [{ minQty: 1, unitPrice: "10" }],
      leadTimeDays: 85,
      lifecycle: "NRND",
    });
    const balanced = offer({ providerPartNumber: "BALANCED", priceBreaks: [{ minQty: 1, unitPrice: "12" }] });

    const set = buildComparisonSet({ ...BASE, mode: "SPOT", offers: [cheapButSlow, balanced] });
    expect(set.ranked).toHaveLength(2);
    expect(set.lowestTotal?.offer.providerPartNumber).toBe("CHEAP");
    // 推荐不等于最低价:交期与生命周期同样计入
    expect(set.recommended?.offer.providerPartNumber).toBe("BALANCED");
  });

  it("同号异厂料被排除出比价集合并给出原因(PR4 冒烟教训)", () => {
    const wrongMfr = offer({ providerPartNumber: "WRONG", manufacturer: "Microchip / Microsemi" });
    const set = buildComparisonSet({ ...BASE, mode: "SPOT", offers: [offer({ providerPartNumber: "OK" }), wrongMfr] });
    expect(set.eligible.map((e) => e.offer.providerPartNumber)).toEqual(["OK"]);
    expect(set.excluded[0].reason).toContain("同号异厂料");
  });

  it("异币种被排除,不做汇率换算", () => {
    const usd = offer({ providerPartNumber: "USD", currency: "USD" });
    const set = buildComparisonSet({ ...BASE, mode: "SPOT", offers: [offer({ providerPartNumber: "CNY" }), usd] });
    expect(set.excluded.some((e) => e.reason.includes("汇率"))).toBe(true);
    expect(set.eligible.map((e) => e.offer.providerPartNumber)).toEqual(["CNY"]);
  });

  it("现货模式要求库存覆盖采购量", () => {
    const noStock = offer({ providerPartNumber: "NOSTOCK", stock: 0, leadTimeDays: 30 });
    const set = buildComparisonSet({ ...BASE, mode: "SPOT", offers: [noStock] });
    expect(set.eligible).toHaveLength(0);
    expect(set.excluded[0].reason).toContain("现货模式");
    expect(set.recommended).toBeNull();
  });

  it("期货模式允许零库存但必须有交期", () => {
    const futures = offer({ providerPartNumber: "FUT", stock: 0, leadTimeDays: 45 });
    const noEta = offer({ providerPartNumber: "NOETA", stock: 0, leadTimeDays: null });
    const set = buildComparisonSet({ ...BASE, mode: "FUTURES", offers: [futures, noEta] });
    expect(set.eligible.map((e) => e.offer.providerPartNumber)).toEqual(["FUT"]);
    expect(set.excluded[0].reason).toContain("既无库存也无交期");
  });

  it("MOQ/SPQ 参与采购量,进而影响适用阶梯价", () => {
    const tiered = offer({
      providerPartNumber: "TIER",
      moq: 500,
      spq: 500,
      priceBreaks: [
        { minQty: 1, unitPrice: "20" },
        { minQty: 1000, unitPrice: "15" },
      ],
    });
    const set = buildComparisonSet({ ...BASE, demandQty: 800, mode: "SPOT", offers: [tiered] });
    // 800 → 圆整到 1000 → 命中 1000 档
    expect(set.eligible[0].purchaseQty).toBe(1000);
    expect(set.eligible[0].unitPrice?.toFixed()).toBe("15");
  });

  it("全部报价都不可比时推荐为空,但报价仍全部展示(不静默丢弃)", () => {
    const set = buildComparisonSet({
      ...BASE,
      mode: "SPOT",
      offers: [offer({ currency: "USD" }), offer({ manufacturer: "Murata" })],
    });
    expect(set.recommended).toBeNull();
    expect(set.ranked).toHaveLength(2);
    expect(set.excluded).toHaveLength(2);
  });
});

describe("采购选型校验(SPEC §11:可选择、修改或拒绝推荐)", () => {
  it("未选择供应商被拒", () => {
    const r = validateSelection({ selectedKey: null, recommendedKey: "A" });
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe("no_selection");
  });

  it("采纳推荐无需理由", () => {
    const r = validateSelection({ selectedKey: "A", recommendedKey: "A" });
    expect(r.ok).toBe(true);
    expect(r.overrodeRecommendation).toBe(false);
  });

  it("拒绝推荐必须写理由", () => {
    const without = validateSelection({ selectedKey: "B", recommendedKey: "A" });
    expect(without.ok).toBe(false);
    expect(without.errors[0].code).toBe("reason_required");
    expect(without.overrodeRecommendation).toBe(true);

    const withReason = validateSelection({
      selectedKey: "B",
      recommendedKey: "A",
      reason: "A 供应商账期不符,改选 B",
    });
    expect(withReason.ok).toBe(true);
  });

  it("空白理由不算理由", () => {
    expect(validateSelection({ selectedKey: "B", recommendedKey: "A", reason: "  " }).ok).toBe(false);
  });

  it("无推荐时任选皆可(系统未给建议就不强制理由)", () => {
    expect(validateSelection({ selectedKey: "B", recommendedKey: null }).ok).toBe(true);
  });
});
