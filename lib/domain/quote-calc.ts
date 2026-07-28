/**
 * 报价计算(SPEC §12)。
 *
 * 纪律(CLAUDE.md 硬性约束 2/7):
 * - 材料/人工/NRE/SMT/DIP/测试/管理费/其它 全部由本文件的确定性函数计算;
 * - 全程 Decimal,禁止浮点参与金额运算;
 * - **LLM 不得直接产出任何数值**:AI 只能给出建议参数(如 Markup 档位),
 *   数值一律由这里重算,前端展示与快照都取重算结果。
 */
import { Decimal } from "decimal.js";
import { roundMoney } from "./offers";

export { Decimal, roundMoney };

export const QUOTE_COST_CATEGORIES = [
  "MATERIAL",
  "LABOR",
  "NRE",
  "SMT",
  "DIP",
  "TEST",
  "OVERHEAD",
  "OTHER",
] as const;

export type QuoteCostCategoryValue = (typeof QUOTE_COST_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<QuoteCostCategoryValue, string> = {
  MATERIAL: "材料",
  LABOR: "人工",
  NRE: "NRE",
  SMT: "SMT",
  DIP: "DIP",
  TEST: "测试",
  OVERHEAD: "管理费",
  OTHER: "其它费用",
};

/** 数值入参统一类型:字符串/数字/Decimal 皆可,空值按 fallback */
export type NumericLike = string | number | Decimal | null | undefined;

function dec(v: NumericLike, fallback = "0"): Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(fallback);
  if (v instanceof Decimal) return v;
  try {
    const d = new Decimal(typeof v === "number" ? String(v) : String(v).trim());
    return d.isFinite() ? d : new Decimal(fallback);
  } catch {
    return new Decimal(fallback);
  }
}

// ============================================================
// 1. 行级计算:Markup / 最终物料报价 / PPV
// ============================================================

/**
 * 最终物料报价(单价)= 采购成本 × (1 + Markup)。
 * Markup 以小数表示(0.085 = 8.5%)。
 */
export function calculateFinalUnitPrice(
  purchaseCost: NumericLike,
  markupPct: NumericLike,
): Decimal {
  return dec(purchaseCost).mul(new Decimal(1).plus(dec(markupPct)));
}

/** 由采购成本与目标售价反推 Markup;采购成本为 0 时无定义,返回 null */
export function deriveMarkupPct(
  purchaseCost: NumericLike,
  finalUnitPrice: NumericLike,
): Decimal | null {
  const cost = dec(purchaseCost);
  if (cost.isZero()) return null;
  return dec(finalUnitPrice).div(cost).minus(1);
}

/**
 * PPV(采购价格差异)= (采购成本 − 基准成本) × 数量,正值表示超支。
 *
 * ⚠ 口径提示:基准成本取「标准成本 / 历史最低价 / 上次采购价」中的哪一个,
 * 需业务书面确认(见 INTEGRATION_PLAN 3.3 待确认项)。
 * 本函数只负责按给定基准做确定性计算,不替业务选基准;基准缺失时返回 null 而非按 0 计算,
 * 避免把"没有基准"显示成"零差异"。
 */
export function calculatePpv(
  purchaseCost: NumericLike,
  baselineCost: NumericLike,
  qty: NumericLike,
): Decimal | null {
  if (baselineCost === null || baselineCost === undefined || baselineCost === "") return null;
  return dec(purchaseCost).minus(dec(baselineCost)).mul(dec(qty));
}

/** 行小计 = 单价 × 数量(全精度,不做中间舍入) */
export function calculateLineExtended(
  unitPrice: NumericLike,
  qty: NumericLike,
): Decimal {
  return dec(unitPrice).mul(dec(qty));
}

// ============================================================
// 2. 人工费率模板(SPEC §12:多种模板并允许手工调整)
// ============================================================

export interface LaborRateTemplate {
  id: string;
  name: string;
  /** SMT 每点单价 */
  smtRatePerPoint: string;
  /** DIP 每点单价 */
  dipRatePerPoint: string;
  /** 测试每小时单价 */
  testRatePerHour: string;
  /** 基础人工每片单价 */
  laborRatePerBoard: string;
  currency: string;
}

/** 内置模板(示例值,正式费率由业务维护) */
export const BUILTIN_LABOR_TEMPLATES: LaborRateTemplate[] = [
  {
    id: "standard",
    name: "标准费率",
    smtRatePerPoint: "0.008",
    dipRatePerPoint: "0.05",
    testRatePerHour: "60",
    laborRatePerBoard: "1.2",
    currency: "CNY",
  },
  {
    id: "small-batch",
    name: "小批量费率",
    smtRatePerPoint: "0.015",
    dipRatePerPoint: "0.08",
    testRatePerHour: "80",
    laborRatePerBoard: "2.5",
    currency: "CNY",
  },
];

export interface LaborInput {
  boards: string | number;
  smtPoints?: string | number | null;
  dipPoints?: string | number | null;
  testHours?: string | number | null;
  /** 手工调整:给出即覆盖模板算出的对应项(SPEC §12 允许手工调整) */
  overrides?: Partial<Record<"smt" | "dip" | "test" | "labor", string>>;
}

export interface LaborBreakdown {
  smt: Decimal;
  dip: Decimal;
  test: Decimal;
  labor: Decimal;
  /** 哪些项被手工覆盖(留痕,审批时可见) */
  overridden: string[];
}

