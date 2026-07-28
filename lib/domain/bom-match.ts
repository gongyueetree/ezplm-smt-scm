/**
 * BOM 匹配管线(SPEC §6 匹配顺序)。
 *
 * 顺序:客户料号映射 → 内部料号 → 精确 MPN → Manufacturer+MPN → 描述/规格/封装
 *      → ezPLM 候选 → DigiKey/Mouser 候选 → 人工确认。
 *
 * 纪律:
 * - AI/自动匹配只产出「候选 + 置信度」,**最终必须人工确认**(CLAUDE.md 硬性约束 3);
 *   因此本函数恒返回 requiresManualDecision=true,不存在"自动定案"分支。
 * - 已有本地高置信候选时不再打三方 API(省 Mouser 日配额与 DigiKey 限流)。
 * - 三方不可用时返回 degraded 标记与结构化错误,不阻断整张 BOM(SPEC §8)。
 */
import type { EzplmPartsProvider } from "@/lib/providers/ezplm";
import type { DistributorProvider } from "@/lib/providers/common/distributor";
import { ProviderError } from "@/lib/providers/common/errors";
import { manufacturerMatches, normalizeMpn } from "@/lib/providers/common/mpn";
import type { LifecycleValue } from "@/lib/providers/common/normalized-offer";
import { getApplicablePriceBreak } from "./offers";
import type { ParsedBomLine } from "./bom-parse";

export type MatchSourceValue =
  | "CUSTOMER_MAPPING"
  | "INTERNAL_PN"
  | "EXACT_MPN"
  | "MFR_MPN"
  | "DESCRIPTION"
  | "EZPLM"
  | "DIGIKEY"
  | "MOUSER";

/** 各来源的基准置信度:本地主数据 > 三方候选 > 描述模糊匹配 */
export const SOURCE_CONFIDENCE: Record<MatchSourceValue, number> = {
  CUSTOMER_MAPPING: 0.98,
  INTERNAL_PN: 0.97,
  MFR_MPN: 0.96,
  EXACT_MPN: 0.95,
  EZPLM: 0.8,
  DIGIKEY: 0.75,
  MOUSER: 0.75,
  DESCRIPTION: 0.55,
};

/** 达到此置信度即认为本地已命中,不再调用三方 API */
export const LOCAL_HIT_CONFIDENCE = 0.95;

/** SPEC §6 要求候选必须展示的字段 */
export interface MatchCandidate {
  source: MatchSourceValue;
  confidence: number;
  partId: string | null;
  mpn: string;
  manufacturer: string | null;
  footprint: string | null;
  lifecycle: LifecycleValue | null;
  stockQty: number | null;
  slowMovingQty: number | null;
  opoQty: number | null;
  eta: string | null;
  price: string | null;
  currency: string | null;
  alternates: { mpn: string; manufacturer: string | null }[] | null;
  /** 数据更新时间(诚实 UI:展示更新时间,不暗示实时) */
  dataUpdatedAt: string | null;
}

/** 本地主数据视图(由 repository 预取,匹配层不碰数据库) */
export interface LocalPartRef {
  partId: string;
  internalPn: string;
  mpn: string | null;
  manufacturer: string | null;
  footprint: string | null;
  lifecycle: LifecycleValue | null;
  description: string | null;
  stockQty: number | null;
  slowMovingQty: number | null;
  opoQty: number | null;
  eta: string | null;
  dataUpdatedAt: string | null;
}

export interface CustomerMappingRef {
  customerPn: string;
  internalPn: string | null;
  mpn: string | null;
  manufacturer: string | null;
}

export interface MatchContext {
  /** 客户料号映射(标准化 customerPn → 映射) */
  customerMappings?: Map<string, CustomerMappingRef>;
  /** 本地物料:按标准化内部料号索引 */
  byInternalPn?: Map<string, LocalPartRef>;
  /** 本地物料:按标准化 MPN 索引(同 MPN 多厂商时多条) */
  byMpn?: Map<string, LocalPartRef[]>;
  /** 全量本地物料,供描述模糊匹配 */
  allParts?: LocalPartRef[];
  ezplm?: EzplmPartsProvider;
  distributors?: DistributorProvider[];
  /** 询价数量(取三方阶梯价用);缺省取 BOM 行数量 */
  quantity?: number;
}

