/**
 * REF-1:全系统唯一的 Canonical Part Identity(纯函数 + Zod)。
 *
 * 这是目标架构(modules/<context>/domain)的第一个模块。
 *
 * 要解决的问题(REF-0 审计 §7 / DUPLICATION_MATRIX §D1):
 * 全仓有 **7 个 TS 归一规则 + 2 个 SQL 规则 + 9 处内联复制**,彼此不一致,
 * 已经造成过线上静默失配(R0-1:521 条真实 MFG 映射查不出来)。
 *
 * ⚠️ **本模块目前不接任何生产调用点**(REF-1a 只建不切)。
 * 切换要等 rule-divergence 的差异报告确认后,按 MIGRATION_PLAN §2 的四步走 ——
 * 归一键一变,匹配结果与唯一约束都会动,必须配套 key 重算迁移。
 *
 * 三条从 altpart-pro 采纳的纪律(只采规则,不采实现):
 * 1. **requested identity 永不被模糊结果静默替换** —— 用户输入 TL431,
 *    结果标题不许变成 TL431-1;
 * 2. **缓存键必须含 MPN + 标准化后的厂商 + 封装** —— 少一维就会串味;
 * 3. **不确定就留空,不猜** —— baseDevice 只在能证明时才给。
 */
import { z } from "zod";

/* ------------------------------------------------------------------ *
 * 1. 归一键
 * ------------------------------------------------------------------ */

/**
 * 匹配/去重键:大写 + 只保留字母数字(**含 CJK**)。
 *
 * 规则选型依据(不是随便挑的):
 * - 它与 `PartMfgMapping.manufacturerPartNoKey` 的**库内存量**一致
 *   (迁移 r4_3:`regexp_replace(upper(x),'[^[:alnum:]]','','g')`),
 *   选别的规则就意味着必须重算全表并承担唯一约束冲突;
 * - 纯 ASCII 剥离会把「风华高科」这类中文串剥成空串 —— R0-1 的事故现场。
 *
 * 禁止用于展示:展示一律用 raw。
 */
