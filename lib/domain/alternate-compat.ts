/**
 * 替代料的**三维兼容性**(纯函数)。
 *
 * 客户第二轮答复 Q10 原话:
 *
 * > 「**实现功能一致是最重要的**,功能不能不同。
 * >   需要增加「功能一致、但封装有细微差别」的筛选条件」
 *
 * 原来的模型是 5 个**互斥模式**(PIN_TO_PIN / PACKAGE_COMPATIBLE / FUNCTIONAL /
 * DOMESTIC / LOW_COST)。互斥就意味着表达不了"功能一致 + 封装略有差别" ——
 * 选 FUNCTIONAL 会把封装信息丢掉,选 PACKAGE_COMPATIBLE 又不保证功能一致。
 * 客户要的组合恰恰落在两者之间。
 *
 * 所以这里把它拆成**三个正交维度**,各自独立取值:
 *
 * - 功能等效(FunctionalEquivalence):能不能干同一件事
 * - 封装兼容(PackageCompatibility):贴不贴得上去
 * - 引脚兼容(PinCompatibility):贴上去之后接线对不对
 *
 * 三者不能互相推导:同封装可以引脚定义完全不同(SOT-23-5 是经典例子);
 * 功能一样的料也可能封装差一档(0603 vs 0805)。
 *
 * **排序第一原则:功能等效优先。** 封装一样但功能不同的料根本不是替代料,
 * 把它排在"功能一样、封装略有差别"前面是本末倒置。
 *
 * 旧的 `SubstitutionMode` 保留不动(客户没有要求删),两者并存:
 * 那是"按什么思路找",这里是"找出来的东西兼容到什么程度"。
 */

export type FunctionalEquivalence = "EXACT" | "EQUIVALENT" | "PARTIAL" | "UNKNOWN";
export type PackageCompatibility = "EXACT" | "MINOR_VARIATION" | "DIFFERENT" | "UNKNOWN";
export type PinCompatibility = "PIN_TO_PIN" | "REQUIRES_REVIEW" | "NOT_COMPATIBLE" | "UNKNOWN";

export const FUNCTIONAL_LABEL: Record<FunctionalEquivalence, string> = {
  EXACT: "功能完全一致",
  EQUIVALENT: "功能等效",
  PARTIAL: "部分功能一致",
  UNKNOWN: "功能一致性未知",
};

/*
 * MINOR_VARIATION 的判定口径(客户第三轮答复,2026-08 回复清单第 8 项):
 * 「Pitch 不同和修改 PCB 条不考虑,其余允许」「都需要确认」。
 * 即:高度不同 / body size 略有不同 / thermal pad 不同 → 算细微差别;
 * **pitch 不同 → 不算**(应标 DIFFERENT,客户不接受);
 * 需要改 PCB 才能用 → 不在替代范围内;
 * 且**一切细微差别都必须工程确认**(needsReview 对非 EXACT 封装恒为 true,正合此意)。
 */
export const PACKAGE_LABEL: Record<PackageCompatibility, string> = {
  EXACT: "封装完全一致",
  MINOR_VARIATION: "封装有细微差别",
  DIFFERENT: "封装不同",
  UNKNOWN: "封装差异未知",
};

export const PIN_LABEL: Record<PinCompatibility, string> = {
  PIN_TO_PIN: "Pin-to-Pin",
  REQUIRES_REVIEW: "引脚需工程确认",
  NOT_COMPATIBLE: "引脚不兼容",
  UNKNOWN: "引脚兼容性未知",
};

export const FUNCTIONAL_VALUES: FunctionalEquivalence[] = ["EXACT", "EQUIVALENT", "PARTIAL", "UNKNOWN"];
export const PACKAGE_VALUES: PackageCompatibility[] = ["EXACT", "MINOR_VARIATION", "DIFFERENT", "UNKNOWN"];
export const PIN_VALUES: PinCompatibility[] = ["PIN_TO_PIN", "REQUIRES_REVIEW", "NOT_COMPATIBLE", "UNKNOWN"];

export interface CompatibilityTriple {
  functional: FunctionalEquivalence;
  packageCompat: PackageCompatibility;
  pin: PinCompatibility;
}

