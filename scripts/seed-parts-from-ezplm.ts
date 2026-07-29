/**
 * 从 ezPLM 抓取常用物料,填充本地物料库(Part 表)。
 *
 * 为什么需要:BOM 匹配的第一顺位是**自家物料库** —— 自家料号才是能直接下单的。
 * 库是空的时候,工程侧 BOM(只有 Value)每一行都只能落到"无候选",人工得从零找。
 * 先灌一批常用料,相似度匹配立刻就有东西可比。
 *
 * 数据主权(CLAUDE.md):ezPLM 是物料主数据的**唯一真源**,
 * 本地 Part 表只是**只读缓存** —— 所以每条都记 sourcedFrom=EZPLM 与 syncedAt,
 * 且 internalPn 用 `EZP-<MPN>` 形式标明来路,不伪装成自有编码。
 *
 * 用法:
 *   pnpm seed:parts                 # 默认抓 50 条
 *   pnpm seed:parts -- --limit 100 --per-keyword 3
 *   pnpm seed:parts -- --tenant <tenantId>
 */
// 必须第一行:它会在其余 import 的副作用之前把 .env.local 读进来
import "./bootstrap-env";

import { ezplmProviderMode, getEzplmPartsProvider } from "../lib/providers/ezplm";
import type { CanonicalPart } from "../lib/providers/ezplm/types";
import { prisma } from "../lib/server/db";
import { tenantData, tenantWhere } from "../lib/server/tenant-scope";

/**
 * 检索关键字:按**型号家族前缀**取,而不是"电阻""0603"这类品类词。
 *
 * 实测 ezPLM 的 API Key 接口是**白名单原厂库**:
 * `MIC5504`/`STM32F103` 这类前缀命中良好,而 `0603`/`电容` 返回 0 条 ——
 * 库里基本没有通用阻容感。因此这里只列 IC/有源器件家族,不做无用功。
 */
const KEYWORDS = [
  // MCU / 可编程
  "STM32F103", "STM32F030", "STM32G071", "STM32L011", "ESP32", "ATMEGA328", "PIC16F", "MSP430",
  // 电源
  "MIC5504", "LM2776", "AMS1117", "TPS7A", "TPS62", "LM2596", "MP1584", "RT9013", "SY8205",
  // 运放 / 比较器 / 基准
  "ADA4851", "LM358", "OPA2333", "TL431", "LM393", "AD8226", "REF3025",
  // 接口 / 通信
  "MAX3232", "SP3485", "TJA1050", "CP2102", "FT232", "SN65HVD", "USBLC6",
  // 逻辑 / 驱动
  "SN74HC595", "SN74LVC1G", "74HC245", "ULN2003", "DRV8833", "TC4427",
  // 传感 / 时钟 / 存储
  "DS3231", "DS18B20", "AT24C02", "W25Q", "24LC256", "SHT30", "BMP280",
  // 分立 / 保护
  "SS34", "SMAJ", "BAV99", "AO3400", "SI2302", "MMBT3904",
];

interface Args {
  limit: number;
  /**
   * 每个关键字取几条。默认 2 而不是 5:
   * 取 5 的话前 10 个关键字就把 50 条名额占满,库里全是 MCU,
   * 匹配时覆盖面反而差。宁可每个家族少几条、家族多一些。
   */
  perKeyword: number;
  tenantId?: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const limit = Number(get("limit") ?? 50);
  const perKeyword = Number(get("per-keyword") ?? 2);
  return {
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 50,
    perKeyword: Number.isFinite(perKeyword) && perKeyword > 0 ? Math.min(perKeyword, 20) : 2,
    tenantId: get("tenant"),
  };
}

async function main() {
  const args = parseArgs();

  if (ezplmProviderMode() !== "http") {
    console.error(
      "✗ 未配置 EZPLM_API_BASE_URL / EZPLM_API_KEY —— 当前是 Mock 形态,抓下来的不是真实主数据,已中止。",
    );
    process.exitCode = 1;
    return;
  }

  const tenant = args.tenantId
    ? await prisma.tenant.findUnique({ where: { id: args.tenantId } })
    : await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!tenant) {
    console.error("✗ 找不到租户;先跑 pnpm db:seed 建立演示租户,或用 --tenant <id> 指定。");
    process.exitCode = 1;
    return;
  }
  console.log(`租户:${tenant.name}(${tenant.id})`);
  console.log(`目标条数:${args.limit}\n`);

  const provider = getEzplmPartsProvider();
  const collected = new Map<string, CanonicalPart>();
  const emptyKeywords: string[] = [];

  for (const keyword of KEYWORDS) {
    if (collected.size >= args.limit) break;
    try {
      const rows = await provider.searchParts({ keyword, limit: args.perKeyword });
      if (rows.length === 0) {
        emptyKeywords.push(keyword);
        continue;
      }
      for (const r of rows) {
        if (!r.mpn) continue;
        const key = r.mpn.toUpperCase();
        if (collected.has(key)) continue;
        collected.set(key, r);
        if (collected.size >= args.limit) break;
      }
      console.log(`  ✓ ${keyword.padEnd(12)} → ${rows.length} 条(累计 ${collected.size})`);
    } catch (e) {
      // 单个关键字失败不中断整批,但要如实记下来
      console.log(`  ✗ ${keyword.padEnd(12)} → ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (emptyKeywords.length > 0) {
    console.log(`\n未命中的关键字(${emptyKeywords.length} 个):${emptyKeywords.join(", ")}`);
    console.log("  说明:ezPLM API Key 接口只覆盖白名单原厂库,这些家族不在其中,属正常。");
  }

  console.log(`\n准备写入 ${collected.size} 条…`);
  const now = new Date();
  let created = 0;
  let updated = 0;

  for (const part of collected.values()) {
    // internalPn 标明来路:本地库是 ezPLM 的只读缓存,不伪装成自有编码
    const internalPn = `EZP-${part.mpn!.toUpperCase()}`;
    const existing = await prisma.part.findFirst({
      where: tenantWhere(tenant.id, { internalPn }),
      select: { id: true },
    });

    const payload = {
      mpn: part.mpn,
      manufacturer: part.manufacturer,
      description: part.description,
      footprint: part.footprint,
      lifecycle: part.lifecycle,
      rohs: part.rohs,
      reach: part.reach,
      msl: part.msl,
      packaging: part.packaging,
      dateCode: part.dateCode,
      syncedAt: now,
    };

    if (existing) {
      await prisma.part.update({
        where: { id: existing.id },
        data: payload,
      });
      updated++;
    } else {
      await prisma.part.create({
        data: tenantData(tenant.id, { internalPn, ...payload }),
      });
      created++;
    }
  }

  const total = await prisma.part.count({ where: tenantWhere(tenant.id) });
  console.log(`\n✓ 新增 ${created} 条 / 更新 ${updated} 条;当前物料库共 ${total} 条。`);
  console.log("  这些是 ezPLM 的**只读缓存**(sourcedFrom=EZPLM),不是自有主数据;");
  console.log("  BOM 匹配时会优先用它们出候选,但正式匹配仍须逐行人工确认。");
}

main()
  .catch((e) => {
    console.error("\n✗ 抓取失败:", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
