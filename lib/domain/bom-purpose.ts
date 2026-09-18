/**
 * 预 BOM(报价用)与正式 BOM(量产用)的拆分与转换(纯函数)。
 *
 * 客户 Q4 答复:「**A. 分两套 + 一键转换**;正式 BOM 必须关联客户编码,
 * 且要**优先匹配系统内部料号**」。
 *
 * 三条不肯让步的地方:
 *
 * 1. **转换必须生成新 BOM,禁止原地改 purpose。**
 *    预 BOM 是报价的依据,报价快照指向它。原地转换会让"当初按哪份 BOM 报的价"
 *    这个问题永远答不上来 —— 这跟报价快照冻结是同一个道理。
 *
 * 2. **匹配不到内部料号时绝不自动建料。**
 *    CLAUDE.md:ezPLM 是物料主数据唯一真源,本系统只读 + 缓存。
 *    导入几次就长出一堆同名料,是把主数据搞烂最快的方式。
 *
 * 3. **一个 MPN 命中多颗内部料时不挑一个。**
 *    挑错了下游全错,而且错得很安静。这里返回 ambiguous,交人工指定。
 *
 * ⚠️ 未决(C5,已发客户):匹配不到内部料号时到底应该
 *    「阻止转换」还是「允许转换但标记待补」。
 *    当前实现取**折中**:允许转换,但必须由发起人显式确认
 *    (`acknowledgeUnmatched`),未匹配行在正式 BOM 上带标记且计入台账。
 *    客户答复后若要求"一律阻止",只需把 needsAcknowledge 改成 blocked。
 */
import { normalizeMpnKey } from "@/modules/parts/domain/part-identity";

export type BomPurpose = "PRE_QUOTE" | "PRODUCTION";

export const BOM_PURPOSE_LABEL: Record<BomPurpose, string> = {
  PRE_QUOTE: "预 BOM(报价用)",
  PRODUCTION: "正式 BOM(量产用)",
};

/** 内部料号的匹配来源 —— 页面必须显示它,否则人不知道这个料号是怎么来的 */
export type InternalPnMatchSource = "CUSTOMER_PN_MAPPING" | "MPN_EXACT";

export const MATCH_SOURCE_LABEL: Record<InternalPnMatchSource, string> = {
  CUSTOMER_PN_MAPPING: "客户料号对照表",
  MPN_EXACT: "MPN 精确匹配",
};

export interface ConvertLineInput {
  lineNo: number;
  customerPn: string | null;
  mpn: string | null;
}

export interface PartRef {
  partId: string;
  internalPn: string;
}

export interface InternalPnMatchContext {
  /** 该客户的料号对照:归一化 customerPn → 内部料 */
  byCustomerPn: ReadonlyMap<string, PartRef>;
  /** 归一化 MPN → 内部料候选(可能多颗) */
  byMpn: ReadonlyMap<string, readonly PartRef[]>;
}

export interface LineMatchResult {
  lineNo: number;
  partId: string | null;
  internalPn: string | null;
  source: InternalPnMatchSource | null;
  /** 多颗内部料命中同一 MPN —— **不挑**,标出来给人工 */
  ambiguous: boolean;
  /** 未匹配/歧义时的原因原文,直接显示给人看 */
  reason: string | null;
}

/**
 * 归一化键。
 *
 * 与 `bom-import.ts` 里的主数据校验保持同一套口径(大写 + 去掉非字母数字),
 * 两处不一致会出现"校验说认识这颗料、转换却说匹配不到"的鬼故事。
 */
export function normalizePnKey(v: string | null | undefined): string {
  // REF-1b:统一到 canonical
  return normalizeMpnKey(v);
}

/**
 * 单行匹配内部料号。
 *
 * 顺序即优先级:**客户料号对照表 > MPN 精确匹配**。
 * 客户对照表是人工维护的、针对这个客户的确定结论;
 * MPN 相同只是"看起来是同一颗",谁更可信没有悬念。
 */
