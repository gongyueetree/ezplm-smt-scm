/**
 * N-9:供应商预设批量导入的解析。
 *
 * 最要紧的是**不静默丢行** —— 少一档阶梯价会直接改变比价结论,
 * 而人以为自己已经导进去了(D-2 修的就是同类问题的页面版)。
 */
import { describe, expect, it } from "vitest";
import { parseSupplierOfferGrid } from "@/lib/domain/supplier-offer-import";

const HEAD = ["供应商编码", "MPN", "制造商", "币种", "MOQ", "SPQ", "交期", "起订数量", "单价"];

describe("按(供应商 + MPN)聚合阶梯价", () => {
  it("同一料的多行合成一组,并按起订数量升序", () => {
    const r = parseSupplierOfferGrid([
      HEAD,
      ["SUP-A", "STM32", "ST", "CNY", "100", "100", "21", "1000", "11.8"],
      ["SUP-A", "STM32", "ST", "CNY", "100", "100", "21", "1", "12.5"],
    ]);
    expect(r.errors).toEqual([]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].priceBreaks.map((b) => b.minQty)).toEqual([1, 1000]);
    expect(r.groups[0].moq).toBe(100);
  });

  it("不同供应商同一料是两组,不会串到一起", () => {
    const r = parseSupplierOfferGrid([
      HEAD,
      ["SUP-A", "STM32", "ST", "CNY", "", "", "", "1", "12.5"],
      ["SUP-B", "STM32", "ST", "CNY", "", "", "", "1", "11.0"],
    ]);
    expect(r.groups).toHaveLength(2);
  });
});

describe("**不静默丢行**", () => {
  it("起订数量非正 → 带行号报错,不跳过", () => {
    const r = parseSupplierOfferGrid([
      HEAD,
      ["SUP-A", "STM32", "", "", "", "", "", "0", "12.5"],
    ]);
    expect(r.errors[0].row).toBe(2);
    expect(r.errors[0].message).toContain("起订数量");
  });

  it("单价为空 → 带行号报错", () => {
    const r = parseSupplierOfferGrid([HEAD, ["SUP-A", "STM32", "", "", "", "", "", "1", ""]]);
    expect(r.errors[0].message).toContain("单价");
  });

  it("供应商编码或 MPN 缺失 → 报错", () => {
    const r = parseSupplierOfferGrid([HEAD, ["", "STM32", "", "", "", "", "", "1", "1"]]);
    expect(r.errors[0].message).toContain("不能为空");
  });

  it("同组起订数量重复 → 报错并指出先前出现的行,不让后一档覆盖前一档", () => {
    const r = parseSupplierOfferGrid([
      HEAD,
      ["SUP-A", "STM32", "", "CNY", "", "", "", "100", "12.5"],
      ["SUP-A", "STM32", "", "CNY", "", "", "", "100", "9.9"],
    ]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toContain("重复");
    expect(r.errors[0].message).toContain("第 2 行");
    // 前一档必须原样保留
    expect(r.groups[0].priceBreaks).toEqual([{ minQty: 100, unitPrice: "12.5" }]);
  });

  it("组内币种前后不一致 → 报错,而不是悄悄用第一条", () => {
    const r = parseSupplierOfferGrid([
      HEAD,
      ["SUP-A", "STM32", "", "CNY", "", "", "", "1", "12.5"],
      ["SUP-A", "STM32", "", "USD", "", "", "", "1000", "1.7"],
    ]);
    expect(r.errors[0].message).toContain("币种");
  });
});

describe("列识别", () => {
  it("缺必需列时说清缺哪几列(用中文标签,不甩内部字段名)", () => {
    const r = parseSupplierOfferGrid([["供应商编码", "MPN"], ["SUP-A", "STM32"]]);
    expect(r.groups).toEqual([]);
    expect(r.errors[0].message).toContain("起订数量");
    expect(r.errors[0].message).toContain("单价");
    expect(r.errors[0].message).not.toContain("minQty");
  });

  it("表头同义词可识别(英文/别名)", () => {
    const r = parseSupplierOfferGrid([
      ["supplier", "PN", "qty", "price"],
      ["SUP-A", "STM32", "1", "12.5"],
    ]);
    expect(r.errors).toEqual([]);
    expect(r.groups[0].supplierCode).toBe("SUP-A");
  });

  it("币种缺省为 CNY 并大写归一", () => {
    const r = parseSupplierOfferGrid([
      ["供应商编码", "MPN", "起订数量", "单价", "币种"],
      ["SUP-A", "STM32", "1", "12.5", "usd"],
      ["SUP-B", "STM32", "1", "12.5", ""],
    ]);
    expect(r.groups.find((g) => g.supplierCode === "SUP-A")!.currency).toBe("USD");
    expect(r.groups.find((g) => g.supplierCode === "SUP-B")!.currency).toBe("CNY");
  });

  it("空表格如实报错,不返回空成功", () => {
    expect(parseSupplierOfferGrid([]).errors[0].message).toContain("未能解析出表格");
  });
});