export interface MatchResult {
  lineNo: number;
  candidates: MatchCandidate[];
  /** 恒为 true:正式匹配必须人工确认 */
  requiresManualDecision: true;
  /** 三方降级信息(provider 不可用时,不阻断整单) */
  degraded: { provider: string; kind: string; message: string }[];
}

function keyOf(v: string | null | undefined): string {
  return normalizeMpn(v ?? "");
}

function fromLocal(part: LocalPartRef, source: MatchSourceValue, confidence: number): MatchCandidate {
  return {
    source,
    confidence,
    partId: part.partId,
    mpn: part.mpn ?? part.internalPn,
    manufacturer: part.manufacturer,
    footprint: part.footprint,
    lifecycle: part.lifecycle,
    stockQty: part.stockQty,
    slowMovingQty: part.slowMovingQty,
    opoQty: part.opoQty,
    eta: part.eta,
    price: null,
    currency: null,
    alternates: null,
    dataUpdatedAt: part.dataUpdatedAt,
  };
}

/** 描述模糊匹配打分:词元交集比例(0–1) */
export function describeSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const tok = (s: string) =>
    new Set(
      s
        .toUpperCase()
        .split(/[^0-9A-Z一-龥]+/)
        .filter((t) => t.length >= 2),
    );
  const ta = tok(a);
  const tb = tok(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return hit / Math.max(ta.size, tb.size);
}

/** 候选去重:同 source + 同 MPN 只留置信度最高者 */
function dedupeCandidates(list: MatchCandidate[]): MatchCandidate[] {
  const best = new Map<string, MatchCandidate>();
  for (const c of list) {
    const k = `${c.source}|${keyOf(c.mpn)}|${(c.manufacturer ?? "").toUpperCase()}`;
    const prev = best.get(k);
    if (!prev || c.confidence > prev.confidence) best.set(k, c);
  }
  return [...best.values()].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    // 置信度相同时按来源顺序与 MPN 排序,保证结果稳定
    const order = Object.keys(SOURCE_CONFIDENCE);
    const d = order.indexOf(a.source) - order.indexOf(b.source);
    return d !== 0 ? d : a.mpn.localeCompare(b.mpn);
  });
}

