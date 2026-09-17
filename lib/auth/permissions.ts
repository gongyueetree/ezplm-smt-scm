/**
 * 权限串体系。
 *
 * 背景:原模型只有 5 个角色枚举(PM/PROCUREMENT/ENGINEERING/MANAGEMENT/SUPPLIER),
 * 没有细粒度权限,也没有"系统管理员"。
 *
 * 设计:**不新增硬编码角色** —— 「系统管理员」= MANAGEMENT 角色 + `erp.connection.manage`
 * 这类权限的组合,由 PermissionGrant / UserPermission 按租户配置。
 * 这样既满足细粒度需求,又不和既有 RoleName 架构打架。
 *
 * 判定顺序(后者覆盖前者):
 *   角色默认(本文件) → 租户级角色授予(PermissionGrant) → 用户级授予/回收(UserPermission)
 * 用户级可以**明确回收**(granted=false),即便角色默认有也不给 —— 便于收紧个别账号。
 */
import type { RoleName } from "@/lib/routes";

export const PERMISSIONS = [
  // 物料
  "material.view",
  "material.create",
  "material.review",
  "material.disable",
  // ERP 集成
  "erp.connection.view",
  "erp.connection.manage",
  "erp.mapping.manage",
  "erp.sync.preview",
  "erp.sync.execute",
  "erp.sync.resolve_conflict",
  // 追溯
  "trace.view",
  "trace.import",
  "trace.analyze",
  "trace.containment.propose",
  "trace.containment.approve",
  "trace.export",
  /*
   * 品质(E6 / 客户 Q12:「质量事件由**品质**录入」)。
   *
   * 客户说质量事件归品质,而系统里没有 QUALITY 角色。
   * **不为这一个功能去动 RoleName 枚举** —— 角色枚举牵连菜单、工作台、
   * 数据范围与一大批既有测试,为一个模块改它得不偿失,
   * 而且本项目从一开始就是"角色少、权限细"的路子。
   *
   * 所以品质用权限表达:默认给 MANAGEMENT,
   * 具体到人由 UserPermission 单独授予(品质专员不必是管理层)。
   */
  "quality.view",
  "quality.create",
  "quality.manage",
  /*
   * R0-6:AI 写提案(SPEC §13 / CLAUDE.md 约束 3)。
   *
   * 这两个端点此前**只有 requireSession**,任何已登录的租户用户都能触发 Agent
   * 运行并批准 AI 写入 —— 人工确认闭环形同虚设。
   *
   * 沿用「提议与批准分离」的既有做法(参照隔离处置 propose/approve):
   * run 给 PM(报价是 PM 的活),approve 默认只给 MANAGEMENT,
   * 需要下放时经 UserPermission 单独授予。
   */
  "quote.agent.run",
  "quote.agent.approve",
  // 权限本身的管理权 —— 默认只给 MANAGEMENT
  "settings.permissions.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(v: string): v is Permission {
  return (PERMISSIONS as readonly string[]).includes(v);
}

/**
 * 角色默认权限。
 *
 * 取舍说明(与客户给的建议一致):
 * - 建料属工程职责,PM/采购默认**只读**,需要时经 UserPermission 单独授予;
 * - ERP 连接配置与字段映射默认只给 MANAGEMENT —— 那里有凭据;
 * - 隔离处置:工程可**提议**,只有 MANAGEMENT 可**批准**(提议与批准分离);
 * - SUPPLIER 只给 trace.view,实际可见范围由**行级过滤**限制到与其自身相关的数据,
 *   不是靠页面级权限糊弄。
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  ENGINEERING: [
    "material.view",
    "material.create",
    "material.review",
    "trace.view",
    "trace.import",
    "trace.analyze",
    "trace.containment.propose",
    "erp.connection.view",
    // 工程默认可**看**质量事件(追溯分析常要看它),但不默认可建
    "quality.view",
  ],
  PROCUREMENT: [
    "material.view",
    "trace.view",
    "trace.export",
    "erp.connection.view",
    "erp.sync.preview",
  ],
  PM: [
    "material.view",
    "trace.view",
    "trace.export",
    "erp.connection.view",
    // 报价是 PM 的活,可以跑 Agent 出建议;但**批准写入**默认不给(见 PERMISSIONS 注释)
    "quote.agent.run",
  ],
  MANAGEMENT: [...PERMISSIONS],
  SUPPLIER: ["trace.view"],
};

export interface PermissionOverride {
  permission: string;
  granted: boolean;
}

/**
 * 计算用户的有效权限集。
 *
 * @param roles 用户角色
 * @param tenantGrants 租户级额外授予(角色 → 权限)
 * @param userOverrides 用户级授予/回收
 */
