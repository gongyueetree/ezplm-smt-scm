/**
 * N-12:损耗报告的金额维度与多月比较。
 *
 * 守的核心是**缺标准价不当 0**:损耗最严重的料往往正是没人维护主数据的那些,
 * 按 0 算会让金额凭空变小,把问题掩盖掉。
 */
import { describe, expect, it } from "vitest";
import {
  buildPeriodTrend,
  groupScrapWithAmount,
  recentPeriods,
  UNKNOWN_KEY,
  type ScrapRow,
  type StandardCostLookup,
} from "@/lib/domain/scrap-report";

function row(p: Partial<ScrapRow>): ScrapRow {
  return {
    period: "2026-07",
    customerId: "C1",
    workOrder: null,
    mpn: "MPN-A",
    issuedQty: "1000",
    scrapQty: "10",
    reason: null,
    ...p,
  };
}

const priced: StandardCostLookup = (mpn) =>
  mpn === "MPN-A" ? { unitCost: "2.5", currency: "CNY" } : null;

describe("金额维度", () => {
  it("损耗金额 = 报废数量 × 标准价", () => {
    const [g] = groupScrapWithAmount([row({ scrapQty: "10" })], "mpn", priced);
    expect(g.scrapAmount).toBe("25.00");
    expect(g.currency).toBe("CNY");
  });

  it("**没维护标准价时金额为 null,不是 0**", () => {
    const [g] = groupScrapWithAmount([row({ mpn: "MPN-NOCOST" })], "mpn", priced);
    expect(g.scrapAmount).toBeNull();
    expect(g.rowsWithoutCost).toBe(1);
    // 数量维度照常有值 —— 缺价只影响金额
    expect(g.scrapQty).toBe("10");
  });

  it("部分有价时,缺价的行数单独报出来,不混进金额", () => {
    const [g] = groupScrapWithAmount(
      [row({ mpn: "MPN-A", scrapQty: "10" }), row({ mpn: "MPN-A", scrapQty: "10" })],
      "customerId",
      priced,
    );
    expect(g.scrapAmount).toBe("50.00");
    expect(g.rowsWithoutCost).toBe(0);
  });

  it("组内混币种时不做换算合计,金额置 null 并标 mixedCurrency", () => {
    const mixed: StandardCostLookup = (mpn) =>
      mpn === "MPN-A"
        ? { unitCost: "2.5", currency: "CNY" }
        : { unitCost: "1", currency: "USD" };
    const [g] = groupScrapWithAmount(
      [row({ mpn: "MPN-A" }), row({ mpn: "MPN-B" })],
      "customerId",
      mixed,
    );
    expect(g.mixedCurrency).toBe(true);
    expect(g.scrapAmount).toBeNull();
  });

  it("金额用 Decimal,小数不丢精度", () => {
    const l: StandardCostLookup = () => ({ unitCost: "0.1", currency: "CNY" });
    const [g] = groupScrapWithAmount([row({ scrapQty: "3" })], "mpn", l);
    expect(g.scrapAmount).toBe("0.30");
  });
});

describe("多月比较", () => {
  const rows = [
    row({ period: "2026-05", mpn: "MPN-A", issuedQty: "1000", scrapQty: "10" }),
    row({ period: "2026-06", mpn: "MPN-A", issuedQty: "1000", scrapQty: "20" }),
    row({ period: "2026-07", mpn: "MPN-A", issuedQty: "1000", scrapQty: "50" }),
  ];

  it("行=物料,列=期间,按给定期间顺序排", () => {
    const t = buildPeriodTrend(rows, "mpn", ["2026-05", "2026-06", "2026-07"]);
    expect(t[0].cells.map((c) => c.period)).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(t[0].cells.map((c) => c.scrapQty)).toEqual(["10", "20", "50"]);
  });

  it("**数据里没有的月份也要出现在表里** —— 空月份是信息,不能被省掉", () => {
    const t = buildPeriodTrend(rows, "mpn", ["2026-04", "2026-05", "2026-06", "2026-07"]);
    expect(t[0].cells).toHaveLength(4);
    expect(t[0].cells[0]).toMatchObject({ period: "2026-04", scrapQty: "0", scrapRate: null });
  });

  it("环比给百分点差:2% → 5% 即 +3.00", () => {
    const t = buildPeriodTrend(rows, "mpn", ["2026-06", "2026-07"]);
    expect(t[0].rateDeltaPoints).toBe("3.00");
  });

  it("**任一期损耗率未知时不算环比**,不拿 0 当基准", () => {
    const t = buildPeriodTrend(
      [
        row({ period: "2026-06", issuedQty: "0", scrapQty: "5" }),
        row({ period: "2026-07", issuedQty: "1000", scrapQty: "10" }),
      ],
      "mpn",
      ["2026-06", "2026-07"],
    );
    expect(t[0].cells[0].scrapRate).toBeNull();
    expect(t[0].rateDeltaPoints).toBeNull();
  });

  it("维度值为空归入未知档,并排在最后", () => {
    const t = buildPeriodTrend(
      [row({ customerId: "C1", scrapQty: "1" }), row({ customerId: null, scrapQty: "999" })],
      "customerId",
      ["2026-07"],
    );
    expect(t[t.length - 1].key).toBe(UNKNOWN_KEY);
    expect(t[t.length - 1].isUnknown).toBe(true);
  });

  it("带标准价时每格也给金额", () => {
    const t = buildPeriodTrend(rows, "mpn", ["2026-07"], priced);
    expect(t[0].cells[0].scrapAmount).toBe("125.00");
  });
});

describe("recentPeriods", () => {
  it("生成最近 N 期并跨年回退", () => {
    expect(recentPeriods("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("格式不对时退回单期,不抛错", () => {
    expect(recentPeriods("乱写", 3)).toEqual(["乱写"]);
  });
});
