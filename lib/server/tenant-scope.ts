/**
 * 租户隔离守卫(CLAUDE.md 硬性约束 4:所有 update/delete 必须 tenant scoped)。
 * 纯函数实现,便于单测;由数据访问层统一调用,禁止业务代码绕过。
 */

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

/** 读查询:where 强制并入 tenantId(调用方 where 不得覆盖) */
export function tenantWhere<W extends Record<string, unknown>>(
  tenantId: string,
  where?: W,
): W & { tenantId: string } {
  if (!tenantId) throw new TenantScopeError("tenantId 缺失");
  if (where && "tenantId" in where && where.tenantId !== tenantId) {
    throw new TenantScopeError("where.tenantId 与会话租户不一致");
  }
  return { ...(where ?? ({} as W)), tenantId };
}

/** 写数据:create data 强制携带会话租户 */
export function tenantData<D extends Record<string, unknown>>(
  tenantId: string,
  data: D,
): D & { tenantId: string } {
  if (!tenantId) throw new TenantScopeError("tenantId 缺失");
  if ("tenantId" in data && data.tenantId !== tenantId) {
    throw new TenantScopeError("data.tenantId 与会话租户不一致");
  }
  return { ...data, tenantId };
}

/**
 * update/delete 前置断言:必须显式给出 tenant scoped 的 where。
 * 仅凭主键 id 的 update/delete 一律拒绝 —— 必须 { id, tenantId } 复合条件。
 */
export function assertTenantScopedMutation(
  tenantId: string,
  where: Record<string, unknown> | undefined,
): void {
  if (!where || typeof where !== "object") {
    throw new TenantScopeError("update/delete 缺少 where 条件");
  }
  if (where.tenantId !== tenantId) {
    throw new TenantScopeError("update/delete 的 where 未按会话租户 scoped");
  }
}
