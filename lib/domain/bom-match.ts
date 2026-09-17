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
import { mfgPartNoKey } from "@/lib/domain/part-mfg";
import type { LifecycleValue } from "@/lib/providers/common/normalized-offer";
import { getApplicablePriceBreak } from "./offers";
import { rankBySimilarity, type SimilarityQuery } from "./similarity";
import type { ParsedBomLine } from "./bom-parse";

export type MatchSourceValue =
  | "CUSTOMER_MAPPING"
  | "INTERNAL_PN"
  /** R4-5(§27):乾创 PartMfgMapping —— canonical 厂商 + exact MPN 命中 */
  | "QC_MFG_MFR_MPN"
  /** R4-5(§27):乾创 PartMfgMapping —— exact MPN 命中(厂商未定/未一致) */
  | "QC_MFG_MPN"
  | "EXACT_MPN"
  | "MFR_MPN"
  | "DESCRIPTION"
  /** 本地物料库里按型号+封装相似度找出的候选(工程 BOM 只有 Value 时的主力) */
  | "LOCAL_SIMILAR"
  /** ezPLM 检索 + 相似度排序得到的候选 */
  | "EZPLM_SIMILAR"
  | "EZPLM"
  | "DIGIKEY"
  | "MOUSER";

/** 各来源的基准置信度:本地主数据 > 三方候选 > 描述模糊匹配 */
export const SOURCE_CONFIDENCE: Record<MatchSourceValue, number> = {
  CUSTOMER_MAPPING: 0.98,
  INTERNAL_PN: 0.97,
  QC_MFG_MFR_MPN: 0.96,
  MFR_MPN: 0.96,
  QC_MFG_MPN: 0.94,
  EXACT_MPN: 0.95,
  EZPLM: 0.8,
  DIGIKEY: 0.75,
  MOUSER: 0.75,
  /** 相似度候选:自家物料库优先于 ezPLM 全库(自家料才是能直接下单的) */
  LOCAL_SIMILAR: 0.7,
  EZPLM_SIMILAR: 0.6,
  DESCRIPTION: 0.55,
};

/** 达到此置信度即认为本地已命中,不再调用三方 API */
export const LOCAL_HIT_CONFIDENCE = 0.95;

