/**
 * 统一数据范围策略(纯函数)。
 *
 * 问题:行级可见范围原先由**各模块自行判断** ——
 * 追溯有一套 trace-scope,OPO 干脆没有(实测:供应商能看到所有供应商的 PO 行,
 * 含对手的料号、数量、单价与交期)。
 * 每个模块各写一遍,漏一处就是一次数据泄露,而且不会有人发现。
 *
 * 本模块把"谁能看到哪些行"抽成一处策略,数据层只负责把策略翻译成 where。
 *
 * 纪律:
 * - **默认最窄**。未知角色/未知资源一律 OWN 或 NONE,绝不 fallback 到 ALL ——
 *   放开的默认值出错时无声无息;收紧的默认值出错时会被立刻发现;
 * - 供应商归属缺失(User.supplierId 为空)时**不是"看全部"而是"看不到"**;
 * - 策略只回答"范围",**不回答"能否访问"** —— 后者是权限(permissions.ts)的事,
 *   两者分开:有权限但范围为空 ≠ 无权限。
 */

export type ScopeKind = "ALL" | "PROJECT" | "CUSTOMER" | "SUPPLIER" | "SITE" | "OWN" | "NONE";

export const SCOPE_LABEL: Record<ScopeKind, string> = {
  ALL: "全部数据",
  PROJECT: "所属项目",
  CUSTOMER: "所属客户",
  SUPPLIER: "所属供应商",
  SITE: "所属站点",
  OWN: "仅本人创建",
  NONE: "无可见数据",
};

/** 受数据范围约束的资源 */
export type ScopedResource =
  | "OPO_LINE"
  | "PURCHASE_ORDER"
  | "TRACE"
  | "RFQ"
  | "QUOTE"
  | "RECONCILIATION"
  | "PART"
  | "BOM";

export type RoleName = "PM" | "PROCUREMENT" | "ENGINEERING" | "MANAGEMENT" | "SUPPLIER";

/**
 * 角色 × 资源 → 数据范围。
 *
 * 只列**需要收窄**的组合;未列出的内部角色默认 ALL(它们本来就该看全租户),
 * 但 SUPPLIER **永远**不落到 ALL —— 见下面的兜底。
 */
const MATRIX: Partial<Record<RoleName, Partial<Record<ScopedResource, ScopeKind>>>> = {
  SUPPLIER: {
    OPO_LINE: "SUPPLIER",
    PURCHASE_ORDER: "SUPPLIER",
    TRACE: "SUPPLIER",
    // 供应商与这些资源无关,一律不可见
    RFQ: "NONE",
    QUOTE: "NONE",
    RECONCILIATION: "NONE",
    PART: "NONE",
    BOM: "NONE",
  },
};

export interface ScopeSubject {
  roles: readonly RoleName[];
  /** 该用户归属的供应商;SUPPLIER 角色必须有,否则范围为 NONE */
  supplierId?: string | null;
  customerId?: string | null;
  siteId?: string | null;
  userId: string;
}

export interface ResolvedScope {
  kind: ScopeKind;
  /** 该范围对应的键值;kind=ALL 时为 null */
  value: string | null;
  /** 人可读说明 —— UI 必须展示,让人知道自己看到的是不是全部 */
  description: string;
}

/**
 * 解析某人对某资源的数据范围。
 *
 * 多角色时取**最宽**的那个(管理层兼供应商账号应按管理层看),
 * 但 SUPPLIER 单独持有时永不放宽。
 */
export function resolveScope(subject: ScopeSubject, resource: ScopedResource): ResolvedScope {
  const isSupplierOnly =
    subject.roles.length > 0 && subject.roles.every((r) => r === "SUPPLIER");

  if (isSupplierOnly) {
    const kind = MATRIX.SUPPLIER?.[resource] ?? "NONE";
    if (kind === "SUPPLIER") {
      if (!subject.supplierId) {
        return {
          kind: "NONE",
          value: null,
          // 关键:归属缺失时**看不到**,而不是看全部
          description:
            "该账号未绑定供应商 —— 无可见数据。请联系管理员在用户上设置供应商归属,而不是放开范围",
        };
      }
      return {
        kind: "SUPPLIER",
        value: subject.supplierId,
        description: "受限视图:仅显示与你所属供应商相关的数据",
      };
    }
    return { kind: "NONE", value: null, description: "该资源不对供应商开放" };
  }

  // 内部角色:默认看全租户
  if (subject.roles.length === 0) {
    return { kind: "NONE", value: null, description: "账号无任何角色 —— 无可见数据" };
  }
  return { kind: "ALL", value: null, description: "内部视图:显示本租户全部数据" };
}

/** 范围是否会过滤掉数据(用于 UI 决定是否显示"受限视图"提示) */
export function isRestricted(scope: ResolvedScope): boolean {
  return scope.kind !== "ALL";
}

/**
 * 范围为空时的措辞。
 *
 * **不能说"没有数据"** —— 那会让人以为业务上确实没有;
 * 要说"你的范围内没有",两者对使用者的下一步动作完全不同。
 */
export function emptyScopeNotice(scope: ResolvedScope): string | null {
  if (scope.kind === "NONE") return scope.description;
  if (scope.kind === "ALL") return null;
  return `以下仅为${SCOPE_LABEL[scope.kind]}范围内的数据 —— 看不到的部分不代表不存在`;
}
