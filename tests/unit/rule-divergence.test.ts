/**
 * REF-1a:归一规则差异测量。
 *
 * 这不是"又一组断言",而是 **REF-1c 切换决策的输入**:
 * 归一键同时是匹配键与唯一约束键,换规则会动匹配结果、要重算全表、还可能撞键。
 * 这里用有代表性的样本把差异固定下来,真实数据上的量级见
 * tests/uat/qianchuang/rule-divergence.uat.test.ts。
 */
import { describe, expect, it } from "vitest";
import {
  compareManufacturerKeyRules,
  compareMpnKeyRules,
  LEGACY_MANUFACTURER_RULES,
  LEGACY_MPN_RULES,
  manufacturerDisplayDivergence,
  newCollisionsVsLegacy,
  summarizeDivergence,
} from "@/modules/parts/domain/rule-divergence";
import { manufacturerKey } from "@/modules/parts/domain/manufacturer-registry";

/** 覆盖真实数据里出现过的形态(合成样本,非客户数据) */
const MPN_SAMPLES = [
  "GRM188R71H104KA93D",
  "RC0603FR-07 10KL",
  "rc0402fr-07-10kl",
  "STM32F103C8T6",
  "CL05B104KO5NNNC-TR",
  "AD8331ARQ-REEL7",
  // 含中文的 MFG_PN —— 真实数据里 52,256 条中有 510 条属此类
  "RC0402FR-07-10KL(风华)",
  "贴片电阻0402-10K",
  "CC0402*", // 通配
];

const MFR_SAMPLES = [
  "Murata Manufacturing Co., Ltd.",
  "MURATA",
  "Texas Instruments Inc",
  "TI",
  "YAGEO(国巨)",
  "风华高科",
  "Vishay Intertechnology, Inc.",
  "Samsung Electro-Mechanics",
];

describe("REF-1a MPN 键差异", () => {
  const report = compareMpnKeyRules(MPN_SAMPLES);

  it("覆盖审计 §D1 点名的全部旧规则", () => {
    expect(LEGACY_MPN_RULES.map((r) => r.id)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);
  });

  it("**canonical 与 A1 完全一致** —— 这是本次选型最关键的事实", () => {
    // canonical 选的就是 A1(mfgPartNoKey)的规则,而 A1 正是库内存量与迁移 SQL 的口径。
    // 因此采纳 canonical **不需要重算 PartMfgMapping.manufacturerPartNoKey**,
    // REF-1c 的迁移风险因此大幅下降。
    const a1 = report.rules.find((r) => r.ruleId === "A1")!;
    expect(a1.differing).toBe(0);
  });

  it("四条 ASCII 规则(A2/A3/A4/A5)在含中文样本上与 canonical 不同", () => {
    for (const id of ["A2", "A3", "A4", "A5"]) {
      const r = report.rules.find((x) => x.ruleId === id)!;
      expect(r.differing, id).toBeGreaterThan(0);
    }
  });

  it("**纯非 ASCII 值被旧规则剥成空串** —— R0-1 的事故形态", () => {
    const r = compareMpnKeyRules(["风华高科", "贴片电容"]);
    for (const id of ["A2", "A3", "A4", "A5"]) {
      expect(r.rules.find((x) => x.ruleId === id)!.emptied, id).toBe(2);
    }
  });

  it("**混合中英值更危险:不是变空,而是被截成一个「像样」的错键**", () => {
    // 纯中文剥空至少还能一眼看出不对;混合值会得到非空但错误的键,
    // 而错键是会**撞上别的料**的 —— 下面两个本来完全不同的串,
    // 在旧 ASCII 规则下归一成同一个键。
    const r = compareMpnKeyRules(["贴片电阻0402-10K", "0402-10K"]);
    for (const id of ["A2", "A3", "A4", "A5"]) {
      expect(r.rules.find((x) => x.ruleId === id)!.emptied, id).toBe(0); // 没变空
      expect(r.rules.find((x) => x.ruleId === id)!.differing, id).toBeGreaterThan(0);
    }
    // canonical 下两者是**不同**的键(正确)
    expect(r.canonicalCollisions).toEqual([]);
  });

  it("A6(保留连字符)与 canonical 不同 —— 它是内部料号口径,不该用作 MPN 键", () => {
    expect(report.rules.find((r) => r.ruleId === "A6")!.differing).toBeGreaterThan(0);
  });

  it("canonical 规则下这批样本**不撞键**", () => {
    expect(report.canonicalCollisions).toEqual([]);
  });

  it("摘要只含聚合计数,可直接贴进报告", () => {
    const lines = summarizeDivergence(report);
    expect(lines.length).toBe(LEGACY_MPN_RULES.length + 1);
    expect(lines.join("\n")).toContain("不同");
  });
});

