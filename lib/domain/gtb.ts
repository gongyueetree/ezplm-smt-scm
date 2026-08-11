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
  /**
   * 可用 Excess(呆滞/多余料)。
   *
   * **必须由 PM 人工确认后才允许传入非 0**(PR2-PROC-05-D)——
   * 系统只负责「提示这里有 500 PCS 可用」,绝不自动跨客户占用;
   * 未确认或无数据源时传 null,公式里如实显示「未接入」而不是 0。
   */
  excessQty?: number | string | null;
  moq?: number | null;
  spq?: number | null;
}

export interface GtbResult {
  /** ceil(需求 × (1 + 损耗率)) */
  grossDemand: string;
  /** 毛需求 − 库存 − 可用 Excess − 在途(下限 0) */
  netDemand: string;
  /** 经 MOQ/SPQ 圆整后的采购量 */
  purchaseQty: number;
  scrapRateUsed: string;
  /** 本次实际扣减的 Excess;未接入数据源或 PM 未确认占用时为 null(**不是 0**) */
  excessApplied: string | null;
  /** 恒为 false:损耗率口径需甲方书面确认后方可视为已确认 */
  scrapRateConfirmed: false;
  /** 人可读的计算过程,逐步留痕 */
  steps: string[];
  /**
   * 结构化的公式拆解 —— 页面按这个渲染,不再让人去读 steps 字符串。
   * 客户明确问过「GTB 是做什么」,所以每一项都要能单独看见。
   */
  breakdown: {
    label: string;
    /** 该项对结果的方向:加 / 减 / 结果行 */
    op: "base" | "add" | "subtract" | "result";
    value: string;
    /** 该项数据从哪来;未接入时写明,不留空 */
    note?: string;
  }[];
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
  // Excess 未接入 / PM 未确认占用 → null,**不按 0 参与计算也不显示成 0**
  const excessProvided = input.excessQty !== null && input.excessQty !== undefined && input.excessQty !== "";
  const excess = excessProvided ? toDecimal(input.excessQty) : new Decimal(0);

  const steps: string[] = [];

  // ① 毛需求:需求 × (1 + 损耗率),向上取整到整颗
  const grossRaw = demand.mul(new Decimal(1).plus(scrapRate));
  const gross = grossRaw.ceil();
  steps.push(
    `毛需求 = ceil(${demand.toFixed()} × (1 + ${scrapRate.toFixed()})) = ceil(${grossRaw.toFixed()}) = ${gross.toFixed()}`,
  );

  // ② 净需求:扣库存、可用 Excess 与在途,下限 0
  const netRaw = gross.minus(stock).minus(excess).minus(inTransit);
  const net = netRaw.lessThan(0) ? new Decimal(0) : netRaw;
  steps.push(
    `净需求 = ${gross.toFixed()} − 库存 ${stock.toFixed()} − Excess ${excessProvided ? excess.toFixed() : "未接入"} − 在途 ${inTransit.toFixed()} = ${netRaw.toFixed()}` +
      (netRaw.lessThan(0) ? " → 取 0(库存/Excess/在途已覆盖需求)" : ""),
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
    excessApplied: excessProvided ? excess.toFixed() : null,
    steps,
    breakdown: [
      { label: "需求量", op: "base", value: demand.toFixed(), note: "本次投产需求" },
      {
        label: "损耗",
        op: "add",
        value: gross.minus(demand).toFixed(),
        note: `损耗率 ${scrapRate.toFixed()} —— 默认 0,口径待甲方确认`,
      },
      { label: "可用库存", op: "subtract", value: stock.toFixed(), note: "ezPLM 只读缓存" },
      {
        label: "可用 Excess",
        op: "subtract",
        value: excessProvided ? excess.toFixed() : "—",
        note: excessProvided
          ? "PM 已确认占用"
          : "Excess 数据源未配置 —— 未参与扣减,也不按 0 计",
      },
      { label: "在途", op: "subtract", value: inTransit.toFixed(), note: "采购在途 + OPO 未交" },
      {
        label: "MOQ / SPQ 圆整",
        op: "add",
        value: new Decimal(purchaseQty).minus(net).toFixed(),
        note: `MOQ ${input.moq ?? "未设"} · SPQ ${input.spq ?? "未设"}`,
      },
      { label: "建议采购量", op: "result", value: String(purchaseQty), note: "GTB(Gross To Buy)" },
    ],
  };
}