/**
 * 排序权重。
 *
 * 数量级刻意拉开:功能维度的**任何**差别都压过封装与引脚的全部差别之和。
 * 这不是调参调出来的,是客户那句「功能一致是最重要的」的直接翻译 ——
 * 权重接近就意味着"封装完全一致"能把"功能只是部分一致"顶上去,那就违背了要求。
 */
const FUNCTIONAL_SCORE: Record<FunctionalEquivalence, number> = {
  EXACT: 10_000,
  EQUIVALENT: 8_000,
  PARTIAL: 2_000,
  UNKNOWN: 1_000,
};

const PACKAGE_SCORE: Record<PackageCompatibility, number> = {
  EXACT: 300,
  MINOR_VARIATION: 200,
  DIFFERENT: 50,
  UNKNOWN: 100,
};

const PIN_SCORE: Record<PinCompatibility, number> = {
  PIN_TO_PIN: 30,
  REQUIRES_REVIEW: 15,
  NOT_COMPATIBLE: 0,
  UNKNOWN: 10,
};

/** 综合排序分 —— 功能维度绝对优先 */
export function compatibilityScore(t: CompatibilityTriple): number {
  return FUNCTIONAL_SCORE[t.functional] + PACKAGE_SCORE[t.packageCompat] + PIN_SCORE[t.pin];
}

/**
 * 客户点名的四种筛选条件。
 *
 * 前三种的共同前提都是**功能一致**(EXACT 或 EQUIVALENT)——
 * 这正是客户强调的那一条;差别只在封装与引脚。
 * 第四种是纯 Pin-to-Pin 视角,给"我就要直接换、不改板"的场景。
 */
export type AlternateFilterPreset =
  | "FUNC_SAME_PKG_SAME"
  | "FUNC_SAME_PKG_MINOR"
  | "FUNC_SAME_NOT_PIN"
  | "PIN_TO_PIN_ONLY";

export const FILTER_PRESETS: Record<
  AlternateFilterPreset,
  { title: string; desc: string }
> = {
  FUNC_SAME_PKG_SAME: {
    title: "功能一致 + 封装一致",
    desc: "最省事的一档:功能与封装都对得上,通常只需确认引脚定义",
  },
  FUNC_SAME_PKG_MINOR: {
    title: "功能一致 + 封装细微差别",
    desc:
      "「细微差别」按客户 2026-08 确认的口径:高度不同 / 尺寸略有不同 / thermal pad 不同算;" +
      "**pitch 不同不算**(客户明确不接受),需要改 PCB 的也不算。所有细微差别均需工程确认",
  },
  FUNC_SAME_NOT_PIN: {
    title: "功能一致 + 非 Pin-to-Pin",
    desc: "功能对得上但引脚定义不同 —— **必须工程确认**,可能要改板",
  },
  PIN_TO_PIN_ONLY: {
    title: "只看完全 Pin-to-Pin",
    desc: "封装与引脚都完全一致,可直接换料",
  },
};

/** 功能是否"一致"(客户口径:EXACT 与 EQUIVALENT 都算) */
export function isFunctionallySame(f: FunctionalEquivalence): boolean {
  return f === "EXACT" || f === "EQUIVALENT";
}

/**
 * 判断一条替代关系是否落在某个筛选条件里。
 *
 * 注意 `UNKNOWN` **一律不算命中**:不知道不等于符合。
 * 把未知当成符合,等于让人拿着一份没核过的清单去换料。
 */
export function matchesPreset(t: CompatibilityTriple, preset: AlternateFilterPreset): boolean {
  switch (preset) {
    case "FUNC_SAME_PKG_SAME":
      return isFunctionallySame(t.functional) && t.packageCompat === "EXACT";
    case "FUNC_SAME_PKG_MINOR":
      return isFunctionallySame(t.functional) && t.packageCompat === "MINOR_VARIATION";
    case "FUNC_SAME_NOT_PIN":
      return (
        isFunctionallySame(t.functional) &&
        (t.pin === "REQUIRES_REVIEW" || t.pin === "NOT_COMPATIBLE")
      );
    case "PIN_TO_PIN_ONLY":
      return t.pin === "PIN_TO_PIN" && t.packageCompat === "EXACT";
  }
}

