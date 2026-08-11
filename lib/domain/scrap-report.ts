/**
 * 损耗分析(客户 xlsx:「损耗报告 —— 筛选条件进行损耗分析 / 依据客户模板导出损耗」,原标注均为「无」)。
 *
 * 纪律:
 * - **分母为 0 或缺失时,损耗率是 null 而不是 0%**。发料 0 却报废 5 颗,
 *   算成 0% 会让最该查的那条看起来最健康;
 * - 汇总维度里"未填"单列一档,不并进某个具体值 —— 与 DC Aging、账龄同一条规矩;
 * - 只算不判:不给"超标/正常"结论,阈值口径未经甲方确认前不做判定。
 */
import Decimal from "decimal.js";

export interface ScrapRow {
  period: string;
  customerId: string | null;
  workOrder: string | null;
  mpn: string | null;
  /** 发料数量(损耗率分母) */
  issuedQty: string;
  /** 报废/损耗数量 */
  scrapQty: string;
  reason: string | null;
}

export type ScrapDimension = "mpn" | "customerId" | "reason" | "period";

export interface ScrapGroup {
  key: string;
  /** 该维度未填时用这个标记,UI 需单列 */
  isUnknown: boolean;
  issuedQty: string;
  scrapQty: string;
  /** 损耗率 = 报废 / 发料;分母为 0 或缺失时为 null(**不是 0**) */
  scrapRate: string | null;
  rowCount: number;
}

export interface ScrapSummary {
  totalIssued: string;
  totalScrap: string;
  /** 整体损耗率;总发料为 0 时为 null */
  overallRate: string | null;
  rowCount: number;
  /** 发料为 0 却有报废的行数 —— 单独暴露,这类最容易被平均值掩盖 */
  zeroIssuedWithScrap: number;
}

export const UNKNOWN_KEY = "__unknown__";

