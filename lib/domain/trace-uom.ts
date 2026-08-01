/**
 * 追溯图的单位换算(纯函数)。
 *
 * 为什么必须有:同一条链路上不同环节的计量单位常常不同 ——
 * 收料按 **Reel**、发料按 **PCS**、出货按 **箱**。
 * 原实现把 `qty` 直接相加,等于把 2 Reel + 100 PCS 加成 102 ——
 * 这个数字没有任何意义,却会出现在影响面报告上被用来做召回决策。
 *
 * 纪律(与"系统不做汇率换算"同源):
 * - **只有 baseUom 一致时才相加**;不一致就标为不可比,不换算、不猜;
 * - 缺换算系数的边**单独计数**,不按 0 也不按原值混入;
 * - 换算系数必须是**正数**;0 或负数视为无效数据(0 会让所有数量消失)。
 */
import Decimal from "decimal.js";

/** 常见 SMT 计量单位 */
export const KNOWN_UOMS = ["PCS", "REEL", "TRAY", "TUBE", "BOX", "M", "G", "KG"] as const;

export function normalizeUom(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim().toUpperCase();
  if (!t) return null;
  // 常见别名归一;不认识的原样保留(**不丢弃**,否则会被误当成缺单位)
  const ALIAS: Record<string, string> = {
    PC: "PCS",
    PIECE: "PCS",
    PIECES: "PCS",
    EA: "PCS",
    个: "PCS",
    只: "PCS",
    颗: "PCS",
    盘: "REEL",
    卷: "REEL",
    盒: "BOX",
    箱: "BOX",
    管: "TUBE",
    条: "TUBE",
  };
  return ALIAS[t] ?? t;
}

export interface UomQuantity {
  quantity?: string | null;
  uom?: string | null;
  baseQuantity?: string | null;
  baseUom?: string | null;
  conversionFactor?: string | null;
}

export type ConversionStatus =
  | "OK"
  | "NO_QUANTITY"
  | "NO_UOM"
  | "MISSING_FACTOR"
  | "INVALID_FACTOR";

export interface ConversionResult {
  status: ConversionStatus;
  baseQuantity: string | null;
  baseUom: string | null;
  detail: string;
}

function dec(v: string | null | undefined): Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    const d = new Decimal(v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/**
 * 把一条边的数量折算到基准单位。
 *
 * 已给 baseQuantity 就直接用(导入方已算好);否则用 quantity × conversionFactor。
 * **算不出来就如实返回状态**,绝不返回一个看似合理的数。
 */
export function toBaseQuantity(input: UomQuantity): ConversionResult {
  const baseGiven = dec(input.baseQuantity);
  const baseUom = normalizeUom(input.baseUom);
  if (baseGiven !== null && baseUom) {
    return {
      status: "OK",
      baseQuantity: baseGiven.toFixed(),
      baseUom,
      detail: "使用导入时已折算好的基准数量",
    };
  }

  const qty = dec(input.quantity);
  if (qty === null) {
    return { status: "NO_QUANTITY", baseQuantity: null, baseUom, detail: "该边没有数量" };
  }

  const uom = normalizeUom(input.uom);
  if (!uom) {
    return {
      status: "NO_UOM",
      baseQuantity: null,
      baseUom: null,
      detail: "该边有数量但没有单位 —— 无法确定它能否与其它边相加",
    };
  }

  // 单位本身就是基准单位:系数视为 1
  const factor = dec(input.conversionFactor);
  if (factor === null) {
    if (baseUom === null || baseUom === uom) {
      return { status: "OK", baseQuantity: qty.toFixed(), baseUom: uom, detail: "单位即基准单位" };
    }
    return {
      status: "MISSING_FACTOR",
      baseQuantity: null,
      baseUom,
      detail: `缺少 ${uom} → ${baseUom} 的换算系数,该边数量不可比`,
    };
  }
  if (factor.lte(0)) {
    return {
      status: "INVALID_FACTOR",
      baseQuantity: null,
      baseUom,
      detail: `换算系数 ${factor.toFixed()} 非正数 —— 视为无效数据(系数为 0 会让数量凭空消失)`,
    };
  }

  return {
    status: "OK",
    baseQuantity: qty.mul(factor).toFixed(),
    baseUom: baseUom ?? "PCS",
    detail: `${qty.toFixed()} ${uom} × ${factor.toFixed()} = ${qty.mul(factor).toFixed()} ${baseUom ?? "PCS"}`,
  };
}

export interface SumResult {
  /** 各基准单位分别合计 —— **不同单位不合并** */
  totals: { baseUom: string; total: string; edgeCount: number }[];
  /** 无法折算的边数(缺数量/缺单位/缺系数/系数非法) */
  incomparableEdges: number;
  /** 是否出现了多个基准单位 */
  mixedUom: boolean;
  /** 逐条不可比原因,便于人去补数据 */
  issues: { index: number; status: ConversionStatus; detail: string }[];
}

/**
 * 合计一组边的数量。
 *
 * **按基准单位分组合计**,绝不把不同单位加在一起。
 * 出现多个基准单位时 `mixedUom=true`,UI 必须提示不可直接比较。
 */
export function sumByBaseUom(edges: readonly UomQuantity[]): SumResult {
  const buckets = new Map<string, { total: Decimal; count: number }>();
  const issues: SumResult["issues"] = [];
  let incomparable = 0;

  edges.forEach((e, i) => {
    const r = toBaseQuantity(e);
    if (r.status !== "OK" || r.baseQuantity === null || !r.baseUom) {
      incomparable += 1;
      issues.push({ index: i, status: r.status, detail: r.detail });
      return;
    }
    const cur = buckets.get(r.baseUom) ?? { total: new Decimal(0), count: 0 };
    cur.total = cur.total.add(new Decimal(r.baseQuantity));
    cur.count += 1;
    buckets.set(r.baseUom, cur);
  });

  return {
    totals: [...buckets.entries()]
      .map(([baseUom, v]) => ({ baseUom, total: v.total.toFixed(), edgeCount: v.count }))
      .sort((a, b) => a.baseUom.localeCompare(b.baseUom)),
    incomparableEdges: incomparable,
    mixedUom: buckets.size > 1,
    issues,
  };
}
