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

/* ------------------------------------------------------------------ *
 * R0-5:把上面的断言真正接进数据层。
 *
 * 审计发现 `assertTenantScopedMutation` 在 app/ lib/ scripts/ 中**零调用** ——
 * CLAUDE.md 硬性约束 4 声明的守卫从未在运行时执行过,靠的全是人工自觉
 * (246 处写操作里有 58 处的 where 没有租户谓词)。
 *
 * 逐个调用点去加断言既易漏又难维护,所以改成**数据层统一拦截**:
 * 下面是纯函数判定,由 lib/server/db.ts 的 Prisma 扩展在每次写操作前调用。
 *
 * 先"只报不拦"(默认 warn),跑一轮把存量暴露出来;
 * 设 TENANT_SCOPE_ENFORCE=1 即切为抛错。
 * ------------------------------------------------------------------ */

/**
 * 没有 tenantId 列的模型 —— 天然不可能 tenant scoped,必须**显式登记**才豁免。
 * 现为全库仅有的三个:
 * - Tenant:租户表自身;
 * - CanonicalManufacturerRef:全局制造商标准表(ezPLM 为真源,跨租户共享);
 * - RateLimitBucket:公开面限流桶,按 key 全局计数(ROUND3 P0-B 的设计)。
 * 新增模型若没有 tenantId,必须在这里显式加一行并写明理由,不能默默放过。
 */
export const TENANT_EXEMPT_MODELS: ReadonlySet<string> = new Set([
  "Tenant",
  "CanonicalManufacturerRef",
  "RateLimitBucket",
]);

/** 必须 tenant scoped 的写操作(create 走 tenantData,不在此列) */
export const TENANT_SCOPED_ACTIONS: ReadonlySet<string> = new Set([
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
]);

export type TenantScopeViolationReason = "MISSING_WHERE" | "MISSING_TENANT";

export interface TenantScopeViolation {
  model: string;
  action: string;
  reason: TenantScopeViolationReason;
  message: string;
}

/**
 * 判定一次写操作是否缺少租户谓词。
 *
 * 只检查 where 里**有没有** tenantId —— 拦截器拿不到会话租户,
 * "是否等于会话租户"仍由 `tenantWhere` 在构造期保证。
 * 这样已经足以抓住真正危险的那类:`where: { id }` 裸主键写。
 */
export function checkTenantScopedMutation(
  model: string,
  action: string,
  where: unknown,
): TenantScopeViolation | null {
  if (!TENANT_SCOPED_ACTIONS.has(action)) return null;
  if (TENANT_EXEMPT_MODELS.has(model)) return null;

  if (!where || typeof where !== "object") {
    return {
      model,
      action,
      reason: "MISSING_WHERE",
      message: `${model}.${action} 缺少 where 条件`,
    };
  }
  if (!hasTenantPredicate(where as Record<string, unknown>)) {
    return {
      model,
      action,
      reason: "MISSING_TENANT",
      message: `${model}.${action} 的 where 没有租户谓词 —— 应经 tenantWhere() 构造`,
    };
  }
  return null;
}

/**
 * where 里是否存在租户谓词。
 *
 * 两种合法形态:
 * 1. 顶层 `{ tenantId, ... }` —— tenantWhere() 的产物;
 * 2. **复合唯一键选择器** `{ tenantId_partId_xxx: { tenantId, ... } }` ——
 *    Prisma 的 upsert/update 要求 where 是唯一键,复合唯一键会把 tenantId
 *    包在里层。这种写法同样是 tenant scoped,不能误判成违规
 *    (漏了这一条,PartMfgMapping / ExternalPartSnapshot 这类全都会被错报)。
 */
function hasTenantPredicate(where: Record<string, unknown>): boolean {
  if ("tenantId" in where) return true;
  for (const v of Object.values(where)) {
    if (v && typeof v === "object" && !Array.isArray(v) && "tenantId" in (v as object)) {
      return true;
    }
  }
  return false;
}
