/**
 * 合规声明(纯函数)。
 *
 * 为什么要与文档分离:原实现是 `Part.rohs / Part.reach` 两个布尔值。
 * 一个布尔值承载不了这些问题 ——
 * "凭哪份文档?什么版本?谁审的?什么时候到期?对这颗料是不是根本不适用?"
 * 客户审厂时问的恰恰是这些。
 *
 * 纪律:
 * - **UNKNOWN ≠ NON_COMPLIANT**。没有依据是"不知道",不是"不合规";
 *   把未知显示成不合规会让人去做无谓的整改,反之则会漏掉真问题;
 * - **过期的声明不再算合规**,自动降级为 UNKNOWN 并说明原因;
 * - 结论为 COMPLIANT 的声明**必须有支撑文档**,否则只是一句口头承诺。
 */

export type ComplianceVerdictValue =
  | "COMPLIANT"
  | "NON_COMPLIANT"
  | "NOT_APPLICABLE"
  | "UNKNOWN";

export type ReviewStateValue =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED";

export const VERDICT_LABEL: Record<ComplianceVerdictValue, string> = {
  COMPLIANT: "符合",
  NON_COMPLIANT: "不符合",
  NOT_APPLICABLE: "不适用",
  UNKNOWN: "未知",
};

export const VERDICT_TONE: Record<ComplianceVerdictValue, "green" | "red" | "gray" | "amber"> = {
  COMPLIANT: "green",
  NON_COMPLIANT: "red",
  NOT_APPLICABLE: "gray",
  // 未知按告警显示,促使人去补 —— 灰色会让人以为无所谓
  UNKNOWN: "amber",
};

export interface DeclarationInput {
  scheme: string;
  verdict: ComplianceVerdictValue;
  state: ReviewStateValue;
  validUntil: string | null;
  evidenceCount: number;
}

export interface EffectiveVerdict {
  verdict: ComplianceVerdictValue;
  /** 是否因过期/未审核而被降级 */
  degraded: boolean;
  reason: string;
}

/**
 * 计算**生效**结论。
 *
 * 声明上写的结论不一定生效:未审批的、过期的都不能算数。
 */
export function effectiveVerdict(
  d: DeclarationInput,
  asOf: string,
): EffectiveVerdict {
  if (d.state !== "APPROVED") {
    return {
      verdict: "UNKNOWN",
      degraded: true,
      reason: `声明尚未通过审核(当前:${d.state}）—— 未审核的声明不作数`,
    };
  }

  if (d.validUntil) {
    const until = Date.parse(d.validUntil);
    const now = Date.parse(asOf);
    if (Number.isFinite(until) && Number.isFinite(now) && until < now) {
      return {
        verdict: "UNKNOWN",
        degraded: true,
        // 关键:过期后降级为"未知"而不是"不合规" —— 过期不代表这颗料真的有害
        reason: `声明已于 ${d.validUntil.slice(0, 10)} 过期 —— 降级为「未知」(过期≠不合规,但也不能再当合规用)`,
      };
    }
  }

  if (d.verdict === "COMPLIANT" && d.evidenceCount === 0) {
    return {
      verdict: "UNKNOWN",
      degraded: true,
      reason: "结论为「符合」但**没有任何支撑文档** —— 无依据的合规声明不作数",
    };
  }

  return { verdict: d.verdict, degraded: false, reason: "声明已审核且在有效期内" };
}

export interface SchemeSummary {
  scheme: string;
  verdict: ComplianceVerdictValue;
  degraded: boolean;
  reason: string;
  validUntil: string | null;
  evidenceCount: number;
}

/**
 * 汇总一颗物料在各合规体系下的生效结论。
 *
 * 同一体系有多份声明时,取**最新且生效**的那份;
 * 都不生效时如实返回 UNKNOWN,不退而求其次拿旧的凑数。
 */
export function summarizeDeclarations(
  declarations: readonly (DeclarationInput & { issuedAt?: string | null })[],
  asOf: string,
  requiredSchemes: readonly string[] = ["ROHS", "REACH", "COC"],
): SchemeSummary[] {
  return requiredSchemes.map((scheme) => {
    const forScheme = declarations
      .filter((d) => d.scheme.toUpperCase() === scheme.toUpperCase())
      .sort((a, b) => (b.issuedAt ?? "").localeCompare(a.issuedAt ?? ""));

    if (forScheme.length === 0) {
      return {
        scheme,
        verdict: "UNKNOWN",
        degraded: false,
        reason: "尚无该体系的合规声明",
        validUntil: null,
        evidenceCount: 0,
      };
    }

    // 优先取生效的;都不生效时取最新那份并保留其降级原因
    for (const d of forScheme) {
      const eff = effectiveVerdict(d, asOf);
      if (!eff.degraded) {
        return {
          scheme,
          verdict: eff.verdict,
          degraded: false,
          reason: eff.reason,
          validUntil: d.validUntil,
          evidenceCount: d.evidenceCount,
        };
      }
    }

    const latest = forScheme[0];
    const eff = effectiveVerdict(latest, asOf);
    return {
      scheme,
      verdict: eff.verdict,
      degraded: true,
      reason: eff.reason,
      validUntil: latest.validUntil,
      evidenceCount: latest.evidenceCount,
    };
  });
}