/** 按模板算人工各项;手工覆盖优先并记录被覆盖项 */
export function calculateLabor(
  template: LaborRateTemplate,
  input: LaborInput,
): LaborBreakdown {
  const boards = dec(input.boards);
  const overridden: string[] = [];

  const pick = (key: "smt" | "dip" | "test" | "labor", computed: Decimal): Decimal => {
    const o = input.overrides?.[key];
    if (o !== undefined && o !== null && o !== "") {
      overridden.push(key);
      return dec(o);
    }
    return computed;
  };

  return {
    smt: pick("smt", dec(input.smtPoints).mul(dec(template.smtRatePerPoint)).mul(boards)),
    dip: pick("dip", dec(input.dipPoints).mul(dec(template.dipRatePerPoint)).mul(boards)),
    test: pick("test", dec(input.testHours).mul(dec(template.testRatePerHour))),
    labor: pick("labor", boards.mul(dec(template.laborRatePerBoard))),
    overridden,
  };
}

// ============================================================
// 3. 整单汇总
// ============================================================

export interface QuoteLineForCalc {
  lineNo: number;
  category: QuoteCostCategoryValue;
  qty?: string | number | null;
  purchaseCost?: string | number | null;
  markupPct?: string | number | null;
  /** 人工指定的客户报价单价;给出即覆盖 Markup 计算值 */
  customerPrice?: string | number | null;
  baselineCost?: string | number | null;
}

export interface CalculatedLine {
  lineNo: number;
  category: QuoteCostCategoryValue;
  qty: string;
  purchaseCost: string;
  markupPct: string | null;
  /** Markup 算出的最终物料报价(单价) */
  finalUnitPrice: string;
  /** 实际用于计算的客户报价单价(人工覆盖优先) */
  effectiveUnitPrice: string;
  /** 是否人工覆盖了 Markup 计算值 */
  priceOverridden: boolean;
  extended: string;
  ppv: string | null;
}

export interface QuoteSummary {
  lines: CalculatedLine[];
  /** 各成本分类小计 */
  byCategory: Record<QuoteCostCategoryValue, string>;
  /** 管理费之前的小计 */
  subtotalBeforeOverhead: string;
  overhead: string;
  grandTotal: string;
  /** PPV 合计(仅统计给出基准的行) */
  ppvTotal: string;
  currency: string;
}

export interface SummaryOptions {
  currency: string;
  /** 管理费费率(对小计取百分比);与 OVERHEAD 分类行二选一,两者都给则相加 */
  overheadPct?: string | number | null;
  /** 金额舍入位数(展示与快照用) */
  decimals?: number;
}

/**
 * 整单汇总:逐行计算 → 分类小计 → 管理费 → 总价。
 * 舍入只在最终输出时发生一次,中间全精度,避免逐行舍入误差累积。
 */
export function summarizeQuote(
  lines: readonly QuoteLineForCalc[],
  options: SummaryOptions,
): QuoteSummary {
  const decimals = options.decimals ?? 2;
  const calculated: CalculatedLine[] = [];
  const byCategory = Object.fromEntries(
    QUOTE_COST_CATEGORIES.map((c) => [c, new Decimal(0)]),
  ) as Record<QuoteCostCategoryValue, Decimal>;
  let ppvTotal = new Decimal(0);

  for (const l of lines) {
    const qty = dec(l.qty, "1");
    const purchaseCost = dec(l.purchaseCost);
    const hasMarkup = l.markupPct !== null && l.markupPct !== undefined && l.markupPct !== "";
    const finalUnitPrice = calculateFinalUnitPrice(purchaseCost, l.markupPct);
    const overridden =
      l.customerPrice !== null && l.customerPrice !== undefined && l.customerPrice !== "";
    const effective = overridden ? dec(l.customerPrice) : finalUnitPrice;
    const extended = calculateLineExtended(effective, qty);
    const ppv = calculatePpv(purchaseCost, l.baselineCost, qty);

    byCategory[l.category] = byCategory[l.category].plus(extended);
    if (ppv) ppvTotal = ppvTotal.plus(ppv);

    calculated.push({
      lineNo: l.lineNo,
      category: l.category,
      qty: qty.toFixed(),
      purchaseCost: purchaseCost.toFixed(),
      markupPct: hasMarkup ? dec(l.markupPct).toFixed() : null,
      finalUnitPrice: roundMoney(finalUnitPrice, decimals).toFixed(decimals),
      effectiveUnitPrice: roundMoney(effective, decimals).toFixed(decimals),
      priceOverridden: overridden,
      extended: roundMoney(extended, decimals).toFixed(decimals),
      ppv: ppv ? roundMoney(ppv, decimals).toFixed(decimals) : null,
    });
  }

  // 管理费:分类行小计 + 按费率计提(两者可并存)
  const subtotalBeforeOverhead = QUOTE_COST_CATEGORIES.filter((c) => c !== "OVERHEAD").reduce(
    (acc, c) => acc.plus(byCategory[c]),
    new Decimal(0),
  );
  const overheadFromRate = subtotalBeforeOverhead.mul(dec(options.overheadPct));
  const overhead = byCategory.OVERHEAD.plus(overheadFromRate);
  const grandTotal = subtotalBeforeOverhead.plus(overhead);

  return {
    lines: calculated,
    byCategory: Object.fromEntries(
      QUOTE_COST_CATEGORIES.map((c) => [
        c,
        roundMoney(c === "OVERHEAD" ? overhead : byCategory[c], decimals).toFixed(decimals),
      ]),
    ) as Record<QuoteCostCategoryValue, string>,
    subtotalBeforeOverhead: roundMoney(subtotalBeforeOverhead, decimals).toFixed(decimals),
    overhead: roundMoney(overhead, decimals).toFixed(decimals),
    grandTotal: roundMoney(grandTotal, decimals).toFixed(decimals),
    ppvTotal: roundMoney(ppvTotal, decimals).toFixed(decimals),
    currency: options.currency,
  };
}
