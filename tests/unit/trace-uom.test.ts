import { describe, expect, it } from "vitest";
import { normalizeUom, sumByBaseUom, toBaseQuantity, type UomQuantity } from "@/lib/domain/trace-uom";

function q(over: Partial<UomQuantity> = {}): UomQuantity {
  return { quantity: null, uom: null, baseQuantity: null, baseUom: null, conversionFactor: null, ...over };
}

describe("normalizeUom", () => {
  it("常见别名归一", () => {
    expect(normalizeUom("pcs")).toBe("PCS");
    expect(normalizeUom("PC")).toBe("PCS");
    expect(normalizeUom("盘")).toBe("REEL");
    expect(normalizeUom("箱")).toBe("BOX");
  });

  it("**不认识的单位原样保留**,不丢弃 —— 丢了会被误当成缺单位", () => {
    expect(normalizeUom("SHEET")).toBe("SHEET");
  });

  it("空值返回 null", () => {
    expect(normalizeUom("")).toBeNull();
    expect(normalizeUom(null)).toBeNull();
  });
});

describe("toBaseQuantity", () => {
  it("按系数折算:2 Reel × 5000 = 10000 PCS", () => {
    const r = toBaseQuantity(q({ quantity: "2", uom: "REEL", baseUom: "PCS", conversionFactor: "5000" }));
    expect(r.status).toBe("OK");
    expect(r.baseQuantity).toBe("10000");
    expect(r.baseUom).toBe("PCS");
  });

  it("已给基准数量则直接用", () => {
    const r = toBaseQuantity(q({ baseQuantity: "888", baseUom: "PCS" }));
    expect(r.status).toBe("OK");
    expect(r.baseQuantity).toBe("888");
  });

  it("单位即基准单位时系数视为 1", () => {
    const r = toBaseQuantity(q({ quantity: "500", uom: "PCS", baseUom: "PCS" }));
    expect(r.baseQuantity).toBe("500");
  });

  it("**缺换算系数不猜**,返回不可比", () => {
    const r = toBaseQuantity(q({ quantity: "2", uom: "REEL", baseUom: "PCS" }));
    expect(r.status).toBe("MISSING_FACTOR");
    expect(r.baseQuantity).toBeNull();
    expect(r.detail).toContain("不可比");
  });

  it("**系数为 0 视为无效** —— 否则数量会凭空消失", () => {
    const r = toBaseQuantity(q({ quantity: "2", uom: "REEL", baseUom: "PCS", conversionFactor: "0" }));
    expect(r.status).toBe("INVALID_FACTOR");
    expect(r.detail).toContain("凭空消失");
  });

  it("有数量无单位 → 明确报缺单位,不默认成 PCS", () => {
    const r = toBaseQuantity(q({ quantity: "100" }));
    expect(r.status).toBe("NO_UOM");
    expect(r.baseQuantity).toBeNull();
  });

  it("没有数量就是没有,不当 0", () => {
    expect(toBaseQuantity(q({ uom: "PCS" })).status).toBe("NO_QUANTITY");
  });
});

describe("sumByBaseUom:**不能把 PCS 和 Reel 直接相加**", () => {
  it("同基准单位才合计", () => {
    const r = sumByBaseUom([
      q({ quantity: "2", uom: "REEL", baseUom: "PCS", conversionFactor: "5000" }),
      q({ quantity: "300", uom: "PCS", baseUom: "PCS" }),
    ]);
    expect(r.totals).toEqual([{ baseUom: "PCS", total: "10300", edgeCount: 2 }]);
    expect(r.mixedUom).toBe(false);
  });

  it("**不同基准单位分组统计并标记 mixedUom**,绝不加在一起", () => {
    const r = sumByBaseUom([
      q({ quantity: "100", uom: "PCS", baseUom: "PCS" }),
      q({ quantity: "5", uom: "KG", baseUom: "KG" }),
    ]);
    expect(r.mixedUom).toBe(true);
    expect(r.totals).toHaveLength(2);
    expect(r.totals.map((t) => t.baseUom)).toEqual(["KG", "PCS"]);
  });

  it("不可折算的边单独计数并给出原因,不混入合计", () => {
    const r = sumByBaseUom([
      q({ quantity: "100", uom: "PCS", baseUom: "PCS" }),
      q({ quantity: "2", uom: "REEL", baseUom: "PCS" }),
      q({ uom: "PCS" }),
    ]);
    expect(r.totals[0].total).toBe("100");
    expect(r.incomparableEdges).toBe(2);
    expect(r.issues.map((i) => i.status).sort()).toEqual(["MISSING_FACTOR", "NO_QUANTITY"]);
  });

  it("空输入不报错", () => {
    const r = sumByBaseUom([]);
    expect(r.totals).toEqual([]);
    expect(r.mixedUom).toBe(false);
  });
});
