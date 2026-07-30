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
