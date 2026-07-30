import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCRAP_COLUMNS,
  groupScrap,
  renderScrapRow,
  summarizeScrap,
  UNKNOWN_KEY,
  type ScrapRow,
} from "@/lib/domain/scrap-report";

function row(over: Partial<ScrapRow> = {}): ScrapRow {
  return {
    period: "2026-07",
    customerId: "C1",
    workOrder: "WO-1",
    mpn: "STM32F103C8T6",
    issuedQty: "1000",
    scrapQty: "10",
    reason: "上料错误",
    ...over,
  };
}

describe("summarizeScrap", () => {
  it("合计与整体损耗率", () => {
    const s = summarizeScrap([row(), row({ issuedQty: "1000", scrapQty: "30" })]);
    expect(s.totalIssued).toBe("2000");
    expect(s.totalScrap).toBe("40");
    expect(s.overallRate).toBe("0.02");
  });

  it("**发料为 0 时损耗率是 null,不是 0%**", () => {
    const s = summarizeScrap([row({ issuedQty: "0", scrapQty: "5" })]);
    expect(s.overallRate).toBeNull();
  });

  it("**发料 0 却有报废的行数单独暴露** —— 这类最容易被平均值掩盖", () => {
    const s = summarizeScrap([row(), row({ issuedQty: "0", scrapQty: "5" })]);
    expect(s.zeroIssuedWithScrap).toBe(1);
  });

  it("空数据不报错", () => {
    expect(summarizeScrap([])).toMatchObject({ totalScrap: "0", overallRate: null, rowCount: 0 });
  });
});

describe("groupScrap", () => {
  it("按 MPN 汇总,损耗量大的排前面", () => {
    const g = groupScrap(
      [
        row({ mpn: "A", scrapQty: "5" }),
        row({ mpn: "B", scrapQty: "50" }),
        row({ mpn: "A", scrapQty: "5" }),
      ],
      "mpn",
    );
    expect(g[0].key).toBe("B");
    expect(g[1]).toMatchObject({ key: "A", scrapQty: "10", rowCount: 2 });
  });

  it("**该维度未填的单列一档,且永远排最后**", () => {
    const g = groupScrap(
      [row({ reason: null, scrapQty: "999" }), row({ reason: "上料错误", scrapQty: "1" })],
      "reason",
    );
    expect(g[g.length - 1].key).toBe(UNKNOWN_KEY);
    expect(g[g.length - 1].isUnknown).toBe(true);
    // 未知档虽然量最大,也不许挤到前面掩盖真正可归因的项
    expect(g[0].key).toBe("上料错误");
  });

  it("分组内分母为 0 时该组损耗率为 null", () => {
    const g = groupScrap([row({ mpn: "X", issuedQty: "0", scrapQty: "3" })], "mpn");
    expect(g[0].scrapRate).toBeNull();
  });

  it("空白字符串按未填处理,不生成一个空 key 的组", () => {
    const g = groupScrap([row({ customerId: "   " })], "customerId");
    expect(g[0].key).toBe(UNKNOWN_KEY);
  });
});

describe("renderScrapRow:按模板导出", () => {
  it("默认模板输出全部列,损耗率带百分号", () => {
    const cells = renderScrapRow(row(), DEFAULT_SCRAP_COLUMNS);
    expect(cells).toContain("2026-07");
    expect(cells).toContain("1.00%");
  });

  it("**损耗率不可算时写「不可算」而不是 0%**", () => {
    const cells = renderScrapRow(row({ issuedQty: "0" }), DEFAULT_SCRAP_COLUMNS);
    expect(cells.join("|")).toContain("不可算(发料为 0)");
    expect(cells.join("|")).not.toContain("0.00%");
  });

  it("自定义模板只输出选中的列,顺序按模板", () => {
    const cells = renderScrapRow(row(), [
      { field: "mpn", header: "料号" },
      { field: "scrapQty", header: "报废" },
    ]);
    expect(cells).toEqual(["STM32F103C8T6", "10"]);
  });

  it("空值输出空字符串而不是 null 字面量", () => {
    const cells = renderScrapRow(row({ workOrder: null }), [
      { field: "workOrder", header: "工单" },
    ]);
    expect(cells).toEqual([""]);
  });
});