/** 单行匹配(SPEC §6 全流程) */
export async function matchBomLine(
  line: ParsedBomLine,
  ctx: MatchContext = {},
): Promise<MatchResult> {
  const candidates: MatchCandidate[] = [];
  const degraded: MatchResult["degraded"] = [];

  // ① 客户料号映射
  const cm = line.customerPn ? ctx.customerMappings?.get(keyOf(line.customerPn)) : undefined;
  if (cm) {
    const part = cm.internalPn ? ctx.byInternalPn?.get(keyOf(cm.internalPn)) : undefined;
    candidates.push(
      part
        ? fromLocal(part, "CUSTOMER_MAPPING", SOURCE_CONFIDENCE.CUSTOMER_MAPPING)
        : {
            source: "CUSTOMER_MAPPING",
            confidence: SOURCE_CONFIDENCE.CUSTOMER_MAPPING,
            partId: null,
            mpn: cm.mpn ?? cm.internalPn ?? cm.customerPn,
            manufacturer: cm.manufacturer,
            footprint: null,
            lifecycle: null,
            stockQty: null,
            slowMovingQty: null,
            opoQty: null,
            eta: null,
            price: null,
            currency: null,
            alternates: null,
            dataUpdatedAt: null,
          },
    );
  }

  // ② 内部料号
  const byInternal = line.internalPn ? ctx.byInternalPn?.get(keyOf(line.internalPn)) : undefined;
  if (byInternal) candidates.push(fromLocal(byInternal, "INTERNAL_PN", SOURCE_CONFIDENCE.INTERNAL_PN));

  // ③④ 精确 MPN / Manufacturer + MPN
  if (line.mpn) {
    const hits = ctx.byMpn?.get(keyOf(line.mpn)) ?? [];
    for (const p of hits) {
      const mfrHit = line.manufacturer
        ? manufacturerMatches(p.manufacturer, line.manufacturer)
        : false;
      candidates.push(
        fromLocal(
          p,
          mfrHit ? "MFR_MPN" : "EXACT_MPN",
          mfrHit ? SOURCE_CONFIDENCE.MFR_MPN : SOURCE_CONFIDENCE.EXACT_MPN,
        ),
      );
    }
  }

  // ⑤ 描述/规格/封装模糊匹配
  if (line.description && ctx.allParts?.length) {
    for (const p of ctx.allParts) {
      const sim = describeSimilarity(line.description, p.description);
      if (sim < 0.5) continue;
      const footprintOk =
        !line.footprint || !p.footprint
          ? true
          : line.footprint.toUpperCase().replace(/[^0-9A-Z]/g, "") ===
            p.footprint.toUpperCase().replace(/[^0-9A-Z]/g, "");
      if (!footprintOk) continue;
      candidates.push({
        ...fromLocal(p, "DESCRIPTION", Number((SOURCE_CONFIDENCE.DESCRIPTION * sim).toFixed(4))),
      });
    }
  }

  const localHit = candidates.some((c) => c.confidence >= LOCAL_HIT_CONFIDENCE);

  // ⑥ ezPLM 候选(本地已高置信命中则跳过,省接口调用)
  if (!localHit && ctx.ezplm && line.mpn) {
    try {
      const part = await ctx.ezplm.getPartByMpn({
        mpn: line.mpn,
        manufacturer: line.manufacturer ?? undefined,
      });
      if (part) {
        candidates.push({
          source: "EZPLM",
          confidence: SOURCE_CONFIDENCE.EZPLM,
          partId: part.id,
          mpn: part.mpn ?? part.internalPn ?? "(无 MPN)",
          manufacturer: part.manufacturer,
          footprint: part.footprint,
          lifecycle: part.lifecycle,
          stockQty: null,
          slowMovingQty: null,
          opoQty: null,
          eta: null,
          price: null,
          currency: null,
          alternates: null,
          dataUpdatedAt: part.updatedAt,
        });
      }
    } catch (e) {
      degraded.push(toDegraded(e, "EZPLM"));
    }
  }

  // ⑦ DigiKey / Mouser 候选(带正式价格:有 MPN 走 getOffersByMpn)
  if (!localHit && ctx.distributors?.length && line.mpn) {
    const qty = ctx.quantity ?? line.qty ?? 1;
    for (const d of ctx.distributors) {
      try {
        const offers = await d.getOffersByMpn({
          mpn: line.mpn,
          manufacturer: line.manufacturer ?? undefined,
          quantity: qty,
        });
        for (const o of offers) {
          const pb = getApplicablePriceBreak(o.priceBreaks, qty);
          candidates.push({
            source: d.name === "DIGIKEY" ? "DIGIKEY" : "MOUSER",
            confidence: SOURCE_CONFIDENCE[d.name === "DIGIKEY" ? "DIGIKEY" : "MOUSER"],
            partId: null,
            mpn: o.mpn,
            manufacturer: o.manufacturer,
            footprint: null,
            lifecycle: o.lifecycle,
            stockQty: o.stock,
            slowMovingQty: null,
            opoQty: null,
            eta: null,
            price: pb?.unitPrice ?? null,
            currency: pb ? o.currency : null,
            alternates: null,
            dataUpdatedAt: o.sourceUpdatedAt,
          });
        }
      } catch (e) {
        degraded.push(toDegraded(e, d.name));
      }
    }
  }

  return {
    lineNo: line.lineNo,
    candidates: dedupeCandidates(candidates),
    requiresManualDecision: true,
    degraded,
  };
}

function toDegraded(e: unknown, provider: string): MatchResult["degraded"][number] {
  if (e instanceof ProviderError) {
    return { provider: e.provider, kind: e.kind, message: e.message };
  }
  return { provider, kind: "unknown", message: e instanceof Error ? e.message : String(e) };
}

/**
 * 批量匹配:相同 MPN 只查一次三方(配额敏感),结果按行分发。
 * 调用方负责分批(见 import-batching.ts),本函数不做并发放大。
 */
export async function matchBomLines(
  lines: readonly ParsedBomLine[],
  ctx: MatchContext = {},
): Promise<MatchResult[]> {
  const cache = new Map<string, MatchResult>();
  const results: MatchResult[] = [];

  for (const line of lines) {
    const cacheKey = [
      keyOf(line.mpn),
      keyOf(line.manufacturer),
      keyOf(line.customerPn),
      keyOf(line.internalPn),
    ].join("|");
    const cached = cacheKey.replace(/\|/g, "") ? cache.get(cacheKey) : undefined;
    if (cached) {
      results.push({ ...cached, lineNo: line.lineNo });
      continue;
    }
    const result = await matchBomLine(line, ctx);
    if (cacheKey.replace(/\|/g, "")) cache.set(cacheKey, result);
    results.push(result);
  }
  return results;
}
