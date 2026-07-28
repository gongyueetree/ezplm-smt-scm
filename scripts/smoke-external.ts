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
/** 设置后,同 MPN 但制造商不符的报价会被标注为不可比(默认不做约束) */
const EXPECTED_MFR = process.env.SMOKE_MFR?.trim() || undefined;

/**
 * 价格口径提示:跨源比价最容易被误读的地方。
 * 凡未经官方文档/账户确认的口径,一律标注"待确认",不臆断。
 */
function printPriceBasisNotice() {
  console.log("=== 价格口径(比价前必读)===");
  console.log("  · 币种:各源按自身站点/配置返回;系统不做汇率换算,异币种标注为不可比。");
  console.log(
    `  · DigiKey:价格按 X-DIGIKEY-Locale-Currency(当前 ${process.env.DIGIKEY_CURRENCY ?? "CNY"})` +
      "由 DigiKey 侧换算返回;是否含税、是否受 Customer-Id(DIGIKEY_ACCOUNT_ID)协议价影响," +
      "**待 DigiKey 官方文档与账户确认**,不得据此断言口径。",
  );
  console.log(
    "  · Mouser:价格取 PriceBreaks[].Currency 为准;是否含税同样待确认。",
  );
  console.log(
    "  · 两侧均为分销商目录价,通常不含关税、运费与进口税费;若两源同料价格差异显著(如数倍)," +
      "优先怀疑:①币种口径不同 ②同号异厂料 ③账户协议价 ④封装/批量不同,而非直接采信低价。",
  );
  console.log("");
}

const usage: ApiUsageRecord[] = [];
const recorder = { record: (u: ApiUsageRecord) => usage.push(u) };

/** 凭据清单:required=缺失即无法联调;optional=不填走默认值 */
const ENV_CHECKLIST = {
  DigiKey: [
    { name: "DIGIKEY_CLIENT_ID", required: true },
    { name: "DIGIKEY_CLIENT_SECRET", required: true },
    { name: "DIGIKEY_ACCOUNT_ID", required: false },
    { name: "DIGIKEY_SITE", required: false, fallback: "CN" },
    { name: "DIGIKEY_LANGUAGE", required: false, fallback: "zh" },
    { name: "DIGIKEY_CURRENCY", required: false, fallback: "CNY" },
    { name: "DIGIKEY_API_BASE_URL", required: false, fallback: "https://api.digikey.com" },
  ],
  Mouser: [
    { name: "MOUSER_API_KEY", required: true },
    { name: "MOUSER_API_BASE_URL", required: false, fallback: "https://api.mouser.com" },
  ],
} as const;

/** 打印配置检查(只显示是否配置与字符数,绝不显示值) */
function printEnvChecklist(): string[] {
  const missing: string[] = [];
  console.log("=== 凭据配置检查(只显示是否配置与字符数,不显示值)===");
  for (const [group, vars] of Object.entries(ENV_CHECKLIST)) {
    console.log(`  ${group}:`);
    for (const v of vars) {
      const raw = process.env[v.name];
      const value = raw?.trim() ?? "";
      if (value) {
        console.log(`    ✓ ${v.name.padEnd(24)} 已配置(${value.length} 字符)`);
      } else if (v.required) {
        console.log(`    ✗ ${v.name.padEnd(24)} 未配置 —— 必填,缺失将跳过该 Provider`);
        missing.push(v.name);
      } else {
        const fb = "fallback" in v ? `,默认 ${v.fallback}` : "";
        console.log(`    · ${v.name.padEnd(24)} 未配置(可选${fb})`);
      }
    }
  }
  if (missing.length > 0) {
    console.log("\n  ⚠ 请在 .env.local 中补齐以下变量(注意去掉行首的 # 注释符):");
    for (const name of missing) console.log(`      ${name}=你的值`);
  }
  console.log("");
  return missing;
}

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
  if (!process.env.DIGIKEY_CLIENT_ID?.trim() || !process.env.DIGIKEY_CLIENT_SECRET?.trim()) {
    console.log(
      "• DigiKey:跳过 —— 缺 DIGIKEY_CLIENT_ID / DIGIKEY_CLIENT_SECRET,系统仍运行在 Mock 模式",
    );
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
  if (!process.env.MOUSER_API_KEY?.trim()) {
    console.log("• Mouser:跳过 —— 缺 MOUSER_API_KEY,系统仍运行在 Mock 模式");
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
  printEnvChecklist();
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
    const baseCurrency = all[0].currency;
    console.log(
      `=== 跨源排名(比价币种 ${baseCurrency};确定性函数,仅供参考,正式选型须人工确认)===`,
    );
    const ranked = rankOffers(all, {
      demandQty: TEST_QTY,
      currency: baseCurrency,
      expectedManufacturer: EXPECTED_MFR,
    });
    for (const r of ranked) {
      console.log(
        `  #${r.rank} ${r.offer.provider} | ${r.offer.manufacturer ?? "厂商未知"} | ` +
          `${r.offer.packaging ?? "-"} | 采购量 ${r.purchaseQty} | ` +
          `单价 ${r.offer.currency} ${r.unitPrice?.toFixed() ?? "-"} | ` +
          `总价 ${r.offer.currency} ${r.extendedPrice?.toFixed() ?? "-"} | 评分 ${r.score.total}` +
          `${r.isLowestTotal ? " [最低总价]" : ""}` +
          `${r.comparable ? "" : ` [不可比:${r.incomparableReason}]`}`,
      );
    }
    if (ranked.some((r) => !r.comparable)) {
      console.log(
        "  ⚠ 标注[不可比]的行未参与价格比较:manufacturer_mismatch=同号异厂料(不是同一颗料);" +
          "currency_mismatch=币种不同且系统不做汇率换算;no_price_break=圆整后取不到适用阶梯价。",
      );
    }
    if (!EXPECTED_MFR) {
      console.log(
        "  提示:未设 SMOKE_MFR,本次未做制造商约束 —— 三方按 MPN 检索可能带回同号异厂料。" +
          "设 SMOKE_MFR=STMicroelectronics 可让异厂结果被标注为不可比。",
      );
    }
    console.log("");
    printPriceBasisNotice();
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
