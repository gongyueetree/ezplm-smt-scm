/**
 * R4-3 私有 UAT:ManufacturerResolver 对乾创真实 MFG 串的覆盖实测。
 * 只输出聚合统计;断言真实数据的结构特征(存在性/量级),不硬编码全量期望。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adaptMaterialMfg } from "@/lib/integration/erp/sources/kingdee/excel/adapters";
import { parseMainSheet } from "@/lib/integration/erp/sources/kingdee/excel/workbook";
import { QIANCHUANG_K3_V1, detectRole } from "@/lib/integration/erp/profiles/qianchuang-k3-v1";
import {
  resolveManufacturer,
  type ResolverContext,
} from "@/lib/integration/erp/normalization/manufacturer-resolver";
import { manufacturerKeyOf } from "@/lib/domain/part-mfg";

const dir = process.env.QIANCHUANG_UAT_FIXTURE_DIR!;

/** 迁移种子里的 CURATED 全局别名/标准名(与 r4_3 migration 保持同步的最小副本) */
const CANONICALS = [
  "Texas Instruments", "STMicroelectronics", "Murata", "YAGEO", "Samsung Electro-Mechanics",
  "Vishay", "onsemi", "NXP", "Infineon", "Microchip", "Analog Devices", "TDK", "KEMET",
  "Panasonic", "ROHM", "Nexperia", "Espressif", "GigaDevice", "SG Micro", "WCH", "Uniroyal",
  "FH (Guangdong Fenghua)",
];
const GLOBAL_ALIASES: [string, string][] = [
  ["TI", "Texas Instruments"], ["ST", "STMicroelectronics"], ["STM", "STMicroelectronics"],
  ["STMicro", "STMicroelectronics"], ["ADI", "Analog Devices"], ["muRata", "Murata"],
  ["村田", "Murata"], ["国巨", "YAGEO"], ["ON Semiconductor", "onsemi"], ["SEMCO", "Samsung Electro-Mechanics"],
  ["兆易创新", "GigaDevice"], ["圣邦微", "SG Micro"], ["风华", "FH (Guangdong Fenghua)"],
];

function ctx(): ResolverContext {
  const canonicalByNorm = new Map(
    CANONICALS.map((n) => [manufacturerKeyOf(n), { id: `c:${n}`, canonicalName: n, normalizedName: manufacturerKeyOf(n) }]),
  );
  const globalAliases = new Map(
    GLOBAL_ALIASES.map(([a, c]) => [manufacturerKeyOf(a), { normalizedAlias: manufacturerKeyOf(a), canonicalRefId: `c:${c}`, canonicalName: c }]),
  );
  return { tenantAliases: new Map(), globalAliases, canonicalByNorm };
}

describe("真实 MFG 串 → 解析覆盖", () => {
  it("元器件行的 unique 原始厂商:确定性命中/候选/未解析分布实测;垃圾值零误建", async () => {
    const f = readdirSync(dir).find((x) => detectRole(QIANCHUANG_K3_V1, x) === "MATERIAL_MFG")!;
    const sheet = await parseMainSheet(readFileSync(path.join(dir, f)));
    const r = adaptMaterialMfg(sheet, f);
    const uniqueRaw = new Map<string, number>();
    for (const m of r.records) {
      if (m.rawManufacturer) uniqueRaw.set(m.rawManufacturer, (uniqueRaw.get(m.rawManufacturer) ?? 0) + 1);
    }
    expect(uniqueRaw.size).toBeGreaterThan(2000); // 审计:2959 unique(去垃圾后)

    const c = ctx();
    const dist = new Map<string, number>();
    let weightedResolved = 0;
    let totalWeight = 0;
    for (const [raw, count] of uniqueRaw) {
      const res = resolveManufacturer({ rawManufacturer: raw, materialKind: "ELECTRONIC_COMPONENT" }, c);
      dist.set(res.resolution, (dist.get(res.resolution) ?? 0) + 1);
      totalWeight += count;
      if (res.resolution === "GLOBAL_ALIAS" || res.resolution === "CANONICAL_EXACT") weightedResolved += count;
    }
    // 聚合输出(零真实串)
    console.log("[UAT] MFG resolution 分布:", Object.fromEntries(dist));
    console.log(
      `[UAT] 确定性解析覆盖(按映射行加权):${weightedResolved}/${totalWeight} = ${((weightedResolved / totalWeight) * 100).toFixed(1)}%`,
    );

    // 结构断言:CURATED 引导名单就能确定性覆盖一部分头部厂商;大量长尾待租户别名评审
    expect((dist.get("GLOBAL_ALIAS") ?? 0) + (dist.get("CANONICAL_EXACT") ?? 0)).toBeGreaterThan(5);
    expect(dist.get("UNRESOLVED") ?? 0).toBeGreaterThan(1000); // 长尾如实未解析,不假装全覆盖
    // 垃圾值(#N 等)在 adapter 已置 null,不会进入 uniqueRaw —— 断言无空键
    expect([...uniqueRaw.keys()].every((k) => k.trim() !== "")).toBe(true);
  });
});