export function normalizeMpnKey(v: string | null | undefined): string {
  return (v ?? "").toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/* ------------------------------------------------------------------ *
 * 2. 订货后缀 / 基础器件
 * ------------------------------------------------------------------ */

/**
 * 可证明**不改变器件本身**的订货/包装后缀。
 *
 * 刻意保守 —— 这张表只放"业界公认属包装或分销商编码"的后缀:
 * - TR / T&R / REEL / REEL7:卷带包装;
 * - CT:Cut Tape(分销商切带);
 * - ND / DKR:DigiKey 的分销商编码后缀,不属制造商型号;
 * - /2K5、/1K 这类:卷装数量。
 *
 * **不做**「剥掉尾部字母就是基础器件」那种猜测(altpart-pro 把
 * `TPS62160DGKR` 直接剥成 `TPS62160`)—— 那需要逐厂商的编号规则知识,
 * 猜错会把**不同封装/不同温度等级的器件合并成一颗**。
 * 不确定就让 baseDevice 保持 null,交人工(本仓"未知不猜"纪律)。
 */
const ORDERABLE_SUFFIX = /[-_/]?(T&R|TR\d*|REEL\d*|CT|DKR|ND|\d+K\d*|\d+K)$/i;

export interface OrderableSplit {
  /** 剥掉订货后缀后的型号主体;**无法确证时为 null** */
  baseDevice: string | null;
  /** 被剥掉的后缀(原样) */
  orderableSuffix: string | null;
}

/**
 * 拆出「基础器件 + 订货后缀」。
 * 无可识别后缀时 baseDevice 返回 null(而不是把整串当基础器件)——
 * null 的含义是"我没拆出来",不是"它就是它自己"。
 */
export function splitOrderableSuffix(mpn: string | null | undefined): OrderableSplit {
  const raw = (mpn ?? "").trim();
  if (!raw) return { baseDevice: null, orderableSuffix: null };

  const m = raw.match(ORDERABLE_SUFFIX);
  if (!m) return { baseDevice: null, orderableSuffix: null };

  const base = raw.slice(0, raw.length - m[0].length).replace(/[-_/]+$/, "");
  // 剥完只剩很短的残渣,说明多半剥错了(比如整串就叫 "TR")—— 宁可不拆
  if (base.length < 3) return { baseDevice: null, orderableSuffix: null };
  return { baseDevice: base, orderableSuffix: m[0].replace(/^[-_/]/, "") };
}

/* ------------------------------------------------------------------ *
 * 3. Identity
 * ------------------------------------------------------------------ */

export const MATCH_TYPES = [
  /** 归一后完全相同 */
  "EXACT",
  /** 同一基础器件,仅订货/包装后缀不同 */
  "ORDERABLE_VARIANT",
  /** 同一基础器件,封装不同 */
  "PACKAGE_VARIANT",
  /** 同一基础器件,差异未知 */
  "BASE_DEVICE",
  /** 相似但未证实 —— **绝不可据此自动替换** */
  "FUZZY",
  /** 没有任何权威来源证实该型号存在 */
  "UNVERIFIED",
] as const;

export type MatchType = (typeof MATCH_TYPES)[number];

export const IDENTITY_SOURCES = ["LOCAL", "EZPLM", "DIGIKEY", "MOUSER", "ERP", "MANUAL"] as const;
export type IdentitySource = (typeof IDENTITY_SOURCES)[number];

export const CanonicalPartIdentitySchema = z.object({
  /** 用户/上游**原样**给的 MPN —— 任何情况下都不被改写 */
  requestedMpn: z.string().nullable(),
  /** 匹配键(normalizeMpnKey 的产物);requestedMpn 为空时是空串 */
  normalizedMpn: z.string(),
  /** **只有确证是同一订货体时才填**;否则 null */
  exactMpn: z.string().nullable(),
  baseDevice: z.string().nullable(),
  orderableSuffix: z.string().nullable(),

  rawManufacturer: z.string().nullable(),
  canonicalManufacturerId: z.string().nullable(),
  canonicalManufacturerName: z.string().nullable(),

  rawPackage: z.string().nullable(),
  canonicalPackage: z.string().nullable(),

  customerPn: z.string().nullable(),
  internalPn: z.string().nullable(),

  matchType: z.enum(MATCH_TYPES),
  source: z.enum(IDENTITY_SOURCES),
});

export type CanonicalPartIdentity = z.infer<typeof CanonicalPartIdentitySchema>;

export interface BuildIdentityInput {
  requestedMpn?: string | null;
  exactMpn?: string | null;
  rawManufacturer?: string | null;
  canonicalManufacturerId?: string | null;
  canonicalManufacturerName?: string | null;
  rawPackage?: string | null;
  canonicalPackage?: string | null;
  customerPn?: string | null;
  internalPn?: string | null;
  matchType?: MatchType;
  source: IdentitySource;
}

/**
 * 装配 identity。
 *
 * 关键不变量:`exactMpn` **只在 matchType 为 EXACT 时**才允许有值 ——
 * 其余档位一律置 null。这一条就是"模糊结果不得静默顶替用户输入"的落点:
 * 下游拿 exactMpn 去写库/展示时,拿不到就必须回头用 requestedMpn 并走人工确认。
 */
export function buildPartIdentity(input: BuildIdentityInput): CanonicalPartIdentity {
  const requestedMpn = input.requestedMpn?.trim() || null;
  const matchType: MatchType = input.matchType ?? (requestedMpn ? "UNVERIFIED" : "UNVERIFIED");
  const { baseDevice, orderableSuffix } = splitOrderableSuffix(requestedMpn);

  return CanonicalPartIdentitySchema.parse({
    requestedMpn,
    normalizedMpn: normalizeMpnKey(requestedMpn),
    exactMpn: matchType === "EXACT" ? (input.exactMpn?.trim() || requestedMpn) : null,
    baseDevice,
    orderableSuffix,
    rawManufacturer: input.rawManufacturer?.trim() || null,
    canonicalManufacturerId: input.canonicalManufacturerId ?? null,
    canonicalManufacturerName: input.canonicalManufacturerName?.trim() || null,
    rawPackage: input.rawPackage?.trim() || null,
    canonicalPackage: input.canonicalPackage?.trim() || null,
    customerPn: input.customerPn?.trim() || null,
    internalPn: input.internalPn?.trim() || null,
    matchType,
    source: input.source,
  });
}

/* ------------------------------------------------------------------ *
 * 4. 匹配档位判定
 * ------------------------------------------------------------------ */

export interface MatchCandidateRef {
  mpn: string | null | undefined;
  canonicalPackage?: string | null;
}

/**
 * 判定「请求的型号」与「候选」是什么关系。
 *
 * 顺序是刻意的:先看归一全等,再看同基础器件下的细分;
 * **判不出同源一律 FUZZY**,由人工决定,不往上凑。
 */
export function classifyMatch(
  requested: { mpn: string | null | undefined; canonicalPackage?: string | null },
  candidate: MatchCandidateRef | null | undefined,
): MatchType {
  if (!candidate || !normalizeMpnKey(candidate.mpn)) return "UNVERIFIED";

  const rk = normalizeMpnKey(requested.mpn);
  const ck = normalizeMpnKey(candidate.mpn);
  if (!rk) return "UNVERIFIED";
  if (rk === ck) return "EXACT";

  const rs = splitOrderableSuffix(requested.mpn);
  const cs = splitOrderableSuffix(candidate.mpn);
  // 两侧至少一侧拆出了后缀,且基础器件相同 → 只差包装
  const rBase = normalizeMpnKey(rs.baseDevice ?? requested.mpn);
  const cBase = normalizeMpnKey(cs.baseDevice ?? candidate.mpn);
  if (rBase && rBase === cBase) {
    const rp = requested.canonicalPackage ?? null;
    const cp = candidate.canonicalPackage ?? null;
    if (rp && cp && rp !== cp) return "PACKAGE_VARIANT";
    if (rs.orderableSuffix !== cs.orderableSuffix) return "ORDERABLE_VARIANT";
    return "BASE_DEVICE";
  }
  return "FUZZY";
}

/**
 * 守卫:候选能不能**直接顶替**用户请求的型号。
 *
 * 只有 EXACT 可以。其余一律要求人工确认 ——
 * 这正是 altpart-pro 记录的事故:输入 TL431,结果被 TL431-1 静默替换,
 * 用户拿到的报价单上是另一颗料。
 */
export interface ReplacementGuard {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason: string;
}

export function guardIdentityReplacement(matchType: MatchType): ReplacementGuard {
  if (matchType === "EXACT") {
    return { allowed: true, requiresConfirmation: false, reason: "归一后完全一致" };
  }
  return {
    allowed: false,
    requiresConfirmation: true,
    reason: `匹配档位为 ${matchType} —— 非精确匹配不得顶替用户输入的型号,须人工确认`,
  };
}

/* ------------------------------------------------------------------ *
 * 5. 缓存键
 * ------------------------------------------------------------------ */

/**
 * 缓存键 = 前缀 + 归一 MPN + **标准化后的厂商** + 封装。
 *
 * 三维缺一不可:
 * - 少了厂商:同 MPN 不同厂商的数据会互相覆盖;
 * - 厂商没标准化:`TI` 与 `Texas Instruments` 会产生两条缓存,
 *   既浪费又可能给出不一致的结果;
 * - 少了封装:同型号不同封装的参数/资源会串味。
 *
 * 厂商维度**必须传已标准化的值**(canonicalManufacturerName 或 registry 的归一键),
 * 本函数不替调用方做标准化 —— 那是 manufacturer-registry 的职责,
 * 混在这里会变成第二套厂商归一(正是要消灭的那类重复)。
 */
export function identityCacheKey(
  prefix: string,
  parts: {
    normalizedMpn: string;
    canonicalManufacturer?: string | null;
    canonicalPackage?: string | null;
  },
): string {
  return [
    prefix,
    parts.normalizedMpn || "ANY",
    (parts.canonicalManufacturer ?? "").trim() || "ANY",
    normalizeMpnKey(parts.canonicalPackage) || "ANY",
  ]
    .join(":")
    .toLowerCase();
}
