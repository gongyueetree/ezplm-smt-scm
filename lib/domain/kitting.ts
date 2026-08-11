/**
 * 齐料检查与缺料分析(SPEC §16 路由 /kitting、/shortage)。
 *
 * 复用 GTB 口径(CLAUDE.md):每行需求 = ceil(单板用量 × 台数 × (1+损耗率)),
 * 缺口 = 需求 − 库存 − 在途,下限 0。
 *
 * 纪律:
 * - 库存/在途来自 ezPLM 只读缓存,**未知一律按 null 显式表达**,不当作 0 掩盖风险;
 * - 齐料日期取"所有缺口行 ETA 的最大值";**只要有一行缺口无 ETA,整单齐料日期就是未知**,
 *   绝不用已知 ETA 的最大值冒充"预计齐料日"。
 */
import { Decimal } from "decimal.js";
import { calculateGtb } from "./gtb";

export interface KittingLineInput {
  /** 内部料号;主数据里没有这颗料时为 null */
  internalPn?: string | null;
  lineNo: number;
  refDes: string | null;
  mpn: string | null;
  manufacturer: string | null;
  /** 单板用量 */
  qtyPerBoard: number;
  /** 库存;null = 未知(不等于 0) */
  stockQty: number | null;
  /** 在途未交量;null = 未知 */
  inTransitQty: number | null;
  /** 在途最早可用日期(ISO);无在途或未知为 null */
  eta: string | null;
  moq?: number | null;
  spq?: number | null;
}

export interface KittingLineResult {
  lineNo: number;
  refDes: string | null;
  internalPn: string | null;
  mpn: string | null;
  manufacturer: string | null;
  /** 本次投产总需求(含损耗,向上取整) */
  requiredQty: number;
  stockQty: number | null;
  inTransitQty: number | null;
  /** 缺口(需求 − 库存 − 在途,下限 0);库存或在途未知时为 null */
  shortageQty: number | null;
  /** 建议采购量(经 MOQ/SPQ 圆整);无缺口为 0,缺口未知为 null */
  suggestedPurchaseQty: number | null;
  eta: string | null;
  status: "ready" | "short" | "unknown";
}

export interface KittingSummary {
  boards: number;
  scrapRate: string;
  scrapRateConfirmed: false;
  totalLines: number;
  readyLines: number;
  shortLines: number;
  /** 库存或在途数据缺失、无法判定的行 */
  unknownLines: number;
  /** 齐套率 = 可齐料行 / 总行数;总行数为 0 时为 null */
  kitRate: number | null;
  /** 预计齐料日期;任一缺口行 ETA 未知则为 null */
  readyDate: string | null;
  /** readyDate 为 null 的原因(诚实说明) */
  readyDateBlockedBy: string | null;
}

export interface KittingReport {
  lines: KittingLineResult[];
  summary: KittingSummary;
}

export interface KittingOptions {
  boards: number;
  /** 损耗率;缺省 0(口径待甲方确认) */
  scrapRate?: string | number | null;
}

export function calculateKitting(
  lines: readonly KittingLineInput[],
  options: KittingOptions,
): KittingReport {
  const boards = Math.max(0, Math.trunc(options.boards));
  const scrapRate = options.scrapRate ?? "0";

  const results: KittingLineResult[] = lines.map((l) => {
    const demand = new Decimal(l.qtyPerBoard).mul(boards);
    const gtb = calculateGtb({
      demandQty: demand.toFixed(),
      scrapRate,
      stockQty: l.stockQty ?? 0,
      inTransitQty: l.inTransitQty ?? 0,
      moq: l.moq,
      spq: l.spq,
    });
    const requiredQty = Number(gtb.grossDemand);

    // 库存或在途未知 → 缺口无法判定,绝不按 0 当作"有货"
    const dataUnknown = l.stockQty === null || l.inTransitQty === null;
    if (dataUnknown) {
      return {
        lineNo: l.lineNo,
        refDes: l.refDes,
        internalPn: l.internalPn ?? null,
        mpn: l.mpn,
        manufacturer: l.manufacturer,
        requiredQty,
        stockQty: l.stockQty,
        inTransitQty: l.inTransitQty,
        shortageQty: null,
        suggestedPurchaseQty: null,
        eta: l.eta,
        status: "unknown",
      };
    }

    const shortageQty = Number(gtb.netDemand);
    return {
      lineNo: l.lineNo,
      refDes: l.refDes,
      internalPn: l.internalPn ?? null,
      mpn: l.mpn,
      manufacturer: l.manufacturer,
      requiredQty,
      stockQty: l.stockQty,
      inTransitQty: l.inTransitQty,
      shortageQty,
      suggestedPurchaseQty: gtb.purchaseQty,
      eta: l.eta,
      status: shortageQty > 0 ? "short" : "ready",
    };
  });

  const readyLines = results.filter((r) => r.status === "ready").length;
  const shortLines = results.filter((r) => r.status === "short").length;
  const unknownLines = results.filter((r) => r.status === "unknown").length;

  // 齐料日期:所有缺口行的 ETA 取最大值;任一缺口行无 ETA(或存在未知行)→ 整单未知
  const blockers = results.filter((r) => r.status === "short");
  const missingEta = blockers.filter((r) => !r.eta);
  let readyDate: string | null = null;
  let readyDateBlockedBy: string | null = null;

  if (unknownLines > 0) {
    readyDateBlockedBy = `${unknownLines} 行库存/在途数据未知,无法判定齐料日期`;
  } else if (missingEta.length > 0) {
    readyDateBlockedBy = `${missingEta.length} 行缺口无在途 ETA(需先采购),无法判定齐料日期`;
  } else if (blockers.length === 0) {
    readyDate = null;
    readyDateBlockedBy = null;
  } else {
    readyDate = blockers
      .map((r) => r.eta!)
      .reduce((max, cur) => (Date.parse(cur) > Date.parse(max) ? cur : max));
  }

  return {
    lines: results,
    summary: {
      boards,
      scrapRate: String(scrapRate),
      scrapRateConfirmed: false,
      totalLines: results.length,
      readyLines,
      shortLines,
      unknownLines,
      kitRate: results.length === 0 ? null : Number((readyLines / results.length).toFixed(4)),
      readyDate,
      readyDateBlockedBy,
    },
  };
}

/** 缺料清单(Call 料表):只列缺口行,按缺口量降序 */
export function deriveShortageList(report: KittingReport): KittingLineResult[] {
  return report.lines
    .filter((l) => l.status === "short" || l.status === "unknown")
    .sort((a, b) => {
      // 未知排在最前(风险最高:连缺不缺都不知道)
      if (a.status !== b.status) return a.status === "unknown" ? -1 : 1;
      return (b.shortageQty ?? 0) - (a.shortageQty ?? 0);
    });
}
