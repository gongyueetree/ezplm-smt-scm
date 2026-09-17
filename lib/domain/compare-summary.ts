/**
 * 比价总表汇总(纯函数)。
 *
 * N-5.E(客户 PR2 反馈 采购-4E:「点击比价,导出最后总表,需要显示所有供应商的价格,
 * 显示所有供应商的替代料,特殊备注,显示最高价和最低价,和相对应的供应商」)。
 *
 * 纪律:
 * - 价格一律走 Decimal,**不用浮点比大小** —— 0.1 + 0.2 那类误差会让"最低价"选错供应商;
 * - **异币种不放进同一次最高/最低比较**。1 USD 和 1 CNY 比大小是无意义的,
 *   系统里也没有汇率源(N-2 尚未实现)。混币种时按币种分组各自算,并标注;
 * - 没有报价的料号**不给最高/最低**,返回 null 而不是 0 —— 0 会被当成"报价 0 元";
 * - 只有一个报价时最高 = 最低 = 它,但要标出"仅一个报价",
 *   否则"最低价 12.5"看起来像是比过一圈的结论。
 */
import Decimal from "decimal.js";
import { isUsablePrice } from "./price-guard";

export interface CompareOfferInput {
  supplierName: string;
  /** 来源:OFFLINE / DIGIKEY / MOUSER … 用于总表标注 */
  source: string;
  mpn: string;
  /** 该供应商实际报的型号 —— 与询价 MPN 不同即为替代料 */
  quotedMpn: string | null;
  manufacturer: string | null;
  currency: string;
  /** 单价;无价为 null(**不是 0**) */
  unitPrice: string | null;
  moq: number | null;
  spq: number | null;
  leadTimeDays: number | null;
  note: string | null;
}

export interface CurrencyExtreme {
  currency: string;
  lowest: { supplierName: string; unitPrice: string } | null;
  highest: { supplierName: string; unitPrice: string } | null;
  /** 该币种下参与比较的报价数 */
  offerCount: number;
}

export interface CompareSummaryRow {
  mpn: string;
  /** 每个币种各自的最高/最低 —— 异币种绝不混比 */
  byCurrency: CurrencyExtreme[];
  /** 替代料:供应商报的型号与询价型号不同 */
  alternates: { supplierName: string; quotedMpn: string; manufacturer: string | null }[];
  /** 特殊备注(供应商 + 备注原文) */
  notes: { supplierName: string; note: string }[];
  offers: CompareOfferInput[];
  /** 无任何有效报价时为 true —— 页面/导出必须显式说明,不能留空白让人以为没问题 */
  noQuote: boolean;
  /** 只有一个报价:最高=最低,但不构成"比过一圈"的结论 */
  singleQuoteCurrencies: string[];
  /** 出现了多种币种 —— 需要人工换算才能横向比 */
  mixedCurrency: boolean;
}

function toDec(v: string | null): Decimal | null {
  if (v === null || v.trim() === "") return null;
  try {
    const d = new Decimal(v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** 按 MPN 汇总一份可直接落表的比价总表 */
export function buildCompareSummary(offers: readonly CompareOfferInput[]): CompareSummaryRow[] {
  const byMpn = new Map<string, CompareOfferInput[]>();
  for (const o of offers) {
    const list = byMpn.get(o.mpn) ?? [];
    list.push(o);
    byMpn.set(o.mpn, list);
  }

  return [...byMpn.entries()].map(([mpn, list]) => {
    // R0-8:toDec("0") 返回 Decimal(0) 而非 null,若只判 null,
    // 一行 0 价会被当成真实报价并选成最低价(客户在前期版本上撞到的正是这个)。
    const priced = list.filter((o) => toDec(o.unitPrice) !== null && isUsablePrice(o.unitPrice));

    // 按币种分组各自算极值 —— 没有汇率源就绝不跨币种比大小
    const currencies = [...new Set(priced.map((o) => o.currency.toUpperCase()))].sort();
    const byCurrency: CurrencyExtreme[] = currencies.map((cur) => {
      const inCur = priced.filter((o) => o.currency.toUpperCase() === cur);
      let lo = inCur[0];
      let hi = inCur[0];
      for (const o of inCur) {
        if (toDec(o.unitPrice)!.lt(toDec(lo.unitPrice)!)) lo = o;
        if (toDec(o.unitPrice)!.gt(toDec(hi.unitPrice)!)) hi = o;
      }
      return {
        currency: cur,
        lowest: { supplierName: lo.supplierName, unitPrice: lo.unitPrice! },
        highest: { supplierName: hi.supplierName, unitPrice: hi.unitPrice! },
        offerCount: inCur.length,
      };
    });

    const alternates = list
      .filter((o) => o.quotedMpn && o.quotedMpn.trim() !== "" && o.quotedMpn.trim() !== mpn)
      .map((o) => ({
        supplierName: o.supplierName,
        quotedMpn: o.quotedMpn!.trim(),
        manufacturer: o.manufacturer,
      }));

    const notes = list
      .filter((o) => o.note && o.note.trim() !== "")
      .map((o) => ({ supplierName: o.supplierName, note: o.note!.trim() }));

    return {
      mpn,
      byCurrency,
      alternates,
      notes,
      offers: list,
      noQuote: priced.length === 0,
      singleQuoteCurrencies: byCurrency.filter((c) => c.offerCount === 1).map((c) => c.currency),
      mixedCurrency: currencies.length > 1,
    };
  });
}

/** 总表的一行文字摘要 —— 导出与页面共用同一套措辞,避免两处说法不一 */
export function summarizeExtremes(row: CompareSummaryRow): string {
  if (row.noQuote) return "无有效报价 —— 未参与比价";
  const parts = row.byCurrency.map((c) => {
    const base = `${c.currency}:最低 ${c.lowest!.unitPrice}(${c.lowest!.supplierName})· 最高 ${c.highest!.unitPrice}(${c.highest!.supplierName})`;
    return c.offerCount === 1 ? `${base} —— 仅 1 个报价,不构成比价结论` : base;
  });
  const mixed = row.mixedCurrency ? ";**含多种币种,系统未做汇率换算,需人工横向比对**" : "";
  return parts.join(" | ") + mixed;
}
