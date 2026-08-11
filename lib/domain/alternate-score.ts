/**
 * 替代料多维评分(纯函数,可完全单测)。
 *
 * 一个总分说明不了问题:参数都对但引脚没核过、或者数据全靠 AI 搜来的,
 * 都不该和"本地库里逐项验证过"的候选拿同一个分。因此拆成四个维度:
 *
 * - **技术兼容**:按参数优先级加权的逐项比对得分;
 * - **证据覆盖**:有多少个参数真的拿到了数据(而不是空着);
 * - **来源可信**:数据来自本地库/ezPLM(高)还是 AI 检索(低);
 * - **结论可信**:前三者的下限约束 —— 参数再高,证据不足或来源不可信,结论就不可信。
 *
 * 纪律:
 * - **未知参数不按 0 分计入**,而是从分母里剔除并计入"证据覆盖"扣分;
 * - Pin-to-Pin 模式下,引脚映射未经人工核对**永远不判"可直接替换"**;
 * - 输出只是候选与依据,系统不替人做替换决定。
 */
import { compareParam, type ParamComparison } from "./param-compare";
import { packageAgreement } from "./part-spec";

/** 替代模式 */
export type SubstitutionMode =
  | "PIN_TO_PIN"
  | "PACKAGE_COMPATIBLE"
  | "FUNCTIONAL"
  | "DOMESTIC"
  | "LOW_COST";

/*
 * S-7(客户 PR2 反馈 采购-3a:「筛选条件 Pin to Pin 是否和封装重复了?」)。
 *
 * 核实结论:**不重复**,是两层判定,但原文案没说清,难怪会被当成一回事:
 *   - 封装兼容 = 焊盘/外形一样,**贴得上去**;
 *   - Pin-to-Pin = 在封装一样的基础上,**每个引脚的功能定义也一样**,贴上去还能正常工作。
 * 同封装不同引脚定义在 IC 上极常见(同是 SOT-23-5,引脚功能可以完全不同),
 * 把两者合并会让"贴得上但工作不了"的候选混进来 —— 那是烧板的错。
 * 所以保留两个模式,改成能互相对照的措辞。
 */
export const MODE_LABELS: Record<SubstitutionMode, { title: string; desc: string }> = {
  PIN_TO_PIN: {
    title: "Pin-to-Pin",
    desc: "封装相同,且每个引脚功能一致 —— 比「封装兼容」更严格,可直接换料",
  },
  PACKAGE_COMPATIBLE: {
    title: "封装兼容",
    desc: "外形/焊盘相同,贴得上去;引脚功能是否一致不保证,需工程核对",
  },
  FUNCTIONAL: { title: "功能兼容", desc: "功能相近,封装可能不同,可能需改板" },
  DOMESTIC: { title: "国产替代", desc: "优先推荐国产品牌" },
  LOW_COST: { title: "低成本优先", desc: "价格最优方案" },
};

/** 数据来源可信度(0–1) */
export type EvidenceSource = "LOCAL" | "EZPLM" | "DIGIKEY" | "MOUSER" | "AI_SEARCH";

export const SOURCE_TRUST: Record<EvidenceSource, number> = {
  LOCAL: 1,
  EZPLM: 0.95,
  DIGIKEY: 0.9,
  MOUSER: 0.9,
  // AI 检索来的参数没有可追溯的权威出处,只能低权重
  AI_SEARCH: 0.45,
};

export const SOURCE_LABELS: Record<EvidenceSource, string> = {
  LOCAL: "本地数据库",
  EZPLM: "ezPLM",
  DIGIKEY: "DigiKey",
  MOUSER: "Mouser",
  AI_SEARCH: "AI搜索",
};

/** 一条参数约束(顺序即优先级,越靠前权重越高) */
export interface ParamConstraint {
  key: string;
  label: string;
  /** 原型号的值 */
  required: string | null;
  /** 该参数是否越大越好(主频/Flash/SRAM/GPIO) */
  higherIsBetter?: boolean;
  /**
   * 按封装语义比对(封装族 + 管脚数),而不是字符串相等。
   * `LQFP-48` 与 `TQFP-48_7x7mm_P0.5mm` 字面完全不同,但管脚数一致、
   * 都是 48 脚方形扁平封装 —— 按字符串比会判 0 分,把正确候选全枪毙。
   */
  compareAs?: "package";
}

