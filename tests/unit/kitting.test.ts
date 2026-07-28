import { describe, expect, it } from "vitest";
import {
  calculateKitting,
  deriveShortageList,
  type KittingLineInput,
} from "@/lib/domain/kitting";

function line(patch: Partial<KittingLineInput>): KittingLineInput {
  return {
    lineNo: 1,
    refDes: "R1",
    mpn: "RC0603FR-0710KL",
    manufacturer: "Yageo",
    qtyPerBoard: 2,
    stockQty: 10000,
    inTransitQty: 0,
    eta: null,
    ...patch,
  };
}

describe("齐料检查:需求与缺口", () => {
  it("需求 = 单板用量 × 台数(含损耗向上取整)", () => {
    const r = calculateKitting([line({ qtyPerBoard: 2 })], { boards: 100 });
    expect(r.lines[0].requiredQty).toBe(200);

    const withScrap = calculateKitting([line({ qtyPerBoard: 3 })], {
      boards: 100,
      scrapRate: "0.02",
    });
    // 300 × 1.02 = 306
    expect(withScrap.lines[0].requiredQty).toBe(306);
  });

  it("库存充足判为可齐料", () => {
    const r = calculateKitting([line({ stockQty: 10000 })], { boards: 100 });
    expect(r.lines[0].status).toBe("ready");
    expect(r.lines[0].shortageQty).toBe(0);
  });

  it("库存不足按缺口计并给出建议采购量(经 MOQ/SPQ 圆整)", () => {
    const r = calculateKitting(
      [line({ qtyPerBoard: 10, stockQty: 100, inTransitQty: 0, moq: 500, spq: 500 })],
      { boards: 100 },
    );
    // 需求 1000,库存 100 → 缺口 900 → MOQ 500 不影响 → SPQ 500 圆整 → 1000
    expect(r.lines[0].shortageQty).toBe(900);
    expect(r.lines[0].suggestedPurchaseQty).toBe(1000);
    expect(r.lines[0].status).toBe("short");
  });

  it("在途参与扣减", () => {
    const r = calculateKitting(
      [line({ qtyPerBoard: 10, stockQty: 100, inTransitQty: 900 })],
      { boards: 100 },
    );
    expect(r.lines[0].shortageQty).toBe(0);
    expect(r.lines[0].status).toBe("ready");
  });

  it("损耗率恒标注待甲方确认", () => {
    const r = calculateKitting([line({})], { boards: 10 });
    expect(r.summary.scrapRateConfirmed).toBe(false);
  });
});

describe("数据未知不得当作有货(诚实纪律)", () => {
  it("库存未知 → 状态 unknown,缺口为 null 而不是 0", () => {
    const r = calculateKitting([line({ stockQty: null })], { boards: 100 });
    expect(r.lines[0].status).toBe("unknown");
    expect(r.lines[0].shortageQty).toBeNull();
    expect(r.lines[0].suggestedPurchaseQty).toBeNull();
  });

  it("在途未知同样判为 unknown", () => {
    const r = calculateKitting([line({ inTransitQty: null })], { boards: 100 });
    expect(r.lines[0].status).toBe("unknown");
  });

  it("unknown 行不计入可齐料,齐套率如实下降", () => {
    const r = calculateKitting(
      [line({ lineNo: 1 }), line({ lineNo: 2, stockQty: null })],
      { boards: 10 },
    );
    expect(r.summary.readyLines).toBe(1);
    expect(r.summary.unknownLines).toBe(1);
    expect(r.summary.kitRate).toBe(0.5);
  });
});

describe("齐料日期:不用已知 ETA 冒充预计齐料日", () => {
  it("全部可齐料时无需齐料日期", () => {
    const r = calculateKitting([line({})], { boards: 10 });
    expect(r.summary.shortLines).toBe(0);
    expect(r.summary.readyDate).toBeNull();
    expect(r.summary.readyDateBlockedBy).toBeNull();
  });

  it("所有缺口行都有 ETA → 取最大值", () => {
    const r = calculateKitting(
      [
        line({ lineNo: 1, qtyPerBoard: 10, stockQty: 0, eta: "2026-08-10T00:00:00.000Z" }),
        line({ lineNo: 2, qtyPerBoard: 10, stockQty: 0, eta: "2026-08-25T00:00:00.000Z" }),
      ],
      { boards: 100 },
    );
    expect(r.summary.readyDate).toBe("2026-08-25T00:00:00.000Z");
  });

  it("任一缺口行无 ETA → 整单齐料日期未知,并说明原因", () => {
    const r = calculateKitting(
      [
        line({ lineNo: 1, qtyPerBoard: 10, stockQty: 0, eta: "2026-08-10T00:00:00.000Z" }),
        line({ lineNo: 2, qtyPerBoard: 10, stockQty: 0, eta: null }),
      ],
      { boards: 100 },
    );
    expect(r.summary.readyDate).toBeNull();
    expect(r.summary.readyDateBlockedBy).toContain("无在途 ETA");
  });

  it("存在数据未知行时齐料日期一律未知", () => {
    const r = calculateKitting(
      [
        line({ lineNo: 1, qtyPerBoard: 10, stockQty: 0, eta: "2026-08-10T00:00:00.000Z" }),
        line({ lineNo: 2, stockQty: null }),
      ],
      { boards: 100 },
    );
    expect(r.summary.readyDate).toBeNull();
    expect(r.summary.readyDateBlockedBy).toContain("数据未知");
  });
});

describe("缺料清单(Call 料表)", () => {
  it("只列缺口与未知行,未知排最前,其余按缺口降序", () => {
    const r = calculateKitting(
      [
        line({ lineNo: 1 }), // ready
        line({ lineNo: 2, qtyPerBoard: 10, stockQty: 0 }), // 缺 1000
        line({ lineNo: 3, qtyPerBoard: 5, stockQty: 0 }), // 缺 500
        line({ lineNo: 4, stockQty: null }), // unknown
      ],
      { boards: 100 },
    );
    const list = deriveShortageList(r);
    expect(list.map((l) => l.lineNo)).toEqual([4, 2, 3]);
  });

  it("空 BOM 安全", () => {
    const r = calculateKitting([], { boards: 100 });
    expect(r.summary.kitRate).toBeNull();
    expect(deriveShortageList(r)).toEqual([]);
  });
});
