/**
 * R4-7(§42/§55):线下 RFQ Excel 往返(纯函数)。
 * 多阶梯聚合/放弃行跳过/非法值报错/阶梯重复拒绝/换型报价保留。
 */
import { describe, expect, it } from "vitest";
import { RFQ_EXPORT_HEADERS, buildRfqExportRows, parseQuoteRows } from "@/lib/domain/rfq-excel";

function row(rowNo: number, over: Record<string, string>) {
  const cells: Record<string, string> = {};
  for (const h of RFQ_EXPORT_HEADERS) cells[h] = "";
  return { rowNo, cells: { ...cells, ...over } };
}

describe("导出", () => {
  it("导出行含询价七要素 + 供应商填写区空列(§42)", () => {
    const rows = buildRfqExportRows([
      { rfqNo: "PRFQ-1", supplierName: "供应商A", internalPn: "PN-1", mpn: "MPN-1", manufacturer: "Murata", description: "0402 电容", requestedQty: "800" },
    ]);
    expect(rows[0]).toEqual([...RFQ_EXPORT_HEADERS]);
    expect(rows[1].slice(0, 7)).toEqual(["PRFQ-1", "供应商A", "PN-1", "MPN-1", "Murata", "0402 电容", "800"]);
  });
});

describe("回传解析(§55-29/30)", () => {
  it("一颗料多档阶梯 = 多行聚合为一组多 break(绝不只留最低价)", () => {
    const { groups, issues } = parseQuoteRows([
      row(2, { "Internal PN": "PN-1", MPN: "MPN-1", "Quoted MPN": "MPN-1", "Price Break Qty": "100", "Unit Price": "1.50", Currency: "CNY", MOQ: "100", "Lead Time (days)": "7" }),
      row(3, { "Internal PN": "PN-1", MPN: "MPN-1", "Quoted MPN": "MPN-1", "Price Break Qty": "500", "Unit Price": "1.30", Currency: "CNY" }),
      row(4, { "Internal PN": "PN-1", MPN: "MPN-1", "Quoted MPN": "MPN-1", "Price Break Qty": "1000", "Unit Price": "1.20", Currency: "CNY" }),
    ]);
    expect(issues).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0].breaks.map((b) => [b.minQty, b.unitPrice])).toEqual([
      ["100", "1.50"],
      ["500", "1.30"],
      ["1000", "1.20"],
    ]);
    expect(groups[0].moq).toBe("100");
    expect(groups[0].leadTimeDays).toBe(7);
  });

  it("放弃报价的行(无 Quoted MPN 且无价)跳过不报错;有价缺币种/非法价报 issue", () => {
    const { groups, issues, skippedRows } = parseQuoteRows([
      row(2, { "Internal PN": "PN-1", MPN: "MPN-1" }), // 放弃
      row(3, { "Internal PN": "PN-2", "Quoted MPN": "X1", "Price Break Qty": "100", "Unit Price": "abc", Currency: "CNY" }),
      row(4, { "Internal PN": "PN-3", "Quoted MPN": "X2", "Price Break Qty": "100", "Unit Price": "2.0", Currency: "RMB元" }),
    ]);
    expect(skippedRows).toBe(1);
    expect(groups).toHaveLength(0);
    expect(issues.map((i) => i.row)).toEqual([3, 4]);
  });

  it("同组阶梯数量重复 → issue(不猜哪档算数);币种前后不一致 → issue", () => {
    const { groups, issues } = parseQuoteRows([
      row(2, { "Internal PN": "PN-1", "Quoted MPN": "M1", "Price Break Qty": "100", "Unit Price": "1.5", Currency: "CNY" }),
      row(3, { "Internal PN": "PN-1", "Quoted MPN": "M1", "Price Break Qty": "100", "Unit Price": "1.4", Currency: "CNY" }),
      row(4, { "Internal PN": "PN-1", "Quoted MPN": "M1", "Price Break Qty": "500", "Unit Price": "1.3", Currency: "USD" }),
    ]);
    expect(groups[0].breaks).toHaveLength(1);
    expect(issues.some((i) => i.message.includes("重复"))).toBe(true);
    expect(issues.some((i) => i.message.includes("币种前后不一致"))).toBe(true);
  });

  it("换型报价:Quoted MPN ≠ 询价 MPN 时按 quoted 分组并保留 requestedMpn(§55-54 前提)", () => {
    const { groups } = parseQuoteRows([
      row(2, { "Internal PN": "PN-1", MPN: "OLD-MPN", "Quoted MPN": "NEW-MPN", "Quoted Manufacturer": "YAGEO", "Price Break Qty": "100", "Unit Price": "0.9", Currency: "CNY" }),
    ]);
    expect(groups[0].quotedMpn).toBe("NEW-MPN");
    expect(groups[0].requestedMpn).toBe("OLD-MPN");
    expect(groups[0].quotedManufacturer).toBe("YAGEO");
  });

  it("未换型时 Quoted MPN 缺省沿用询价 MPN", () => {
    const { groups } = parseQuoteRows([
      row(2, { "Internal PN": "PN-1", MPN: "MPN-1", "Price Break Qty": "100", "Unit Price": "1.0", Currency: "CNY" }),
    ]);
    expect(groups[0].quotedMpn).toBe("MPN-1");
  });
});