export interface CandidateSpec {
  mpn: string;
  manufacturer: string | null;
  description: string | null;
  /** 参数值,key 与约束对应 */
  values: Record<string, string | null>;
  /** 每个参数的取数来源;缺省用 defaultSource */
  valueSources?: Record<string, EvidenceSource>;
  defaultSource: EvidenceSource;
  /** 引脚映射是否已由人工核对过(Pin-to-Pin 判定的硬前提) */
  pinMapVerified?: boolean;
  /** 是否国产品牌(国产替代模式加权) */
  domestic?: boolean;
  unitPrice?: string | null;
  currency?: string | null;
  stock?: number | null;
}

export interface ParamRow extends ParamComparison {
  key: string;
  label: string;
  actual: string | null;
  source: EvidenceSource;
}

export interface ScoredAlternate {
  mpn: string;
  manufacturer: string | null;
  description: string | null;
  /** 0–100 四个维度 */
  technical: number;
  evidence: number;
  sourceTrust: number;
  confidence: number;
  rows: ParamRow[];
  /** 醒目提示(如引脚未验证) */
  warnings: string[];
  /** 该候选在当前模式下的标签,如 [P2] Pin-to-Pin候选 */
  modeTag: string;
  preferredVendor: boolean;
}

/**
 * 参数权重:顺序即优先级。
 * 用 1/(i+1) 的调和衰减而不是线性 —— 第 1 位比第 2 位重要得多,
 * 而第 9 位与第 10 位差别不大,这更贴近工程师排优先级时的真实想法。
 */
