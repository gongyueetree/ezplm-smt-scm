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
  ],
  PROCUREMENT: [
    "material.view",
    "trace.view",
    "trace.export",
    "erp.connection.view",
    "erp.sync.preview",
  ],
  PM: ["material.view", "trace.view", "trace.export", "erp.connection.view"],
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

/** 任一满足即可 */
export function hasAnyPermission(
  perms: ReadonlySet<Permission>,
  required: readonly Permission[],
): boolean {
  return required.some((r) => perms.has(r));
}
