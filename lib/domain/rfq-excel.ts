/**
 * R4-7(§42):线下 Supplier RFQ Excel —— 导出行构造与回传解析(纯函数)。
 *
 * 布局:一颗料多档阶梯 = 多行(料字段重复,阶梯字段逐行);
 * 解析按 (Internal PN, Quoted MPN) 分组聚合 PriceBreak[],**绝不只留最低价**。
 * blank→null / 非法数值→行 issue(与 Integration Agent 同纪律)。
 */

export const RFQ_EXPORT_HEADERS = [
  "RFQ No",
  "Supplier",
  "Internal PN",
  "MPN",
  "Manufacturer",
  "Description",
  "Requested Qty",
  // ---- 供应商填写区(§42) ----
  "Quoted MPN",
  "Quoted Manufacturer",
  "MOQ",
  "SPQ",
  "Price Break Qty",
  "Unit Price",
  "Currency",
  "Lead Time (days)",
  "Valid Until",
  "Remark",
] as const;

export interface RfqExportLine {
  rfqNo: string;
  supplierName: string;
  internalPn: string | null;
  mpn: string | null;
  manufacturer: string | null;
  description: string | null;
  requestedQty: string;
}

export function buildRfqExportRows(lines: RfqExportLine[]): (string | number)[][] {
  return [
    [...RFQ_EXPORT_HEADERS],
    ...lines.map((l) => [
      l.rfqNo,
      l.supplierName,
      l.internalPn ?? "",
      l.mpn ?? "",
      l.manufacturer ?? "",
      l.description ?? "",
      l.requestedQty,
      "", "", "", "", "", "", "", "", "", "",
    ]),
  ];
}

export interface QuoteUploadIssue {
  row: number;
  message: string;
}

export interface ParsedQuoteBreak {
  minQty: string;
  unitPrice: string;
  sourceRow: number;
}

export interface ParsedQuoteGroup {
  internalPn: string | null;
  requestedMpn: string | null;
  quotedMpn: string;
  quotedManufacturer: string | null;
  moq: string | null;
  spq: string | null;
  currency: string;
  leadTimeDays: number | null;
  validUntil: string | null;
  remark: string | null;
  breaks: ParsedQuoteBreak[];
}

const BLANK = /^\s*$/;
const dec = (v: string) => /^\d+(\.\d+)?$/.test(v.replace(/,/g, ""));

/**
 * 解析供应商回传的报价 sheet(与导出同布局)。
 * 规则:
 * - 未填 Quoted MPN 且未填价 = 供应商放弃该行(跳过,不报错);
 * - 有价必须有 Price Break Qty 与 Currency;
 * - 同组多行的 MOQ/SPQ/LT/币种/有效期以**首个非空**为准,冲突记 issue;
 * - 阶梯 minQty 重复 → issue(不猜哪档算数)。
 */
export function parseQuoteRows(
  rows: { rowNo: number; cells: Record<string, string> }[],
): { groups: ParsedQuoteGroup[]; issues: QuoteUploadIssue[]; skippedRows: number } {
  const groups = new Map<string, ParsedQuoteGroup>();
  const issues: QuoteUploadIssue[] = [];
  let skippedRows = 0;

  for (const r of rows) {
    const c = (h: string) => (r.cells[h] ?? "").trim();
    const rawQuotedMpn = c("Quoted MPN");
    const price = c("Unit Price");
    // 放弃报价判定先于「沿用询价 MPN」的缺省 —— 否则询价 MPN 会让空行误判为漏价
    if (BLANK.test(rawQuotedMpn) && BLANK.test(price)) {
      skippedRows++;
      continue;
    }
    const quotedMpn = rawQuotedMpn || c("MPN"); // 未换型号时沿用询价 MPN
    if (!quotedMpn) {
      issues.push({ row: r.rowNo, message: "有报价但缺 Quoted MPN" });
      continue;
    }
    if (!price || !dec(price)) {
      issues.push({ row: r.rowNo, message: `单价缺失或非法「${price}」` });
      continue;
    }
    const breakQty = c("Price Break Qty") || c("MOQ") || "1";
    if (!dec(breakQty)) {
      issues.push({ row: r.rowNo, message: `Price Break Qty 非法「${c("Price Break Qty")}」` });
      continue;
    }
    const currency = c("Currency").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      issues.push({ row: r.rowNo, message: `币种缺失或非法「${c("Currency")}」` });
      continue;
    }

    const key = `${c("Internal PN").toUpperCase()}|${quotedMpn.toUpperCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        internalPn: c("Internal PN") || null,
        requestedMpn: c("MPN") || null,
        quotedMpn,
        quotedManufacturer: c("Quoted Manufacturer") || c("Manufacturer") || null,
        moq: null,
        spq: null,
        currency,
        leadTimeDays: null,
        validUntil: null,
        remark: null,
        breaks: [],
      };
      groups.set(key, g);
    }
    if (g.currency !== currency) {
      issues.push({ row: r.rowNo, message: `同一料的币种前后不一致(${g.currency} vs ${currency})` });
      continue;
    }
    const fill = (cur: string | null, v: string): string | null => (cur !== null ? cur : v || null);
    const moq = c("MOQ");
    if (moq && !dec(moq)) issues.push({ row: r.rowNo, message: `MOQ 非法「${moq}」` });
    else g.moq = fill(g.moq, moq.replace(/,/g, ""));
    const spq = c("SPQ");
    if (spq && !dec(spq)) issues.push({ row: r.rowNo, message: `SPQ 非法「${spq}」` });
    else g.spq = fill(g.spq, spq.replace(/,/g, ""));
    const lt = c("Lead Time (days)");
    if (lt && /^\d+$/.test(lt)) g.leadTimeDays = g.leadTimeDays ?? Number(lt);
    else if (lt) issues.push({ row: r.rowNo, message: `Lead Time 非法「${lt}」` });
    const vu = c("Valid Until");
    if (vu && !Number.isNaN(Date.parse(vu))) g.validUntil = g.validUntil ?? vu;
    else if (vu) issues.push({ row: r.rowNo, message: `Valid Until 非法「${vu}」` });
    g.remark = g.remark ?? (c("Remark") || null);

    const minQty = breakQty.replace(/,/g, "");
    if (g.breaks.some((b) => b.minQty === minQty)) {
      issues.push({ row: r.rowNo, message: `阶梯数量 ${minQty} 重复 —— 不猜哪档算数,请修正` });
      continue;
    }
    g.breaks.push({ minQty, unitPrice: price.replace(/,/g, ""), sourceRow: r.rowNo });
  }

  return { groups: [...groups.values()], issues, skippedRows };
}