export function priorityWeights(count: number): number[] {
  const raw = Array.from({ length: count }, (_, i) => 1 / (i + 1));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

/** 封装比对:走封装族 + 管脚数,而不是字符串相等 */
function comparePackageParam(
  required: string | null,
  actual: string | null,
): ParamComparison {
  if (!required) return { score: null, verdict: "未知", detail: "原型号未给出封装" };
  if (!actual) return { score: null, verdict: "缺失", detail: "候选未提供封装" };
  const a = packageAgreement(required, actual);
  if (a.exact) return { score: 100, verdict: "一致", detail: "封装完全一致" };
  if (a.compatible === true) {
    return { score: 92, verdict: "一致", detail: a.reasons.join(" · ") };
  }
  if (a.compatible === false) {
    return { score: 0, verdict: "有差异", detail: a.reasons.join(" · ") };
  }
  return { score: 50, verdict: "部分覆盖", detail: `${a.reasons.join(" · ")};需工程确认能否改板` };
}

function round(n: number): number {
  return Math.round(n);
}

export interface ScoreOptions {
  mode: SubstitutionMode;
  constraints: ParamConstraint[];
  /** 优选厂商(同分时优先) */
  preferredManufacturers?: string[];
}

export function scoreAlternate(candidate: CandidateSpec, options: ScoreOptions): ScoredAlternate {
  const { constraints, mode } = options;
  const weights = priorityWeights(constraints.length);

  const rows: ParamRow[] = constraints.map((c, i) => {
    const actual = candidate.values[c.key] ?? null;
    const source = candidate.valueSources?.[c.key] ?? candidate.defaultSource;
    const cmp =
      c.compareAs === "package"
        ? comparePackageParam(c.required, actual)
        : compareParam(c.required, actual, { higherIsBetter: c.higherIsBetter });
    void i;
    return { key: c.key, label: c.label, actual, source, ...cmp };
  });

  // 技术兼容:只对**拿到了数据**的参数加权平均;未知不按 0 分拉低
  let weightedSum = 0;
  let weightUsed = 0;
  rows.forEach((r, i) => {
    if (r.score === null) return;
    weightedSum += r.score * weights[i];
    weightUsed += weights[i];
  });
  const technical = weightUsed > 0 ? round(weightedSum / weightUsed) : 0;

  // 证据覆盖:按权重计的"有数据比例"
  const evidence = round(weightUsed * 100);

  // 来源可信:按权重计的来源可信度均值
  let trustSum = 0;
  let trustWeight = 0;
  rows.forEach((r, i) => {
    if (r.score === null) return;
    trustSum += SOURCE_TRUST[r.source] * weights[i];
    trustWeight += weights[i];
  });
  const sourceTrust = trustWeight > 0 ? round((trustSum / trustWeight) * 100) : 0;

  const warnings: string[] = [];

  /*
   * Pin-to-Pin 的硬纪律:参数再匹配,只要引脚映射没有人工核过,
   * 就**不能**给出"可直接替换"的结论。这一条是安全底线,不是加减分。
   */
  if (mode === "PIN_TO_PIN" && !candidate.pinMapVerified) {
    warnings.push("参数高度匹配,但引脚映射尚未验证 —— 需人工核对引脚后方可判定「可直接替换」");
  }
  const missing = rows.filter((r) => r.verdict === "缺失").map((r) => r.label);
  if (missing.length > 0) warnings.push(`以下参数候选未提供,无法判定:${missing.join("、")}`);

  /*
   * 结论可信 = 三者中的**短板**主导:
   * 参数 100 分但证据只有 45%、来源全是 AI 搜的,结论一样不可信。
   * 用几何平均而不是算术平均,正是为了让短板真的拉得动总分。
   */
  const confidenceBase = Math.cbrt((technical / 100) * (evidence / 100) * (sourceTrust / 100)) * 100;
  let confidence = round(confidenceBase);
  if (mode === "PIN_TO_PIN" && !candidate.pinMapVerified) {
    // 未验证引脚时封顶,避免"88 分"被读成"可以直接换"
    confidence = Math.min(confidence, 88);
  }

  const preferredVendor = (options.preferredManufacturers ?? []).some(
    (m) => m.trim() !== "" && (candidate.manufacturer ?? "").toUpperCase().includes(m.toUpperCase()),
  );

  const modeTag =
    mode === "PIN_TO_PIN"
      ? candidate.pinMapVerified
        ? "[P2] Pin-to-Pin 已验证"
        : "[P2] Pin-to-Pin 候选"
      : mode === "PACKAGE_COMPATIBLE"
        ? "[PKG] 封装兼容"
        : mode === "DOMESTIC"
          ? "[CN] 国产替代"
          : mode === "LOW_COST"
            ? "[$] 低成本"
            : "[F] 功能替代";

  return {
    mpn: candidate.mpn,
    manufacturer: candidate.manufacturer,
    description: candidate.description,
    technical,
    evidence,
    sourceTrust,
    confidence,
    rows,
    warnings,
    modeTag,
    preferredVendor,
  };
}

/**
 * 排序:结论可信优先;同分时**优选厂商**在前,再看技术兼容。
 * 国产替代/低成本模式各自追加一条同分打破规则。
 */
export function rankScored(
  scored: readonly ScoredAlternate[],
  candidates: readonly CandidateSpec[],
  options: { mode: SubstitutionMode; limit?: number },
): ScoredAlternate[] {
  const byMpn = new Map(candidates.map((c) => [c.mpn, c]));
  return [...scored]
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (a.preferredVendor !== b.preferredVendor) return a.preferredVendor ? -1 : 1;

      if (options.mode === "DOMESTIC") {
        const da = byMpn.get(a.mpn)?.domestic ? 1 : 0;
        const db = byMpn.get(b.mpn)?.domestic ? 1 : 0;
        if (da !== db) return db - da;
      }
      if (options.mode === "LOW_COST") {
        const pa = Number(byMpn.get(a.mpn)?.unitPrice ?? NaN);
        const pb = Number(byMpn.get(b.mpn)?.unitPrice ?? NaN);
        const va = Number.isFinite(pa);
        const vb = Number.isFinite(pb);
        if (va && vb && pa !== pb) return pa - pb;
        if (va !== vb) return va ? -1 : 1; // 有价的排前面
      }

      if (b.technical !== a.technical) return b.technical - a.technical;
      return a.mpn.localeCompare(b.mpn); // 同分稳定排序
    })
    .slice(0, options.limit ?? 5);
}
