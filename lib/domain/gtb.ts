/**
 * GTB(采购需求)计算 —— CLAUDE.md 领域规则:
 *   ceil(需求 × (1 + 损耗率)) − 库存 − 在途,结果不低于 MOQ 再按 SPQ 向上圆整。
 *
 * 纪律:
 * - 全程 Decimal,禁止浮点参与(0.1 + 0.2 类误差会一路错到报价);
 * - **损耗率默认 0,并恒标注「待甲方确认」** —— 系统不替甲方假设损耗;
 * - 净需求 ≤ 0 时结果为 0:不需要采购就不该被 MOQ 拉起来买一批;
 * - 返回完整计算过程(steps),落 PurchaseRequest.gtbSnapshot 供审计与复核。
 */
import { Decimal } from "decimal.js";
import { calculateRoundedPurchaseQty } from "./offers";

/** 损耗率默认值;`scrapRateConfirmed: false` 会一直提示待甲方确认 */
export const DEFAULT_SCRAP_RATE = "0";

export interface GtbInput {
  /** 需求数量(单板用量 × 台数) */
  demandQty: number | string;
  /** 损耗率,如 0.02 表示 2%;缺省 0(待甲方确认) */
  scrapRate?: number | string | null;
  /** 现有库存 */
  stockQty?: number | string | null;
  /** 在途(OPO 未交量) */
  inTransitQty?: number | string | null;
  moq?: number | null;
  spq?: number | null;
}

export interface GtbResult {
  /** ceil(需求 × (1 + 损耗率)) */
  grossDemand: string;
  /** 毛需求 − 库存 − 在途(下限 0) */
  netDemand: string;
  /** 经 MOQ/SPQ 圆整后的采购量 */
  purchaseQty: number;
  scrapRateUsed: string;
  /** 恒为 false:损耗率口径需甲方书面确认后方可视为已确认 */
  scrapRateConfirmed: false;
  /** 人可读的计算过程,逐步留痕 */
  steps: string[];
}

/** decimal.js 对非法串会抛错,这里统一回落到 fallback,不让脏数据中断计算 */
function toDecimal(v: number | string | null | undefined, fallback = "0"): Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(fallback);
  try {
    const d = new Decimal(typeof v === "number" ? String(v) : String(v).trim());
    return d.isFinite() ? d : new Decimal(fallback);
  } catch {
    return new Decimal(fallback);
  }
}

export function calculateGtb(input: GtbInput): GtbResult {
  const demand = toDecimal(input.demandQty);
  const scrapRate = toDecimal(input.scrapRate ?? DEFAULT_SCRAP_RATE);
  const stock = toDecimal(input.stockQty);
  const inTransit = toDecimal(input.inTransitQty);

  const steps: string[] = [];

  // ① 毛需求:需求 × (1 + 损耗率),向上取整到整颗
  const grossRaw = demand.mul(new Decimal(1).plus(scrapRate));
  const gross = grossRaw.ceil();
  steps.push(
    `毛需求 = ceil(${demand.toFixed()} × (1 + ${scrapRate.toFixed()})) = ceil(${grossRaw.toFixed()}) = ${gross.toFixed()}`,
  );

  // ② 净需求:扣库存与在途,下限 0
  const netRaw = gross.minus(stock).minus(inTransit);
  const net = netRaw.lessThan(0) ? new Decimal(0) : netRaw;
  steps.push(
    `净需求 = ${gross.toFixed()} − 库存 ${stock.toFixed()} − 在途 ${inTransit.toFixed()} = ${netRaw.toFixed()}` +
      (netRaw.lessThan(0) ? " → 取 0(库存与在途已覆盖需求)" : ""),
  );

  // ③ MOQ/SPQ 圆整(净需求为 0 时不采购,不被 MOQ 拉起)
  const purchaseQty =
    net.lessThanOrEqualTo(0)
      ? 0
      : calculateRoundedPurchaseQty(net.toNumber(), { moq: input.moq, spq: input.spq });

  if (net.lessThanOrEqualTo(0)) {
    steps.push("采购量 = 0(无需采购,不适用 MOQ/SPQ)");
  } else {
    steps.push(
      `采购量 = max(净需求 ${net.toFixed()}, MOQ ${input.moq ?? 0}) 再按 SPQ ${input.spq ?? 1} 向上圆整 = ${purchaseQty}`,
    );
  }

  steps.push(`损耗率口径:${scrapRate.toFixed()}(默认 0,**待甲方确认**)`);

  return {
    grossDemand: gross.toFixed(),
    netDemand: net.toFixed(),
    purchaseQty,
    scrapRateUsed: scrapRate.toFixed(),
    scrapRateConfirmed: false,
    steps,
  };
}