describe("REF-1a 厂商键差异(**风险点**)", () => {
  const report = compareManufacturerKeyRules(MFR_SAMPLES);

  it("覆盖 §D2 的两条键规则", () => {
    expect(LEGACY_MANUFACTURER_RULES.map((r) => r.id)).toEqual(["B1", "B4"]);
  });

  it("**canonical 与库内存量 B4 不同** —— 因为 canonical 额外剥掉公司后缀", () => {
    // 这正是 REF-1c 必须做 key 重算迁移的原因,也是本 PR 不切换的原因。
    const b4 = report.rules.find((r) => r.ruleId === "B4")!;
    expect(b4.differing).toBeGreaterThan(0);
  });

  it("**剥公司后缀会让不同写法撞成同一个键** —— 这是重算迁移要处理的冲突", () => {
    const withDup = compareManufacturerKeyRules([
      "Murata",
      "Murata Co., Ltd.",
      "MURATA, INC.",
      "Yageo",
    ]);
    const collision = withDup.canonicalCollisions.find((c) => c.key === "MURATA");
    expect(collision).toBeDefined();
    expect(collision!.samples.length).toBe(3);
    // 撞键本身是**期望行为**(三种写法本就是同一家),但库里若三行各自独立存在,
    // 重算后会违反 ManufacturerAlias 的唯一约束 —— 迁移必须先合并再重算。
  });

  it("中文厂商名在 canonical 下不被剥空", () => {
    const r = compareManufacturerKeyRules(["风华高科", "YAGEO(国巨)"]);
    expect(r.canonicalCollisions).toEqual([]);
    // B1 保留空格与括号 → 与 canonical 不同;但两者都没把中文剥没
    expect(r.rules.find((x) => x.ruleId === "B1")!.emptied).toBe(0);
  });

  it("展示归一与 B1 的差异可单独度量(确认 UI 不会突变)", () => {
    // canonical 的展示归一比 B1 多剥了 LIMITED/HOLDINGS 等后缀,差异应可数
    expect(manufacturerDisplayDivergence(MFR_SAMPLES)).toBeGreaterThanOrEqual(0);
    expect(manufacturerDisplayDivergence(["Murata Holdings Limited"])).toBe(1);
  });
});
describe("newCollisionsVsLegacy:唯一约束的真实风险量", () => {
  const b4 = LEGACY_MANUFACTURER_RULES.find((r) => r.id === "B4")!;

  it("**只算新增撞键** —— 旧规则下本来就同键的组不是风险", () => {
    // MURATA 与 murata 在 B4 下已经同键(都剥标点大写)→ 不算新增
    const same = newCollisionsVsLegacy(["MURATA", "murata"], b4, manufacturerKey);
    expect(same).toEqual([]);
  });

  it("旧规则下不同键、canonical 下同键 → 计入新增(迁移必须先合并)", () => {
    // B4 保留公司后缀:MURATACOLTD ≠ MURATA;canonical 剥后缀后两者同键
    const newly = newCollisionsVsLegacy(["Murata", "Murata Co., Ltd."], b4, manufacturerKey);
    expect(newly).toHaveLength(1);
    expect(newly[0].key).toBe("MURATA");
    expect(newly[0].count).toBe(2);
    expect(newly[0].legacyKeys.length).toBeGreaterThan(1);
  });

  it("不相干的厂商不会被算作撞键", () => {
    expect(newCollisionsVsLegacy(["Murata", "Yageo", "TDK"], b4, manufacturerKey)).toEqual([]);
  });

  it("空值不参与统计", () => {
    expect(newCollisionsVsLegacy(["", "   "], b4, manufacturerKey)).toEqual([]);
  });
});
