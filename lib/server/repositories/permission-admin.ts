/**
 * 权限配置数据层。
 *
 * 纪律:
 * - 全部经 tenantWhere / tenantData;每次变更落 AuditLog(权限变更必须可追溯);
 * - **不允许把自己的权限管理权撤掉** —— 否则谁也进不去这个页面了;
 * - 角色默认权限来自代码常量,页面只读展示,不落库、不可改
 *   (改它等于改产品设计,应该走代码评审而不是运行时点两下)。
 */
import type { RoleName } from "@prisma/client";
import { explainPermissions, isPermission, type Permission } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export async function loadConfig(session: SessionRef) {
  const [grants, overrides, users, roles] = await Promise.all([
    prisma.permissionGrant.findMany({
      where: tenantWhere(session.tenantId),
      orderBy: [{ role: "asc" }, { permission: "asc" }],
    }),
    prisma.userPermission.findMany({
      where: tenantWhere(session.tenantId),
      orderBy: { permission: "asc" },
    }),
    prisma.user.findMany({
      where: tenantWhere(session.tenantId, { isActive: true }),
      select: { id: true, email: true, name: true, userRoles: { select: { role: { select: { name: true } } } } },
      orderBy: { email: "asc" },
    }),
    prisma.role.findMany({ where: tenantWhere(session.tenantId), select: { name: true } }),
  ]);

  return {
    grants: grants.map((g) => ({ id: g.id, role: g.role, permission: g.permission })),
    overrides: overrides.map((o) => ({
      id: o.id,
      userId: o.userId,
      permission: o.permission,
      granted: o.granted,
      reason: o.reason,
    })),
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      roles: u.userRoles.map((r) => r.role.name),
    })),
    roles: roles.map((r) => r.name),
  };
}

/** 某个用户的生效权限与来源推演 */
export async function explainForUser(session: SessionRef, userId: string) {
  const user = await prisma.user.findFirst({
    where: tenantWhere(session.tenantId, { id: userId }),
    select: { id: true, email: true, userRoles: { select: { role: { select: { name: true } } } } },
  });
  if (!user) return null;

  const roles = user.userRoles.map((r) => r.role.name) as RoleName[];
  const [grants, overrides] = await Promise.all([
    prisma.permissionGrant.findMany({
      where: tenantWhere(session.tenantId, { role: { in: roles } }),
      select: { role: true, permission: true },
    }),
    prisma.userPermission.findMany({
      where: tenantWhere(session.tenantId, { userId }),
      select: { permission: true, granted: true },
    }),
  ]);

  return {
    userId: user.id,
    email: user.email,
    roles,
    explanations: explainPermissions(roles, grants, overrides),
  };
}

export type MutateOutcome = { ok: true } | { ok: false; reason: string };

export async function setRoleGrant(
  session: SessionRef,
  role: RoleName,
  permission: string,
  enabled: boolean,
): Promise<MutateOutcome> {
  if (!isPermission(permission)) return { ok: false, reason: `未知权限串「${permission}」` };

  await prisma.$transaction(async (tx) => {
    if (enabled) {
      await tx.permissionGrant.upsert({
        where: { tenantId_role_permission: { tenantId: session.tenantId, role, permission } },
        update: {},
        create: tenantData(session.tenantId, { role, permission, createdById: session.userId }),
      });
    } else {
      await tx.permissionGrant.deleteMany({
        where: tenantWhere(session.tenantId, { role, permission }),
      });
    }
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: enabled ? "PERMISSION_GRANT_ADD" : "PERMISSION_GRANT_REMOVE",
      entityType: "PermissionGrant",
      entityId: `${role}:${permission}`,
      after: { role, permission, enabled },
    });
  });
  return { ok: true };
}

export async function setUserOverride(
  session: SessionRef,
  userId: string,
  permission: string,
  mode: "GRANT" | "REVOKE" | "CLEAR",
  reason?: string | null,
): Promise<MutateOutcome> {
  if (!isPermission(permission)) return { ok: false, reason: `未知权限串「${permission}」` };

  // 自锁保护:不允许把自己的权限管理权回收掉,否则这个页面就再也进不去了
  if (
    userId === session.userId &&
    permission === ("settings.permissions.manage" satisfies Permission) &&
    mode === "REVOKE"
  ) {
    return {
      ok: false,
      reason: "不能回收自己的「权限管理」权限 —— 否则将无人可进入本页面。请让另一位管理员操作",
    };
  }

  await prisma.$transaction(async (tx) => {
    if (mode === "CLEAR") {
      await tx.userPermission.deleteMany({
        where: tenantWhere(session.tenantId, { userId, permission }),
      });
    } else {
      await tx.userPermission.upsert({
        where: { tenantId_userId_permission: { tenantId: session.tenantId, userId, permission } },
        update: { granted: mode === "GRANT", reason: reason ?? null },
        create: tenantData(session.tenantId, {
          userId,
          permission,
          granted: mode === "GRANT",
          reason: reason ?? null,
          createdById: session.userId,
        }),
      });
    }
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: `PERMISSION_USER_${mode}`,
      entityType: "UserPermission",
      entityId: `${userId}:${permission}`,
      after: { userId, permission, mode, reason: reason ?? null },
    });
  });
  return { ok: true };
}
