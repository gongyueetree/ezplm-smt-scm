/**
 * 数据范围策略的服务端落地:把 ResolvedScope 翻译成 Prisma where 片段。
 *
 * **业务代码不再各自判断"是不是供应商"**,一律:
 *   const scope = await scopeFor(session, "OPO_LINE");
 *   where: scopedWhere(session.tenantId, scope, { supplierField: "supplierId" })
 *
 * 纪律:
 * - 与 tenantWhere 叠加,**不替代它** —— 租户隔离与数据范围是两层;
 * - kind=NONE 时返回一个**必然为空**的条件,而不是省略过滤 ——
 *   省略等于放开,这正是最危险的失误。
 */
import {
  resolveScope,
  type ResolvedScope,
  type RoleName,
  type ScopedResource,
} from "@/lib/domain/data-scope";
import { prisma } from "@/lib/server/db";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantWhere } from "@/lib/server/tenant-scope";

/** 取会话主体的归属信息(供应商 / 客户 / 站点) */
export async function scopeFor(
  session: SessionRef,
  resource: ScopedResource,
): Promise<ResolvedScope> {
  const user = await prisma.user.findFirst({
    where: tenantWhere(session.tenantId, { id: session.userId }),
    select: { supplierId: true },
  });
  return resolveScope(
    {
      roles: session.roles as readonly RoleName[],
      supplierId: user?.supplierId ?? null,
      userId: session.userId,
    },
    resource,
  );
}

export interface ScopeFieldMap {
  /** 该表上代表供应商的字段名 */
  supplierField?: string;
  customerField?: string;
  siteField?: string;
  ownerField?: string;
}

/**
 * 生成 where 片段(已含 tenantId)。
 *
 * kind=NONE 时用一个**不可能命中**的条件,确保返回空集 ——
 * 直接省略过滤会变成"看全部",是最危险的失误。
 */
export function scopedWhere(
  tenantId: string,
  scope: ResolvedScope,
  fields: ScopeFieldMap,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = tenantWhere(tenantId, extra);

  switch (scope.kind) {
    case "ALL":
      return base;
    case "NONE":
      // 必然为空:不能省略,省略等于放开
      return { ...base, id: "__scope_none__" };
    case "SUPPLIER":
      if (!fields.supplierField) return { ...base, id: "__scope_none__" };
      return { ...base, [fields.supplierField]: scope.value };
    case "CUSTOMER":
      if (!fields.customerField) return { ...base, id: "__scope_none__" };
      return { ...base, [fields.customerField]: scope.value };
    case "SITE":
      if (!fields.siteField) return { ...base, id: "__scope_none__" };
      return { ...base, [fields.siteField]: scope.value };
    case "OWN":
      if (!fields.ownerField) return { ...base, id: "__scope_none__" };
      return { ...base, [fields.ownerField]: scope.value };
    case "PROJECT":
      return { ...base, id: "__scope_none__" };
  }
}