function dec(v: string | null | undefined): Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  try {
    const d = new Decimal(v);
    return d.isFinite() ? d : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

function rate(scrap: Decimal, issued: Decimal): string | null {
  if (issued.lte(0)) return null;
  return scrap.div(issued).toDecimalPlaces(6).toFixed();
}

export function summarizeScrap(rows: readonly ScrapRow[]): ScrapSummary {
  let issued = new Decimal(0);
  let scrap = new Decimal(0);
  let zeroIssuedWithScrap = 0;
  for (const r of rows) {
    const i = dec(r.issuedQty);
    const s = dec(r.scrapQty);
    issued = issued.add(i);
    scrap = scrap.add(s);
    if (i.lte(0) && s.gt(0)) zeroIssuedWithScrap += 1;
  }
  return {
    totalIssued: issued.toFixed(),
    totalScrap: scrap.toFixed(),
    overallRate: rate(scrap, issued),
    rowCount: rows.length,
    zeroIssuedWithScrap,
  };
}

export function groupScrap(
  rows: readonly ScrapRow[],
  dimension: ScrapDimension,
): ScrapGroup[] {
  const acc = new Map<string, { issued: Decimal; scrap: Decimal; count: number }>();
  for (const r of rows) {
    const raw = r[dimension];
    const key = raw && String(raw).trim() ? String(raw).trim() : UNKNOWN_KEY;
    const cur = acc.get(key) ?? { issued: new Decimal(0), scrap: new Decimal(0), count: 0 };
    cur.issued = cur.issued.add(dec(r.issuedQty));
    cur.scrap = cur.scrap.add(dec(r.scrapQty));
    cur.count += 1;
    acc.set(key, cur);
  }

  return [...acc.entries()]
    .map(([key, v]) => ({
      key,
      isUnknown: key === UNKNOWN_KEY,
      issuedQty: v.issued.toFixed(),
      scrapQty: v.scrap.toFixed(),
      scrapRate: rate(v.scrap, v.issued),
      rowCount: v.count,
    }))
    // 损耗量大的排前面;未知档永远排最后,避免它挤掉真正要看的
    .sort((a, b) => {
      if (a.isUnknown !== b.isUnknown) return a.isUnknown ? 1 : -1;
      return new Decimal(b.scrapQty).comparedTo(new Decimal(a.scrapQty));
    });
}

/** 导出模板的一列 */
export interface ScrapTemplateColumn {
  field: keyof ScrapRow | "scrapRate";
  header: string;
}

export const SCRAP_FIELD_LABELS: Record<ScrapTemplateColumn["field"], string> = {
  period: "期间",
  customerId: "客户",
  workOrder: "工单",
  mpn: "MPN",
  issuedQty: "发料数量",
  scrapQty: "报废数量",
  reason: "原因",
  scrapRate: "损耗率",
};

/** 默认模板:客户没给模板时用这一套 */
export const DEFAULT_SCRAP_COLUMNS: ScrapTemplateColumn[] = (
  ["period", "customerId", "workOrder", "mpn", "issuedQty", "scrapQty", "scrapRate", "reason"] as const
).map((f) => ({ field: f, header: SCRAP_FIELD_LABELS[f] }));

/** 按模板把一行摊平成导出用的值数组;损耗率不可算时输出「不可算」而非 0 */
export function renderScrapRow(row: ScrapRow, columns: readonly ScrapTemplateColumn[]): string[] {
  const r = rate(dec(row.scrapQty), dec(row.issuedQty));
  return columns.map((c) => {
    if (c.field === "scrapRate") {
      return r === null ? "不可算(发料为 0)" : `${(Number(r) * 100).toFixed(2)}%`;
    }
    const v = row[c.field];
    return v === null || v === undefined ? "" : String(v);
  });
}

/* ============================================================
 * N-12(客户 PR2 反馈 采购-13 损耗报告):
 *   ①按客户/日期/物料多维度 + **多月比较分析**
 *   ②按数量与**金额**分别分析
 *   ③带入 **STD 价格**
 *   ④导入/导出模板(已有)
 * ============================================================ */

/** 标准价查询:按 MPN 取标准成本;未维护时返回 null(**绝不回落成 0**) */
export type StandardCostLookup = (mpn: string | null) => {
  unitCost: string;
  currency: string;
} | null;

export interface ScrapAmountGroup extends ScrapGroup {
  /**
   * 损耗金额 = 报废数量 × 标准价。
   * **未维护标准价的部分不计入**,而是单列出来 —— 按 0 算会让金额凭空变小,
   * 反而把问题掩盖掉(损耗最严重的料往往正是没人维护主数据的那些)。
   */
  scrapAmount: string | null;
  /** 金额所用币种;组内出现多币种时为 null 并置 mixedCurrency */
  currency: string | null;
  /** 组内混了多种币种 —— 系统无汇率源,不做换算合计 */
  mixedCurrency: boolean;
  /** 该组里有多少行因为缺标准价而未计入金额 */
  rowsWithoutCost: number;
}

/** 在既有分组上叠加金额维度 */
export function groupScrapWithAmount(
  rows: readonly ScrapRow[],
  dimension: ScrapDimension,
  lookup: StandardCostLookup,
): ScrapAmountGroup[] {
  const base = groupScrap(rows, dimension);

  const amountByKey = new Map<
    string,
    { amount: Decimal; currencies: Set<string>; missing: number; priced: number }
  >();
  for (const r of rows) {
    const raw = r[dimension];
    const key = raw && String(raw).trim() ? String(raw).trim() : UNKNOWN_KEY;
    const cur =
      amountByKey.get(key) ??
      { amount: new Decimal(0), currencies: new Set<string>(), missing: 0, priced: 0 };
    const std = lookup(r.mpn);
    if (!std) {
      cur.missing += 1;
    } else {
      cur.amount = cur.amount.add(dec(r.scrapQty).mul(dec(std.unitCost)));
      cur.currencies.add(std.currency.toUpperCase());
      cur.priced += 1;
    }
    amountByKey.set(key, cur);
  }

  return base.map((g) => {
    const a = amountByKey.get(g.key);
    const mixed = (a?.currencies.size ?? 0) > 1;
    return {
      ...g,
      // 一条都没有标准价 → null(未知),不是 0
      scrapAmount: !a || a.priced === 0 || mixed ? null : a.amount.toFixed(2),
      currency: mixed || !a || a.currencies.size === 0 ? null : [...a.currencies][0],
      mixedCurrency: mixed,
      rowsWithoutCost: a?.missing ?? 0,
    };
  });
}

export interface PeriodTrendCell {
  period: string;
  issuedQty: string;
  scrapQty: string;
  scrapRate: string | null;
  scrapAmount: string | null;
}

export interface PeriodTrendRow {
  key: string;
  isUnknown: boolean;
  cells: PeriodTrendCell[];
  /**
   * 环比:最后一期相对前一期的损耗率变化(百分点)。
   * 任一期损耗率未知(发料为 0)时为 null —— **不拿 0 当基准算变化**。
   */
  rateDeltaPoints: string | null;
}

/**
 * 多月比较:行=维度取值,列=期间。
 *
 * 期间列表由**调用方给定并排序**,不从数据里推 ——
 * 数据里没有的月份也要出现在表里(那个月为空本身就是信息:
 * 是真的零损耗,还是那个月忘了导数据?两者绝不能长得一样)。
 */
export function buildPeriodTrend(
  rows: readonly ScrapRow[],
  dimension: Exclude<ScrapDimension, "period">,
  periods: readonly string[],
  lookup?: StandardCostLookup,
): PeriodTrendRow[] {
  const keys = new Set<string>();
  for (const r of rows) {
    const raw = r[dimension];
    keys.add(raw && String(raw).trim() ? String(raw).trim() : UNKNOWN_KEY);
  }

  const out: PeriodTrendRow[] = [...keys].map((key) => {
    const cells = periods.map((p) => {
      const sub = rows.filter((r) => {
        const raw = r[dimension];
        const k = raw && String(raw).trim() ? String(raw).trim() : UNKNOWN_KEY;
        return k === key && r.period === p;
      });
      const g = lookup
        ? groupScrapWithAmount(sub, dimension, lookup)[0]
        : groupScrap(sub, dimension)[0];
      return {
        period: p,
        issuedQty: g?.issuedQty ?? "0",
        scrapQty: g?.scrapQty ?? "0",
        scrapRate: g?.scrapRate ?? null,
        scrapAmount: (g as ScrapAmountGroup | undefined)?.scrapAmount ?? null,
      };
    });

    const last = cells[cells.length - 1];
    const prev = cells[cells.length - 2];
    const delta =
      last?.scrapRate && prev?.scrapRate
        ? new Decimal(last.scrapRate).sub(new Decimal(prev.scrapRate)).mul(100).toFixed(2)
        : null;

    return { key, isUnknown: key === UNKNOWN_KEY, cells, rateDeltaPoints: delta };
  });

  // 按最后一期损耗量降序;未知档永远最后
  return out.sort((a, b) => {
    if (a.isUnknown !== b.isUnknown) return a.isUnknown ? 1 : -1;
    const av = new Decimal(a.cells[a.cells.length - 1]?.scrapQty ?? "0");
    const bv = new Decimal(b.cells[b.cells.length - 1]?.scrapQty ?? "0");
    return bv.comparedTo(av);
  });
}

/** 生成最近 N 个期间标签(YYYY-MM),含当前期;调用方决定"当前"是哪一期 */
export function recentPeriods(currentPeriod: string, count: number): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(currentPeriod.trim());
  if (!m || count < 1) return [currentPeriod];
  let year = Number(m[1]);
  let month = Number(m[2]);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.unshift(`${year}-${String(month).padStart(2, "0")}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}
