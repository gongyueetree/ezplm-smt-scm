/**
 * 服务端权限读取与守卫。
 *
 * 判定顺序见 `lib/auth/permissions.ts`:角色默认 → 租户级授予 → 用户级授予/回收。
 * 每次判定都读库(两张小表 + 索引),不做进程内缓存 ——
 * 权限被回收后必须**立刻**生效,缓存带来的窗口期不值得这点性能。
 */
import { forbidden } from "@/lib/server/api";
import {
  effectivePermissions,
  type Permission,
} from "@/lib/auth/permissions";
import { prisma } from "@/lib/server/db";
import type { RoleName } from "@/lib/routes";
import { tenantWhere } from "@/lib/server/tenant-scope";

export interface SessionLike {
  tenantId: string;
  userId: string;
  roles: RoleName[];
}

export async function loadPermissions(session: SessionLike): Promise<Set<Permission>> {
  const [grants, overrides] = await Promise.all([
    prisma.permissionGrant.findMany({
      where: tenantWhere(session.tenantId, { role: { in: session.roles } }),
      select: { role: true, permission: true },
    }),
    prisma.userPermission.findMany({
      where: tenantWhere(session.tenantId, { userId: session.userId }),
      select: { permission: true, granted: true },
    }),
  ]);
  return effectivePermissions(session.roles, grants, overrides);
}

export async function can(session: SessionLike, permission: Permission): Promise<boolean> {
  return (await loadPermissions(session)).has(permission);
}

/**
 * 路由守卫:无权限时返回 403 响应,措辞指明**缺哪个权限**,
 * 便于管理员知道该授予什么,而不是只看到一句"无权限"。
 */
export async function requirePermission(
  session: SessionLike,
  permission: Permission,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (await can(session, permission)) return { ok: true };
  return {
    ok: false,
    response: forbidden(`缺少权限「${permission}」—— 请联系管理员在系统设置中授予`),
  };
}
