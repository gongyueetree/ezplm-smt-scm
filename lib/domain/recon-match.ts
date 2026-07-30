/**
 * 对账差异自动识别(客户 xlsx「对账差异自动识别、高亮标注与预警」—— 原标注为「无」)。
 *
 * 输入两侧明细:`theirs`(对方发来的对账单)与 `ours`(我方基准)。
 * 我方基准的来源见数据层:AP 用已批准 PO 行,AR 用已批准报价快照,
 * 或由 ERP 导出的出入库明细上传 —— **本系统不拥有出货/入库数据**,不假装拥有。
 *
 * 纪律:
 * - **异币种不做换算**(全局规则):判「币种不一致」,差额返回 null,不按某个汇率折过来;
 * - **金额对得上但数量/单价对不上,绝不判一致** —— 这是最危险的一类:
 *   数量少算、单价多算,乘出来的金额恰好相同,看着没事其实两边记的不是一回事;
 * - 只在一侧出现的行,明确说是「仅对方有」还是「仅我方有」,
 *   不用"匹配失败"这种含糊说法糊过去;
 * - 容差是**口径**不是魔法数:默认一分钱,由调用方传入并在 UI 标注。
 */
import Decimal from "decimal.js";

/** 一侧的一行明细 */
export interface ReconSideLine {
  /** 单据号(发票号/送货单号);与行号一起构成首选匹配键 */
  docNo: string | null;
  docLineNo: number | null;
  mpn: string | null;
  qty: string | null;
  unitPrice: string | null;
  /** 金额;缺失时由 qty × unitPrice 推出 */
  amount: string | null;
  currency: string;
  /** 到期日(账龄输入) */
  dueDate?: string | null;
}

export type ReconVerdict =
  | "一致"
  | "数量差异"
  | "单价差异"
  | "金额差异"
  | "币种不一致"
  | "仅对方有"
  | "仅我方有";

export interface ReconMatchedLine {
  lineNo: number;
  /** 匹配键,便于人工回查 */
  key: string;
  theirs: ReconSideLine | null;
  ours: ReconSideLine | null;
  verdict: ReconVerdict;
  /** 对方 − 我方(同币种);不可比时 null */
  diffAmount: string | null;
  /** 逐项差异说明 */
  details: string[];
  severity: "error" | "warn" | "info";
  dueDate: string | null;
}

export interface ReconSummary {
  currency: string;
  /** 同币种内合计;异币种行不并入 */
  theirTotal: string;
  ourTotal: string
  diffTotal: string;
  mixedCurrency: boolean;
  matched: number;
  differing: number;
  onlyTheirs: number;
  onlyOurs: number;
  /** 有异币种或缺值导致无法比较的行数 */
  incomparable: number;
}

export interface ReconMatchResult {
  lines: ReconMatchedLine[];
  summary: ReconSummary;
}

/** 默认容差:一分钱。**是口径不是魔法数**,UI 必须标注 */
export const DEFAULT_AMOUNT_TOLERANCE = "0.01";

