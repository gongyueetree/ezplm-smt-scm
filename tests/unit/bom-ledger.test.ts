import { describe, expect, it } from "vitest";
import {
  daysSinceUpdate,
  deriveBomLedgerKpi,
  riskTone,
  type BomLedgerRow,
} from "@/lib/domain/bom-ledger";

const TODAY = "2026-07-30";

function row(over: Partial<BomLedgerRow> = {}): BomLedgerRow {
  return {
    bomId: "b1",
    name: "BOM-1",
    customerId: "c1",
    latestVersionAt: "2026-07-20",
    lineCount: 10,
    eolLineCount: 0,
    unknownLifecycleLineCount: 0,
    unconfirmedLineCount: 0,
    noCandidateLineCount: 0,
    ...over,
  };
}

describe("daysSinceUpdate", () => {
  it("按天算差", () => {
    expect(daysSinceUpdate("2026-07-20", TODAY)).toBe(10);
  });

  it("**无版本返回 null,不当作 0 天** —— 否则从没出过版本的 BOM 会显示得最新鲜", () => {
    expect(daysSinceUpdate(null, TODAY)).toBeNull();
  });

  it("日期非法返回 null", () => {
    expect(daysSinceUpdate("不是日期", TODAY)).toBeNull();
  });
});

describe("deriveBomLedgerKpi", () => {
  it("EOL 占用:统计 BOM 数与行数,并给出可下钻的 id 列表", () => {
    const k = deriveBomLedgerKpi(
      [
        row({ bomId: "a", eolLineCount: 2 }),
        row({ bomId: "b", eolLineCount: 1 }),
        row({ bomId: "c" }),
      ],
      { today: TODAY },
    );
    expect(k.eolAffected.count).toBe(2);
    expect(k.eolAffected.lineCount).toBe(3);
    expect(k.eolAffected.bomIds).toEqual(["a", "b"]);
  });

  it("**生命周期未知不算 EOL**,但未知行数要单独暴露(说明指标覆盖面)", () => {
    const k = deriveBomLedgerKpi(
      [row({ bomId: "a", eolLineCount: 0, unknownLifecycleLineCount: 7 })],
      { today: TODAY },
    );
    expect(k.eolAffected.count).toBe(0);
    expect(k.unknownLifecycleLines).toBe(7);
  });

  it("超期未更新:按口径天数判定,边界日不算超期", () => {
    const rows = [
      row({ bomId: "old", latestVersionAt: "2026-01-01" }),
      row({ bomId: "edge", latestVersionAt: "2026-05-01" }), // 恰好 90 天
      row({ bomId: "fresh", latestVersionAt: "2026-07-29" }),
    ];
    const k = deriveBomLedgerKpi(rows, { today: TODAY });
    expect(k.stale.bomIds).toEqual(["old"]);
    expect(k.stale.staleDays).toBe(90);
  });

  it("超期口径可配", () => {
    const k = deriveBomLedgerKpi([row({ latestVersionAt: "2026-07-20" })], {
      today: TODAY,
      staleDays: 5,
    });
    expect(k.stale.count).toBe(1);
  });

  it("**从未出过版本的 BOM 单列**,不混进超期,也不混进新鲜", () => {
    const k = deriveBomLedgerKpi([row({ bomId: "nv", latestVersionAt: null })], { today: TODAY });
    expect(k.stale.count).toBe(0);
    expect(k.noVersion.count).toBe(1);
    expect(k.noVersion.bomIds).toEqual(["nv"]);
  });

  it("待确认与无候选各自统计 BOM 数与行数", () => {
    const k = deriveBomLedgerKpi(
      [
        row({ bomId: "a", unconfirmedLineCount: 42, noCandidateLineCount: 8 }),
        row({ bomId: "b", unconfirmedLineCount: 1 }),
      ],
      { today: TODAY },
    );
    expect(k.unconfirmed).toMatchObject({ count: 2, lineCount: 43 });
    expect(k.noCandidate).toMatchObject({ count: 1, lineCount: 8, bomIds: ["a"] });
  });

  it("空台账返回全零而不是抛错", () => {
    const k = deriveBomLedgerKpi([], { today: TODAY });
    expect(k.totalBoms).toBe(0);
    expect(k.eolAffected.bomIds).toEqual([]);
  });
});

describe("riskTone:风险色标", () => {
  it("0 正常;有即告警;达阈值转红", () => {
    expect(riskTone(0)).toBe("ok");
    expect(riskTone(3, 5)).toBe("warn");
    expect(riskTone(5, 5)).toBe("danger");
  });

  it("缺省阈值下只要有就是红(高风险项不允许留白底)", () => {
    expect(riskTone(1)).toBe("danger");
  });
});
