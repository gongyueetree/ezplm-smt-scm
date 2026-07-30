import type { ReconciliationKind } from "@prisma/client";
import type { RoleName } from "@/lib/routes";

/**
 * AR/AP 按角色区分(SPEC §16「AR 与 AP 通过角色和 Tab 区分」)。
 * AR = 对客户,PM 侧;AP = 对供应商,采购侧;管理层两侧都可看。
 */
export function canAccessKind(roles: readonly RoleName[], kind: ReconciliationKind): boolean {
  if (roles.includes("MANAGEMENT")) return true;
  return kind === "AR" ? roles.includes("PM") : roles.includes("PROCUREMENT");
}

export function allowedKinds(roles: readonly RoleName[]): ReconciliationKind[] {
  const out: ReconciliationKind[] = [];
  if (canAccessKind(roles, "AR")) out.push("AR");
  if (canAccessKind(roles, "AP")) out.push("AP");
  return out;
}
