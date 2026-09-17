/**
 * REF-0.8:通用列映射引擎的直接单测。
 *
 * 这个文件此前**不存在** —— 引擎有 7 个消费者(bom-parse / supplier-quote-parse /
 * supplier-offer-import / recon-parse / po-bulk-input / trace-import / alternate-bulk …),
 * 却只有透过它们的间接覆盖。REF-2 要在它上面重建 BOM 归一管线,
 * 没有直接基线就没法做 Golden Master 对拍(改了行为也看不出来)。
 *
 * 锁的是**文件头自己写下的纪律**,不是实现细节:
 * - 精确相等恒高于"包含";
 * - 同义词与列名走同一套归一化(否则含标点的同义词永远匹配不上);
 * - 一列只能占一个字段;
 * - 表头不一定在第一行。
 */
import { describe, expect, it } from "vitest";
import {
  cellText,
  detectMapping,
  missingFields,
  normalizeHeader,
  scoreFieldForCell,
} from "@/lib/domain/column-mapping";

type F = "mpn" | "qty" | "manufacturer";

const SYN: Record<F, readonly string[]> = {
  mpn: ["mpn", "制造商料号", "型号"],
  qty: ["qty", "数量", "q'ty", "qty/pcs"],
  manufacturer: ["manufacturer", "制造商", "厂商"],
};

describe("normalizeHeader", () => {
  it("小写 + 去空白与标点", () => {
    expect(normalizeHeader("  MPN  ")).toBe("mpn");
    expect(normalizeHeader("Part_Number")).toBe("partnumber");
    expect(normalizeHeader("Qty (pcs)")).toBe("qtypcs");
  });

  it("撇号必须被去掉 —— Q'ty 是 Altium/国内 EMS 模板极常见的写法", () => {
    // E1a 现场:归一化没去撇号 → q'ty 匹配不上 qty → 数量列缺失 → **整份文件 422 被拒**
    expect(normalizeHeader("Q'ty")).toBe("qty");
    expect(normalizeHeader("Q’ty")).toBe("qty"); // 全角/智能撇号
  });

  it("全角括号、中文顿号逗号、斜杠都要去掉", () => {
    expect(normalizeHeader("数量(个)")).toBe("数量个");
    expect(normalizeHeader("qty/pcs")).toBe("qtypcs");
    expect(normalizeHeader("料号、型号")).toBe("料号型号");
    expect(normalizeHeader("【备注】")).toBe("备注");
  });

  it("中文本身不被剥掉(与 MPN 归一键不同,这里只去标点)", () => {
    expect(normalizeHeader("制造商料号")).toBe("制造商料号");
  });
});

describe("scoreFieldForCell", () => {
  it("精确相等 = 10000 - 同义词序号:排在前面的同义词更优先", () => {
    expect(scoreFieldForCell("mpn", SYN.mpn)).toBe(10_000);
    expect(scoreFieldForCell("制造商料号", SYN.mpn)).toBe(9_999);
    expect(scoreFieldForCell("型号", SYN.mpn)).toBe(9_998);
  });

  it("包含匹配 = 1000 + 同义词长度:越长越具体", () => {
    expect(scoreFieldForCell("客户mpn编码", SYN.mpn)).toBe(1_000 + "mpn".length);
    expect(scoreFieldForCell("制造商料号备注", SYN.mpn)).toBe(1_000 + "制造商料号".length);
  });

  it("无匹配返回 0", () => {
    expect(scoreFieldForCell("位号", SYN.mpn)).toBe(0);
    expect(scoreFieldForCell("", SYN.mpn)).toBe(0);
  });

  it("**同义词也要过归一化** —— 含标点的同义词否则永远匹配不上", () => {
    // SYN.qty 里写的是 "q'ty" 与 "qty/pcs";列名归一后是 qty / qtypcs
    expect(scoreFieldForCell("qty", SYN.qty)).toBeGreaterThan(0);
    expect(scoreFieldForCell("qtypcs", SYN.qty)).toBeGreaterThan(0);
  });
});