export function matchInternalPn(
  line: ConvertLineInput,
  ctx: InternalPnMatchContext,
): LineMatchResult {
  const base = { lineNo: line.lineNo, partId: null, internalPn: null, source: null } as const;

  const cpnKey = normalizePnKey(line.customerPn);
  if (cpnKey) {
    const hit = ctx.byCustomerPn.get(cpnKey);
    if (hit) {
      return {
        lineNo: line.lineNo,
        partId: hit.partId,
        internalPn: hit.internalPn,
        source: "CUSTOMER_PN_MAPPING",
        ambiguous: false,
        reason: null,
      };
    }
  }

  const mpnKey = normalizePnKey(line.mpn);
  if (mpnKey) {
    const hits = ctx.byMpn.get(mpnKey) ?? [];
    if (hits.length === 1) {
      return {
        lineNo: line.lineNo,
        partId: hits[0].partId,
        internalPn: hits[0].internalPn,
        source: "MPN_EXACT",
        ambiguous: false,
        reason: null,
      };
    }
    if (hits.length > 1) {
      return {
        ...base,
        ambiguous: true,
        reason: `MPN ${line.mpn} 对应 ${hits.length} 个内部料号(${hits
          .map((h) => h.internalPn)
          .join("、")})—— 系统不替你选,请人工指定`,
      };
    }
  }

  return {
    ...base,
    ambiguous: false,
    reason:
      cpnKey || mpnKey
        ? "系统内没有对应的内部料号 —— 请先在物料主数据建档或补客户料号对照,系统不会自动建料"
        : "该行既无客户料号也无 MPN,无从匹配",
  };
}

export interface MatchSummary {
  results: LineMatchResult[];
  matched: number;
  /** 歧义(多颗候选)—— 与"完全没匹配上"分开统计,处理方式不同 */
  ambiguous: number;
  /** 既没匹配上也不是歧义 */
  unmatched: number;
  /** 需要人工介入的总行数 = ambiguous + unmatched */
  needsManual: number;
}

export function matchInternalPns(
  lines: readonly ConvertLineInput[],
  ctx: InternalPnMatchContext,
): MatchSummary {
  const results = lines.map((l) => matchInternalPn(l, ctx));
  const matched = results.filter((r) => r.partId !== null).length;
  const ambiguous = results.filter((r) => r.ambiguous).length;
  const unmatched = results.length - matched - ambiguous;
  return { results, matched, ambiguous, unmatched, needsManual: ambiguous + unmatched };
}

export interface ConvertGuardInput {
  sourcePurpose: BomPurpose;
  /** 正式 BOM 必须关联客户(客户 Q4:「必须关联客户编码」) */
  customerId: string | null;
  lineCount: number;
  needsManual: number;
  /** 发起人是否已明确知晓并接受"带着未匹配行转换" */
  acknowledgeUnmatched: boolean;
}

export type ConvertGuardResult =
  | { ok: true }
  | { ok: false; code: string; message: string; needsAcknowledge?: boolean };

/** 转正式 BOM 的前置校验 —— API 与页面共用同一套判定,避免两处规则打架 */
export function checkConvertToProduction(input: ConvertGuardInput): ConvertGuardResult {
  if (input.sourcePurpose !== "PRE_QUOTE") {
    return {
      ok: false,
      code: "not_pre_quote",
      message: "只有预 BOM 可以转正式 BOM —— 正式 BOM 再转一次只会产生两份都叫「正式」的东西",
    };
  }
  if (!input.customerId) {
    return {
      ok: false,
      code: "customer_required",
      message: "正式 BOM 必须关联客户 —— 客户料号对照与后续订单都挂在客户上,留空转过去等于转了个孤儿",
    };
  }
  if (input.lineCount === 0) {
    return { ok: false, code: "empty_bom", message: "该 BOM 没有行,无可转换内容" };
  }
  if (input.needsManual > 0 && !input.acknowledgeUnmatched) {
    return {
      ok: false,
      code: "unmatched_lines",
      needsAcknowledge: true,
      message: `有 ${input.needsManual} 行没能匹配到内部料号。可以带着这些行转换,但转换后它们会被标记为「待补内部料号」,量产前必须补齐 —— 请确认后重试`,
    };
  }
  return { ok: true };
}