export interface RankedCompat<T> {
  item: T;
  score: number;
  /** 一句话结论,直接显示给用户 */
  summary: string;
  /** 是否需要工程确认才能用 */
  needsEngineeringReview: boolean;
}

/** 一条替代关系的人话结论 */
export function summarizeCompat(t: CompatibilityTriple): string {
  const parts = [FUNCTIONAL_LABEL[t.functional], PACKAGE_LABEL[t.packageCompat], PIN_LABEL[t.pin]];
  if (!isFunctionallySame(t.functional)) {
    return `${parts.join(" · ")} —— 功能未确认一致,**不建议直接替换**`;
  }
  if (t.pin === "PIN_TO_PIN" && t.packageCompat === "EXACT") {
    return `${parts.join(" · ")} —— 可直接换料`;
  }
  if (t.pin === "NOT_COMPATIBLE") {
    return `${parts.join(" · ")} —— 引脚不兼容,**需改板**`;
  }
  return `${parts.join(" · ")} —— 需工程确认后使用`;
}

/** 未核实过的条目一律需要工程确认 —— 不知道不等于没问题 */
export function needsReview(t: CompatibilityTriple): boolean {
  if (!isFunctionallySame(t.functional)) return true;
  if (t.pin !== "PIN_TO_PIN") return true;
  if (t.packageCompat !== "EXACT") return true;
  return false;
}

/**
 * 按三维兼容性排序(功能优先),可选筛选。
 *
 * 同分时**保持输入顺序**(稳定排序),便于上游用其它维度(价格、库存)预排。
 */
export function rankByCompatibility<T>(
  items: readonly { item: T; compat: CompatibilityTriple }[],
  opts: { preset?: AlternateFilterPreset | null; limit?: number } = {},
): RankedCompat<T>[] {
  const filtered = opts.preset
    ? items.filter((x) => matchesPreset(x.compat, opts.preset!))
    : [...items];

  const ranked = filtered
    .map((x, i) => ({
      item: x.item,
      score: compatibilityScore(x.compat),
      summary: summarizeCompat(x.compat),
      needsEngineeringReview: needsReview(x.compat),
      _i: i,
    }))
    .sort((a, b) => b.score - a.score || a._i - b._i)
    .map((x) => ({
      item: x.item,
      score: x.score,
      summary: x.summary,
      needsEngineeringReview: x.needsEngineeringReview,
    }));

  return opts.limit ? ranked.slice(0, opts.limit) : ranked;
}

/**
 * 参数证据的来源与可信度。
 *
 * 优先级 ezPLM > DigiKey > Mouser > 网络检索。
 * **网络数据永远不写回 Part 主数据** —— 只作为 Evidence 存着,
 * 带 sourceUrl / fetchedAt / verified=false。
 * 主数据被一条没人核过的抓取结果覆盖,是最难查的一类错误。
 */
export type EvidenceOrigin = "EZPLM" | "DIGIKEY" | "MOUSER" | "WEB" | "MANUAL";

export const EVIDENCE_TRUST: Record<EvidenceOrigin, number> = {
  MANUAL: 1.0,
  EZPLM: 0.95,
  DIGIKEY: 0.85,
  MOUSER: 0.85,
  WEB: 0.4,
};

export interface ParamEvidence {
  origin: EvidenceOrigin;
  sourceUrl: string | null;
  fetchedAt: string | null;
  value: string;
  /** 是否经人工核实。**网络来源一律 false**,不许调用方传 true */
  verified: boolean;
}

/** 网络来源的证据强制 verified=false —— 这条不给调用方留余地 */
export function normalizeEvidence(e: ParamEvidence): ParamEvidence {
  return e.origin === "WEB" ? { ...e, verified: false } : e;
}

/** 证据能否用于覆盖 Part 主数据:**网络来源永远不能** */
export function canWriteToPartMaster(e: ParamEvidence): boolean {
  return e.origin !== "WEB" && e.verified;
}
