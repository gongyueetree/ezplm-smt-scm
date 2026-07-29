/**
 * 替代料候选排序(纯函数,可完全单测)。
 *
 * 何时需要:BOM 里的型号**匹配不到**,或者匹配到了但**已停产(EOL/NRND)**。
 *
 * 优先级(客户明确要求):
 * 1. **本系统内已有的物料** —— 自家料号能直接下单,且已经过人工确认;
 * 2. 外部源(ezPLM / DigiKey / Mouser)里**有现货**的;
 * 3. 同等条件下**性价比更高**(单价低)。
 *
 * 纪律:
 * - 这里只排序,**绝不自动替换** —— 替代料是否成立必须工程人工判定;
 * - 停产件不因为"有货"就排前面;生命周期是硬性降权项;
 * - 缺价格/缺库存是"未知",不能当成 0 参与比较(未知不等于没有)。
 */
import Decimal from "decimal.js";
import type { LifecycleValue } from "@/lib/providers/common/normalized-offer";

export type AlternateOrigin = "LOCAL" | "EZPLM" | "DIGIKEY" | "MOUSER";

export interface AlternateCandidate {
  mpn: string;
  manufacturer: string | null;
  origin: AlternateOrigin;
  /** 型号/封装相似度 0–1(来自 lib/domain/similarity) */
  similarity: number;
  lifecycle: LifecycleValue | null;
  /** 现货库存;null = 未知(不是 0) */
  stock: number | null;
  /** 适用阶梯单价;null = 未知 */
  unitPrice: string | null;
  currency: string | null;
  footprintMatches: boolean | null;
}

export interface RankedAlternate {
  candidate: AlternateCandidate;
  score: number;
  reasons: string[];
  /** 是否可直接下单(自家库存料) */
  readyToOrder: boolean;
}

/** 生命周期权重:停产件即使有货也不该排在前面 */
const LIFECYCLE_WEIGHT: Record<string, number> = {
  ACTIVE: 1,
  UNKNOWN: 0.7,
  NRND: 0.4,
  EOL: 0.15,
  OBSOLETE: 0.05,
};

/** 来源权重:自家物料库优先(客户要求) */
const ORIGIN_WEIGHT: Record<AlternateOrigin, number> = {
  LOCAL: 1,
  EZPLM: 0.85,
  DIGIKEY: 0.8,
  MOUSER: 0.8,
};

const ORIGIN_LABEL: Record<AlternateOrigin, string> = {
  LOCAL: "本系统物料库",
  EZPLM: "ezPLM",
  DIGIKEY: "DigiKey",
  MOUSER: "Mouser",
};

/**
 * 价格分:在候选集内做相对比较(最低价得 1 分)。
 * 单独一颗料的绝对价格没有意义,只有同组比较才说明"性价比"。
 * 币种不同不做换算 —— 系统不做汇率换算,异币种各自成组比较。
 */
export function priceScores(candidates: readonly AlternateCandidate[]): Map<string, number> {
  const byCurrency = new Map<string, { mpn: string; price: Decimal }[]>();
  for (const c of candidates) {
    if (!c.unitPrice || !c.currency) continue;
    let price: Decimal;
    try {
      price = new Decimal(c.unitPrice);
    } catch {
      continue;
    }
    if (price.lte(0)) continue;
    const list = byCurrency.get(c.currency) ?? [];
    list.push({ mpn: c.mpn, price });
    byCurrency.set(c.currency, list);
  }

  const out = new Map<string, number>();
  for (const list of byCurrency.values()) {
    const min = list.reduce((m, x) => (x.price.lt(m) ? x.price : m), list[0].price);
    for (const x of list) {
      // 最低价 1 分,两倍价 0.5 分,依此类推
      out.set(x.mpn, Number(min.div(x.price).toFixed(4)));
    }
  }
  return out;
}

/**
 * 排序。权重:相似度 0.35 / 来源 0.2 / 生命周期 0.2 / 有货 0.15 / 性价比 0.1
 *
 * 相似度占比最高 —— 一颗便宜又有货但根本不像的料,不是替代料。
 */
export function rankAlternates(
  candidates: readonly AlternateCandidate[],
  options: { limit?: number } = {},
): RankedAlternate[] {
  const prices = priceScores(candidates);

  const ranked = candidates.map((c) => {
    const reasons: string[] = [];

    const lifecycleKey = c.lifecycle ?? "UNKNOWN";
    const lifecycleScore = LIFECYCLE_WEIGHT[lifecycleKey] ?? 0.7;
    const originScore = ORIGIN_WEIGHT[c.origin];

    // 库存未知不等于没货,给中性分;明确为 0 才扣分
    const stockScore = c.stock === null ? 0.5 : c.stock > 0 ? 1 : 0;
    const priceScore = prices.get(c.mpn) ?? 0.5; // 无价则中性

    if (c.origin === "LOCAL") {
      // 只有确认有货才敢说"可直接下单";库存未知时不能这么写 ——
      // 采购按这句话去下单,结果发现没货,比不给建议还糟
      reasons.push(c.stock !== null && c.stock > 0 ? "本系统物料库已有,可直接下单" : "本系统物料库已有");
    } else {
      reasons.push(`来自 ${ORIGIN_LABEL[c.origin]}`);
    }

    if (c.stock !== null && c.stock > 0) reasons.push(`有现货 ${c.stock}`);
    else if (c.stock === 0) reasons.push("无现货");
    else reasons.push("库存未知");

    if (lifecycleKey === "EOL" || lifecycleKey === "OBSOLETE") {
      reasons.push(`${lifecycleKey} —— 本身已停产,不建议作为替代`);
    } else if (lifecycleKey === "NRND") {
      reasons.push("NRND —— 不推荐用于新设计");
    } else if (lifecycleKey === "ACTIVE") {
      reasons.push("在产");
    }

    if (c.footprintMatches === true) reasons.push("封装一致");
    else if (c.footprintMatches === false) reasons.push("封装不同,需工程确认可否改板");

    const score =
      c.similarity * 0.35 +
      originScore * 0.2 +
      lifecycleScore * 0.2 +
      stockScore * 0.15 +
      priceScore * 0.1;

    return {
      candidate: c,
      score: Number(score.toFixed(4)),
      reasons,
      readyToOrder: c.origin === "LOCAL" && (c.stock ?? 0) > 0,
    };
  });

  return ranked
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.candidate.mpn.localeCompare(b.candidate.mpn); // 同分稳定排序
    })
    .slice(0, options.limit ?? 5);
}

/** 这颗料是否**需要**找替代:没匹配上,或匹配到的已停产 */
export function needsAlternate(input: {
  matched: boolean;
  lifecycle: LifecycleValue | null;
}): { needed: boolean; reason: string | null } {
  if (!input.matched) return { needed: true, reason: "未匹配到型号,需人工指定或找替代料" };
  if (input.lifecycle === "EOL" || input.lifecycle === "OBSOLETE") {
    return { needed: true, reason: `型号已停产(${input.lifecycle}),建议提前找替代料` };
  }
  if (input.lifecycle === "NRND") {
    return { needed: true, reason: "型号为 NRND(不推荐用于新设计),建议评估替代料" };
  }
  return { needed: false, reason: null };
}