export function effectivePermissions(
  roles: readonly RoleName[],
  tenantGrants: readonly { role: RoleName; permission: string }[] = [],
  userOverrides: readonly PermissionOverride[] = [],
): Set<Permission> {
  const out = new Set<Permission>();

  for (const r of roles) {
    for (const p of ROLE_DEFAULT_PERMISSIONS[r] ?? []) out.add(p);
  }
  for (const g of tenantGrants) {
    if (roles.includes(g.role) && isPermission(g.permission)) out.add(g.permission);
  }
  // 用户级最后生效,可加可减
  for (const o of userOverrides) {
    if (!isPermission(o.permission)) continue;
    if (o.granted) out.add(o.permission);
    else out.delete(o.permission);
  }
  return out;
}

export function hasPermission(
  perms: ReadonlySet<Permission>,
  required: Permission,
): boolean {
  return perms.has(required);
}

export type PermissionSource = "ROLE_DEFAULT" | "TENANT_GRANT" | "USER_GRANT";

export interface PermissionExplanation {
  permission: Permission;
  granted: boolean;
  /** 最终由谁决定的 —— 便于回答"他为什么有/没有这个权限" */
  decidedBy: PermissionSource | "USER_REVOKE" | "NONE";
  /** 完整来源链(按判定顺序) */
  trail: { source: PermissionSource | "USER_REVOKE"; detail: string }[];
}

/**
 * 逐权限解释来源。
 *
 * 权限配置页最有价值的不是"能改",而是能回答**"他为什么有这个权限"** ——
 * 三层叠加时,光看最终结果没法排查配错在哪一层。
 */
export function explainPermissions(
  roles: readonly RoleName[],
  tenantGrants: readonly { role: RoleName; permission: string }[] = [],
  userOverrides: readonly PermissionOverride[] = [],
): PermissionExplanation[] {
  return PERMISSIONS.map((permission) => {
    const trail: PermissionExplanation["trail"] = [];
    let granted = false;
    let decidedBy: PermissionExplanation["decidedBy"] = "NONE";

    for (const r of roles) {
      if ((ROLE_DEFAULT_PERMISSIONS[r] ?? []).includes(permission)) {
        granted = true;
        decidedBy = "ROLE_DEFAULT";
        trail.push({ source: "ROLE_DEFAULT", detail: `角色 ${r} 的默认权限` });
      }
    }
    for (const g of tenantGrants) {
      if (roles.includes(g.role) && g.permission === permission) {
        granted = true;
        decidedBy = "TENANT_GRANT";
        trail.push({ source: "TENANT_GRANT", detail: `租户为角色 ${g.role} 额外授予` });
      }
    }
    for (const o of userOverrides) {
      if (o.permission !== permission) continue;
      granted = o.granted;
      decidedBy = o.granted ? "USER_GRANT" : "USER_REVOKE";
      trail.push({
        source: o.granted ? "USER_GRANT" : "USER_REVOKE",
        detail: o.granted ? "用户级单独授予" : "用户级明确回收(覆盖前面所有授予)",
      });
    }

    return { permission, granted, decidedBy, trail };
  });
}

/** 任一满足即可 */
export function hasAnyPermission(
  perms: ReadonlySet<Permission>,
  required: readonly Permission[],
): boolean {
  return required.some((r) => perms.has(r));
}