describe("detectMapping:核心纪律", () => {
  it("**精确恒高于包含** —— 制造商料号 不被 制造商 抢走", () => {
    // 这是 PR5 的真实教训:抢走后 MPN 列丢失,整张 BOM 匹配不上
    const m = detectMapping<F>([["制造商", "制造商料号", "数量"]], SYN, ["mpn", "qty"]);
    expect(m.fields.manufacturer).toBe(0);
    expect(m.fields.mpn).toBe(1);
    expect(m.fields.qty).toBe(2);
  });

  it("一列只能占一个字段", () => {
    // 显式给出 F,否则 requiredFields 会把结果类型窄成 Partial<Record<"mpn", number>>
    const m = detectMapping<F>([["制造商料号"]], SYN, ["mpn"]);
    expect(m.fields.mpn).toBe(0);
    expect(m.fields.manufacturer).toBeUndefined();
  });

  it("表头不在第一行:前几行是标题/客户信息时仍能找到", () => {
    const m = detectMapping(
      [
        ["某某电子 BOM 表", "", ""],
        ["客户:XX", "日期:2026-09-18", ""],
        ["MPN", "数量", "制造商"],
        ["STM32F103", "100", "ST"],
      ],
      SYN,
      ["mpn", "qty"],
    );
    expect(m.headerRowIndex).toBe(2);
    expect(m.fields.mpn).toBe(0);
  });

  it("超出 maxScanRows 的表头**不会**被找到(扫描窗口是显式契约)", () => {
    const rows = [
      ...Array.from({ length: 12 }, () => ["说明", "", ""]),
      ["MPN", "数量", "制造商"],
    ];
    expect(detectMapping(rows, SYN, ["mpn"], 10).confidence).toBe(0);
    expect(detectMapping(rows, SYN, ["mpn"], 20).headerRowIndex).toBe(12);
  });

  it("必需字段命中率占 0.7,识别覆盖率占 0.3;全中即 1", () => {
    const all = detectMapping([["MPN", "数量", "制造商"]], SYN, ["mpn", "qty"]);
    expect(all.confidence).toBe(1);

    // 只命中 1/2 必需 + 1/3 字段 → 0.5*0.7 + (1/3)*0.3 = 0.45
    const half = detectMapping([["MPN", "位号"]], SYN, ["mpn", "qty"]);
    expect(half.confidence).toBeCloseTo(0.45, 4);
  });

  it("一个字段都识别不出 → confidence 0,不瞎认一行当表头", () => {
    const m = detectMapping([["甲", "乙"], ["丙", "丁"]], SYN, ["mpn"]);
    expect(m.confidence).toBe(0);
    expect(m.fields).toEqual({});
  });

  it("未映射的非空列如实列出(供 UI 告诉人「这几列我没认出来」)", () => {
    const m = detectMapping([["MPN", "位号", "", "封装"]], SYN, ["mpn"]);
    expect(m.unmapped.map((u) => u.header)).toEqual(["位号", "封装"]);
  });

  it("结果确定:同一输入多次调用完全一致(对拍的前提)", () => {
    const rows = [["制造商", "制造商料号", "数量", "厂商"]];
    const a = detectMapping(rows, SYN, ["mpn", "qty"]);
    const b = detectMapping(rows, SYN, ["mpn", "qty"]);
    expect(a).toEqual(b);
  });

  it("空表 / 空行不炸", () => {
    expect(detectMapping([], SYN, ["mpn"]).confidence).toBe(0);
    expect(detectMapping([[]], SYN, ["mpn"]).confidence).toBe(0);
  });
});

describe("missingFields", () => {
  it("列出没映射到的必需字段", () => {
    const m = detectMapping([["MPN"]], SYN, ["mpn", "qty"]);
    expect(missingFields(m, ["mpn", "qty"])).toEqual(["qty"]);
  });

  it("全部命中 → 空数组", () => {
    const m = detectMapping([["MPN", "数量"]], SYN, ["mpn", "qty"]);
    expect(missingFields(m, ["mpn", "qty"])).toEqual([]);
  });
});

describe("cellText:空串归一为 null(空 ≠ 空串,更 ≠ 0)", () => {
  it("trim 后为空一律 null", () => {
    expect(cellText(["  "], 0)).toBeNull();
    expect(cellText([""], 0)).toBeNull();
  });

  it("越界 / 无行 / 无列索引都返回 null,不抛", () => {
    expect(cellText(["a"], 5)).toBeNull();
    expect(cellText(undefined, 0)).toBeNull();
    expect(cellText(["a"], undefined)).toBeNull();
  });

  it("正常值 trim 后返回", () => {
    expect(cellText([" STM32 "], 0)).toBe("STM32");
    // "0" 是合法内容,不能被当成空
    expect(cellText(["0"], 0)).toBe("0");
  });
});