/** SPEC §6 要求候选必须展示的字段 */
export interface MatchCandidate {
  source: MatchSourceValue;
  /** 判断依据(相似度候选必填):给人看为什么它排在这里 */
  matchReason?: string | null;
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

/** R4-5:乾创 MFG 映射引用(repository 定向预取,匹配层不碰库) */
export interface MfgMappingRef {
  partId: string;
  internalPn: string;
  manufacturerPartNo: string;
  rawManufacturer: string | null;
  canonicalManufacturerId: string | null;
  canonicalManufacturerName: string | null;
  relationType: "PRIMARY" | "APPROVED" | "ALTERNATE" | "HISTORICAL" | "MAINTAINED";
  status: "CANDIDATE" | "APPROVED" | "REJECTED" | "OBSOLETE";
  mappingSource: string;
  identifierKind: string;
  identifierMatchMode: "EXACT" | "PATTERN" | "UNKNOWN";
}

export type MaterialRouting = "COMPONENT" | "NON_COMPONENT" | "UNKNOWN";

export interface MatchContext {
  /** 客户料号映射(标准化 customerPn → 映射) */
  customerMappings?: Map<string, CustomerMappingRef>;
  /** 本地物料:按标准化内部料号索引 */
  byInternalPn?: Map<string, LocalPartRef>;
  /** 本地物料:按标准化 MPN 索引(同 MPN 多厂商时多条) */
  byMpn?: Map<string, LocalPartRef[]>;
  /** 相似度语料(可能截断 —— 截断必须经 similarityCorpusTruncated 显式上报) */
  allParts?: LocalPartRef[];
  /** 语料被截断时给出总量(诚实降级;精确通道不受影响) */
  similarityCorpusTruncated?: { loaded: number; total: number } | null;
  /** R4-5:partId → LocalPartRef(mfg 映射候选还原成料) */
  byPartId?: Map<string, LocalPartRef>;
  /** R4-5:normalizeMpn(MFG_PN) → 乾创映射(EXACT 且非 REJECTED/OBSOLETE) */
  mfgByMpnKey?: Map<string, MfgMappingRef[]>;
  /** R4-5:partId → 该料的可用 MFG 关系(内部料号命中后展示成组,§27) */
  mfgByPartId?: Map<string, MfgMappingRef[]>;
  /** R4-5:partId → MaterialKind(PCB/元器件分流,§28) */
  materialKindByPartId?: Map<string, string>;
  /** R4-5:BOM 原始厂商 → canonical(注入 ManufacturerResolver 结果;可选) */
  resolveMfr?: (raw: string | null) => { id: string; name: string } | null;
  ezplm?: EzplmPartsProvider;
  distributors?: DistributorProvider[];
  /** 询价数量(取三方阶梯价用);缺省取 BOM 行数量 */
  quantity?: number;
  /** 相似度候选条数上限(默认 5) */
  similarityLimit?: number;
  /** 送去做相似度排序前,从 ezPLM 拉多少条(默认 20) */
  ezplmSearchLimit?: number;
}

export interface MatchResult {
  lineNo: number;
  candidates: MatchCandidate[];
  /** 恒为 true:正式匹配必须人工确认 */
  requiresManualDecision: true;
  /** 三方降级信息(provider 不可用时,不阻断整单) */
  degraded: { provider: string; kind: string; message: string }[];
  /**
   * R4-5(§28):分流 —— NON_COMPONENT(如 PCB 裸板)跳过 ezPLM/DigiKey/Mouser
   * 元器件通道;UNKNOWN=行未命中本地料,无法判定,保守走元器件通道
   */
  routing: MaterialRouting;
  /** R4-5(§27):内部料号命中时,该料的 MFG 关系组(一料多厂展示) */
  mfgParts: MfgMappingRef[];
}

function keyOf(v: string | null | undefined): string {
  return normalizeMpn(v ?? "");
}

/**
 * R0-1:乾创 MFG 映射通道**专用**的键 —— 必须与写入侧 `PartMfgMapping.manufacturerPartNoKey`
 * 以及迁移 r4_3 的 `regexp_replace(upper(x),'[^[:alnum:]]','','g')` 完全同规则(保留 CJK)。
 *
 * 不能复用上面的 `keyOf`:`normalizeMpn` 剥掉所有非 ASCII,
 * 真实数据里 52,256 条 MFG_PN 有 510 条含中文,用 ASCII 键去查 CJK 键**永远查不到且不报错**。
 * 其余通道(ezPLM / 分销商 / 客户料号 / 内部料号)两侧都用 ASCII 规则,保持原样不动。
 */
function mfgKeyOf(v: string | null | undefined): string {
  return mfgPartNoKey(v);
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

/** 相似度来源:它们只是"可能是这个",不该和确切命中并列展示 */
const SIMILAR_SOURCES = new Set<MatchSourceValue>(["LOCAL_SIMILAR", "EZPLM_SIMILAR", "DESCRIPTION"]);

/**
 * 候选去重:同 source + 同 MPN 只留置信度最高者。
 *
 * 另外:同一个 MPN 如果**既有确切来源又有相似度来源**,只留确切的 ——
 * 同一颗料在列表里出现两次(一次"精确命中"、一次"型号相似"),
 * 会让人以为是两个不同的候选,平白增加确认成本。
 */
function dedupeCandidates(list: MatchCandidate[]): MatchCandidate[] {
  const exactMpns = new Set(
    list.filter((c) => !SIMILAR_SOURCES.has(c.source)).map((c) => keyOf(c.mpn)),
  );
  const best = new Map<string, MatchCandidate>();
  for (const c of list) {
    if (SIMILAR_SOURCES.has(c.source) && exactMpns.has(keyOf(c.mpn))) continue;
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

  // ②b R4-5(§27):内部料号命中 → 该料的 MFG 关系组(一料多厂交人工挑)
  const mfgParts: MfgMappingRef[] = byInternal
    ? (ctx.mfgByPartId?.get(byInternal.partId) ?? [])
    : [];

  // ③pre R4-5(§27 步骤 3/4):乾创 PartMfgMapping 精确 MPN 通道。
  // PATTERN 映射不参与 exact 匹配(§10);PO_HISTORY 候选置信度封顶 0.75(§22)。
  if (line.mpn && ctx.mfgByMpnKey) {
    const mappings = ctx.mfgByMpnKey.get(mfgKeyOf(line.mpn)) ?? [];
    const resolved = ctx.resolveMfr?.(line.manufacturer ?? null) ?? null;
    for (const m of mappings) {
      if (m.identifierMatchMode !== "EXACT") continue;
      const part = ctx.byPartId?.get(m.partId);
      if (!part) continue;
      const mfrAligned =
        (resolved && m.canonicalManufacturerId && resolved.id === m.canonicalManufacturerId) ||
        (line.manufacturer ? manufacturerMatches(m.canonicalManufacturerName ?? m.rawManufacturer, line.manufacturer) : false);
      const source: MatchSourceValue = mfrAligned ? "QC_MFG_MFR_MPN" : "QC_MFG_MPN";
      let confidence = SOURCE_CONFIDENCE[source];
      let reason = `乾创 MFG 关系(${m.relationType}/${m.status},来源 ${m.mappingSource})`;
      if (m.mappingSource === "PO_HISTORY" && m.status === "CANDIDATE") {
        confidence = Math.min(confidence, 0.75); // 不达批量确认线(§22)
        reason += " · PO 历史证据,置信度封顶 0.75";
      }
      candidates.push({ ...fromLocal(part, source, confidence), matchReason: reason });
    }
  }

  // ③④ 精确 MPN / Manufacturer + MPN(preferred 缓存通道,兼容旧数据)
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

  /*
   * ⑤b 相似度候选(工程侧 BOM 的主力路径)。
   *
   * KiCad 这类 BOM 只有 Value(`MIC5504-3.3`)与封装(`SOT-23-5`),
   * 精确 MPN 匹配必然落空。这里用「型号相似度 + 封装吻合度」找出最像的几个,
   * **交人工挑** —— 打分只用于排序,绝不自动采纳。
   *
   * 顺序上先本地物料库:自家料号才是能直接下单的,ezPLM 全库只是补充。
   */
  const similarityQuery: SimilarityQuery = {
    value: line.mpn ?? line.description,
    packageCode: line.packageCode ?? null,
    footprint: line.footprint,
  };
  if (similarityQuery.value && ctx.allParts?.length) {
    const localRanked = rankBySimilarity(
      similarityQuery,
      ctx.allParts
        .filter((p) => p.mpn)
        .map((p) => ({
          mpn: p.mpn!,
          manufacturer: p.manufacturer,
          description: p.description,
          footprint: p.footprint,
          _part: p,
        })),
      { limit: ctx.similarityLimit ?? 5 },
    );
    for (const r of localRanked) {
      // 已有精确命中的同一个料就不重复给"相似"候选了
      if (candidates.some((c) => keyOf(c.mpn) === keyOf(r.target.mpn))) continue;
      candidates.push({
        ...fromLocal(
          r.target._part,
          "LOCAL_SIMILAR",
          Number((SOURCE_CONFIDENCE.LOCAL_SIMILAR * r.score.score).toFixed(4)),
        ),
        matchReason: r.score.reasons.join(" · "),
      });
    }
  }

  const localHit = candidates.some((c) => c.confidence >= LOCAL_HIT_CONFIDENCE);

  if (ctx.similarityCorpusTruncated) {
    degraded.push({
      provider: "LOCAL",
      kind: "SIMILARITY_CORPUS_TRUNCATED",
      message: `相似度语料截断:仅加载 ${ctx.similarityCorpusTruncated.loaded}/${ctx.similarityCorpusTruncated.total} —— 精确通道(内部料号/MFG 映射/客户映射)不受影响`,
    });
  }

  // R4-5(§28)分流:命中的本地料非元器件(PCB 裸板/结构件/组件)→
  // 跳过 ezPLM/DigiKey/Mouser 元器件通道(板厂编号不是元器件 MPN)
  const primaryLocal = candidates.find((c) => c.partId && !SIMILAR_SOURCES.has(c.source));
  const primaryKind = primaryLocal?.partId
    ? ctx.materialKindByPartId?.get(primaryLocal.partId)
    : undefined;
  const routing: MaterialRouting =
    primaryKind === undefined ? "UNKNOWN" : primaryKind === "ELECTRONIC_COMPONENT" ? "COMPONENT" : "NON_COMPONENT";
  const componentChannelAllowed = routing !== "NON_COMPONENT";
  if (!componentChannelAllowed) {
    degraded.push({
      provider: "ROUTING",
      kind: "NON_COMPONENT_SKIP",
      message: `物料大类 ${primaryKind}:跳过元器件数据源(ezPLM/DigiKey/Mouser)—— 走 PCB/结构采购通道`,
    });
  }

  // ⑥ ezPLM 候选(本地已高置信命中则跳过,省接口调用)
  if (componentChannelAllowed && !localHit && ctx.ezplm && line.mpn) {
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

  /*
   * ⑥b ezPLM 相似度检索:没有精确 MPN 时,拿 Value 当关键字去 ezPLM 搜,
   * 再按相似度排序取前几个。ezPLM 的封装命名与 KiCad 同源(SOT-23-5 / TQFP-48_7x7mm_P0.5mm),
   * 所以封装能直接参与打分。
   */
  if (componentChannelAllowed && !localHit && ctx.ezplm && similarityQuery.value && candidates.length < (ctx.similarityLimit ?? 5)) {
    try {
      const found = await ctx.ezplm.searchParts({
        keyword: similarityQuery.value,
        limit: ctx.ezplmSearchLimit ?? 20,
      });
      const ranked = rankBySimilarity(
        similarityQuery,
        found
          .filter((p) => p.mpn)
          .map((p) => ({
            mpn: p.mpn!,
            manufacturer: p.manufacturer,
            description: p.description,
            footprint: p.footprint,
            _raw: p,
          })),
        { limit: ctx.similarityLimit ?? 5 },
      );
      for (const r of ranked) {
        if (candidates.some((c) => keyOf(c.mpn) === keyOf(r.target.mpn))) continue;
        candidates.push({
          source: "EZPLM_SIMILAR",
          confidence: Number((SOURCE_CONFIDENCE.EZPLM_SIMILAR * r.score.score).toFixed(4)),
          partId: r.target._raw.id,
          mpn: r.target.mpn,
          manufacturer: r.target.manufacturer ?? null,
          footprint: r.target.footprint ?? null,
          lifecycle: r.target._raw.lifecycle,
          stockQty: null,
          slowMovingQty: null,
          opoQty: null,
          eta: null,
          price: null,
          currency: null,
          alternates: null,
          dataUpdatedAt: r.target._raw.updatedAt,
          matchReason: r.score.reasons.join(" · "),
        });
      }
    } catch (e) {
      degraded.push(toDegraded(e, "EZPLM"));
    }
  }

  // ⑦ DigiKey / Mouser 候选(带正式价格:有 MPN 走 getOffersByMpn)
  if (componentChannelAllowed && !localHit && ctx.distributors?.length && line.mpn) {
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
    routing,
    mfgParts,
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
