/**
 * 外部 Provider 联调冒烟(DigiKey / Mouser)。
 *
 * 用法:把真实凭据写入 .env.local 后运行 `pnpm smoke:external`。
 * 安全:本脚本只打印「是否配置、HTTP 结果、报价条数与价格摘要」,
 *      绝不打印 Key、Secret 或 access_token;凭据只经 process.env 读取。
 *
 * 这是真实联调的唯一凭据 —— 未运行本脚本并贴出输出前,
 * 任何文档与汇报都不得声称已与 DigiKey/Mouser 完成联调。
 */
import { config } from "dotenv";
import { DigiKeyProvider } from "../lib/providers/digikey";
import { MouserProvider } from "../lib/providers/mouser";
import { rankOffers } from "../lib/domain/offers";
import type { NormalizedOffer } from "../lib/providers/common/normalized-offer";
import type { ApiUsageRecord } from "../lib/providers/common/api-usage";

config({ path: ".env.local" });
config({ path: ".env" });

const TEST_MPN = process.env.SMOKE_MPN ?? "STM32F103C8T6";
const TEST_QTY = Number(process.env.SMOKE_QTY ?? 1000);

const usage: ApiUsageRecord[] = [];
const recorder = { record: (u: ApiUsageRecord) => usage.push(u) };

function summarize(label: string, offers: NormalizedOffer[]) {
  console.log(`  ${label}:返回 ${offers.length} 条报价`);
  for (const o of offers.slice(0, 3)) {
    const first = o.priceBreaks[0];
    const last = o.priceBreaks.at(-1);
    console.log(
      `    · ${o.mpn} / ${o.manufacturer ?? "-"} / 包装 ${o.packaging ?? "-"} / 库存 ${o.stock ?? "未知"} / ` +
        `MOQ ${o.moq ?? "-"} SPQ ${o.spq ?? "-"} / 交期 ${o.leadTimeDays ?? "未知"}天 / ${o.lifecycle} / ` +
        `${o.currency} ${first ? `${first.minQty}+@${first.unitPrice}` : "无阶梯价"}` +
        `${last && last !== first ? ` … ${last.minQty}+@${last.unitPrice}` : ""}`,
    );
  }
}

async function smokeDigiKey(): Promise<NormalizedOffer[]> {
  if (!process.env.DIGIKEY_CLIENT_ID || !process.env.DIGIKEY_CLIENT_SECRET) {
    console.log("• DigiKey:未配置凭据(跳过,当前为 Mock 模式)");
    return [];
  }
  console.log("• DigiKey:已配置凭据,开始真实调用…");
  const p = new DigiKeyProvider({
    clientId: process.env.DIGIKEY_CLIENT_ID,
    clientSecret: process.env.DIGIKEY_CLIENT_SECRET,
    accountId: process.env.DIGIKEY_ACCOUNT_ID,
    site: process.env.DIGIKEY_SITE,
    language: process.env.DIGIKEY_LANGUAGE,
    currency: process.env.DIGIKEY_CURRENCY,
    baseUrl: process.env.DIGIKEY_API_BASE_URL,
    usageRecorder: recorder,
  });
  const offers = await p.getOffersByMpn({ mpn: TEST_MPN, quantity: TEST_QTY });
  summarize("DigiKey ProductDetails", offers);
  const candidates = await p.searchCandidates({ keyword: TEST_MPN, limit: 5 });
  console.log(`  DigiKey KeywordSearch:${candidates.length} 个候选(不含价格,符合 SPEC §8)`);
  console.log(`  Token 缓存状态:${JSON.stringify(p.tokenStatus())}`);
  return offers;
}

async function smokeMouser(): Promise<NormalizedOffer[]> {
  if (!process.env.MOUSER_API_KEY) {
    console.log("• Mouser:未配置 Key(跳过,当前为 Mock 模式)");
    return [];
  }
  console.log("• Mouser:已配置 Key,开始真实调用…");
  const p = new MouserProvider({
    apiKey: process.env.MOUSER_API_KEY,
    baseUrl: process.env.MOUSER_API_BASE_URL,
    usageRecorder: recorder,
  });
  const offers = await p.getOffersByMpn({ mpn: TEST_MPN, quantity: TEST_QTY });
  summarize("Mouser partnumber", offers);
  const candidates = await p.searchCandidates({ keyword: TEST_MPN, limit: 5 });
  console.log(`  Mouser keyword:${candidates.length} 个候选(不含价格,符合 SPEC §9)`);
  console.log(`  限流状态:${JSON.stringify(p.rateLimitStatus())}`);
  return offers;
}

async function main() {
  console.log(`=== 外部 Provider 联调冒烟 · MPN=${TEST_MPN} 数量=${TEST_QTY} ===\n`);
  let failed = false;
  const all: NormalizedOffer[] = [];

  for (const [name, fn] of [
    ["DigiKey", smokeDigiKey],
    ["Mouser", smokeMouser],
  ] as const) {
    try {
      all.push(...(await fn()));
    } catch (e) {
      failed = true;
      const safe =
        e && typeof e === "object" && "toSafeJSON" in e
          ? JSON.stringify((e as { toSafeJSON(): unknown }).toSafeJSON())
          : String(e instanceof Error ? e.message : e);
      console.error(`  ✗ ${name} 调用失败:${safe}`);
    }
    console.log("");
  }

  if (all.length > 0) {
    console.log("=== 跨源排名(确定性函数,仅供参考,正式选型须人工确认)===");
    for (const r of rankOffers(all, { demandQty: TEST_QTY, currency: all[0].currency })) {
      console.log(
        `  #${r.rank} ${r.offer.provider} ${r.offer.packaging ?? "-"} ` +
          `采购量 ${r.purchaseQty} 单价 ${r.unitPrice?.toFixed() ?? "-"} ` +
          `总价 ${r.extendedPrice?.toFixed() ?? "-"} 评分 ${r.score.total}` +
          `${r.isLowestTotal ? " [最低总价]" : ""}${r.comparable ? "" : ` [不可比:${r.incomparableReason}]`}`,
      );
    }
    console.log("");
  }

  console.log("=== API 用量记录(端点已脱敏)===");
  for (const u of usage) {
    console.log(
      `  ${u.provider} ${u.statusCode ?? "-"} ${u.durationMs ?? "-"}ms ` +
        `limit=${u.rateLimitLimit ?? "-"} remaining=${u.rateLimitRemaining ?? "-"} ${u.endpoint}`,
    );
  }

  const dump = JSON.stringify(usage);
  for (const secret of [
    process.env.MOUSER_API_KEY,
    process.env.DIGIKEY_CLIENT_SECRET,
    process.env.DIGIKEY_CLIENT_ID,
  ]) {
    if (secret && dump.includes(secret)) {
      console.error("✗ 安全检查失败:用量记录中出现凭据明文");
      process.exit(2);
    }
  }
  console.log("\n✓ 安全检查:用量记录中无凭据明文");

  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