function dec(v: string | null | undefined): Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    const d = new Decimal(v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** 金额:优先用给定金额;没给就用 数量 × 单价 推 */
function amountOf(line: ReconSideLine): Decimal | null {
  const given = dec(line.amount);
  if (given !== null) return given;
  const q = dec(line.qty);
  const p = dec(line.unitPrice);
  if (q === null || p === null) return null;
  return q.mul(p);
}

/**
 * 匹配键:单据号 + 行号优先(最准);否则单据号 + MPN;否则只用 MPN。
 * 全空的行给一个占位键,保证不会互相错配。
 */
export function matchKey(line: ReconSideLine, fallbackIndex: number): string {
  const doc = line.docNo?.trim().toUpperCase() ?? "";
  const mpn = line.mpn?.trim().toUpperCase() ?? "";
  if (doc && line.docLineNo !== null && line.docLineNo !== undefined) {
    return `${doc}#${line.docLineNo}`;
  }
  if (doc && mpn) return `${doc}|${mpn}`;
  if (doc) return doc;
  if (mpn) return `MPN|${mpn}`;
  return `__unkeyed_${fallbackIndex}`;
}

export interface ReconMatchOptions {
  /** 金额容差(同币种);默认一分钱 */
  amountTolerance?: string;
  /** 合计所用的基准币种;缺省取对方对账单第一行的币种 */
  baseCurrency?: string;
}

export function matchReconLines(
  theirs: readonly ReconSideLine[],
  ours: readonly ReconSideLine[],
  options: ReconMatchOptions = {},
): ReconMatchResult {
  const tol = dec(options.amountTolerance ?? DEFAULT_AMOUNT_TOLERANCE) ?? new Decimal("0.01");
  const baseCurrency = (
    options.baseCurrency ??
    theirs[0]?.currency ??
    ours[0]?.currency ??
    "CNY"
  ).toUpperCase();

  const oursByKey = new Map<string, ReconSideLine[]>();
  ours.forEach((o, i) => {
    const k = matchKey(o, i);
    const arr = oursByKey.get(k) ?? [];
    arr.push(o);
    oursByKey.set(k, arr);
  });

  const lines: ReconMatchedLine[] = [];
  const consumed = new Set<ReconSideLine>();
  let lineNo = 0;

  const pushLine = (l: Omit<ReconMatchedLine, "lineNo">) => {
    lineNo += 1;
    lines.push({ ...l, lineNo });
  };

  for (let i = 0; i < theirs.length; i += 1) {
    const t = theirs[i];
    const key = matchKey(t, i);
    const candidates = oursByKey.get(key) ?? [];
    const o = candidates.find((c) => !consumed.has(c)) ?? null;

    if (!o) {
      pushLine({
        key,
        theirs: t,
        ours: null,
        verdict: "仅对方有",
        diffAmount: amountOf(t)?.toFixed() ?? null,
        details: ["我方基准中找不到对应行 —— 需查明是漏记、未入账,还是对方多开"],
        severity: "error",
        dueDate: t.dueDate ?? null,
      });
      continue;
    }
    consumed.add(o);

    const details: string[] = [];

    if (t.currency.toUpperCase() !== o.currency.toUpperCase()) {
      pushLine({
        key,
        theirs: t,
        ours: o,
        verdict: "币种不一致",
        diffAmount: null,
        details: [
          `对方 ${t.currency.toUpperCase()} vs 我方 ${o.currency.toUpperCase()};系统不做汇率换算,金额不可比`,
        ],
        severity: "error",
        dueDate: t.dueDate ?? o.dueDate ?? null,
      });
      continue;
    }

    const tq = dec(t.qty);
    const oq = dec(o.qty);
    const tp = dec(t.unitPrice);
    const op = dec(o.unitPrice);
    const ta = amountOf(t);
    const oa = amountOf(o);

    const qtyDiffers = tq !== null && oq !== null && !tq.eq(oq);
    const priceDiffers = tp !== null && op !== null && !tp.eq(op);
    const amountDiff = ta !== null && oa !== null ? ta.minus(oa) : null;
    const amountDiffers = amountDiff !== null && amountDiff.abs().gt(tol);

    if (qtyDiffers) details.push(`数量:对方 ${tq!.toFixed()} vs 我方 ${oq!.toFixed()}`);
    if (priceDiffers) details.push(`单价:对方 ${tp!.toFixed()} vs 我方 ${op!.toFixed()}`);
    if (amountDiffers) {
      details.push(
        `金额:对方 ${ta!.toFixed()} vs 我方 ${oa!.toFixed()},差额 ${amountDiff!.toFixed()}`,
      );
    }
    if (amountDiff === null) {
      details.push("一侧缺少金额且无法由数量×单价推出 —— 金额不可比");
    }

    let verdict: ReconVerdict;
    let severity: ReconMatchedLine["severity"];
    if (amountDiffers) {
      verdict = "金额差异";
      severity = "error";
    } else if (qtyDiffers || priceDiffers) {
      // 金额恰好对得上,但数量/单价对不上 —— 最危险的一类,绝不判一致
      verdict = qtyDiffers ? "数量差异" : "单价差异";
      severity = "error";
      details.push(
        "金额合得上但明细对不上(数量与单价互相抵消)—— 两边记的不是同一件事,必须查清",
      );
    } else if (amountDiff === null) {
      verdict = "金额差异";
      severity = "warn";
    } else {
      verdict = "一致";
      severity = "info";
      details.push("数量、单价、金额均在容差内一致");
    }

    pushLine({
      key,
      theirs: t,
      ours: o,
      verdict,
      diffAmount: amountDiff?.toFixed() ?? null,
      details,
      severity,
      dueDate: t.dueDate ?? o.dueDate ?? null,
    });
  }

  // 我方有、对方没有的行
  ours.forEach((o, i) => {
    if (consumed.has(o)) return;
    pushLine({
      key: matchKey(o, i),
      theirs: null,
      ours: o,
      verdict: "仅我方有",
      diffAmount: amountOf(o) ? `-${amountOf(o)!.toFixed()}` : null,
      details: ["对方对账单中没有此行 —— 需查明是对方漏记还是我方多记"],
      severity: "error",
      dueDate: o.dueDate ?? null,
    });
  });

  // 合计:只在基准币种内累加,异币种行不并入(标注 mixedCurrency)
  let theirTotal = new Decimal(0);
  let ourTotal = new Decimal(0);
  const currencies = new Set<string>();
  for (const l of lines) {
    if (l.theirs) currencies.add(l.theirs.currency.toUpperCase());
    if (l.ours) currencies.add(l.ours.currency.toUpperCase());
    if (l.theirs && l.theirs.currency.toUpperCase() === baseCurrency) {
      theirTotal = theirTotal.add(amountOf(l.theirs) ?? 0);
    }
    if (l.ours && l.ours.currency.toUpperCase() === baseCurrency) {
      ourTotal = ourTotal.add(amountOf(l.ours) ?? 0);
    }
  }

  return {
    lines,
    summary: {
      currency: baseCurrency,
      theirTotal: theirTotal.toFixed(),
      ourTotal: ourTotal.toFixed(),
      diffTotal: theirTotal.minus(ourTotal).toFixed(),
      mixedCurrency: currencies.size > 1,
      matched: lines.filter((l) => l.verdict === "一致").length,
      differing: lines.filter((l) =>
        ["数量差异", "单价差异", "金额差异"].includes(l.verdict),
      ).length,
      onlyTheirs: lines.filter((l) => l.verdict === "仅对方有").length,
      onlyOurs: lines.filter((l) => l.verdict === "仅我方有").length,
      incomparable: lines.filter(
        (l) => l.verdict === "币种不一致" || (l.diffAmount === null && l.ours && l.theirs),
      ).length,
    },
  };
}
