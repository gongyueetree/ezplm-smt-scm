/**
 * F6-B:门户服务端 —— 会话守卫、双开关、DTO 白名单(设计 §2–§3)。
 *
 * 数据边界铁律:白名单序列化函数是**唯一**出数路径 ——
 * 不存在把 Provider 原始行直接 JSON 给门户的代码;
 * 采购价/供应商/毛利/其他客户数据在类型上就进不来。
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  PORTAL_COOKIE,
  portalSecretConfigured,
  verifyPortalSession,
  type PortalSessionPayload,
} from "@/lib/auth/portal-session";
import { ErpNotConfiguredError, ErpNotImplementedError } from "@/lib/providers/erp";
import { prisma } from "@/lib/server/db";
import { resolveErpTarget } from "@/lib/server/repositories/integration-sync";
import { getTenantSettings } from "@/lib/server/tenant-settings";
import { tenantWhere } from "@/lib/server/tenant-scope";

/** 双开关:环境变量 + 任一租户开了 flag(页面级还会按会话租户再查一次) */
export function portalGloballyEnabled(): boolean {
  return process.env.CUSTOMER_PORTAL_ENABLED === "1" && portalSecretConfigured();
}

export async function portalEnabledForTenant(tenantId: string): Promise<boolean> {
  if (!portalGloballyEnabled()) return false;
  const { settings } = await getTenantSettings(tenantId);
  return settings.featureFlags["customerPortal"];
}

export type PortalAuth =
  | { ok: true; session: PortalSessionPayload }
  | { ok: false; response: NextResponse };

/** API 守卫:只认 portal_session;内部会话在这里没有任何效力 */
export async function requirePortalSession(): Promise<PortalAuth> {
  if (!portalGloballyEnabled()) {
    return {
      ok: false,
      response: NextResponse.json({ error: "客户门户未启用" }, { status: 404 }),
    };
  }
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  const session = token ? await verifyPortalSession(token) : null;
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "未登录门户" }, { status: 401 }) };
  }
  if (!(await portalEnabledForTenant(session.tenantId))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "客户门户未启用" }, { status: 404 }),
    };
  }
  // 账号仍需在启用状态(邀请可被停用)
  const account = await prisma.portalAccount.findFirst({
    // R3-3:status 为真源;DISABLED 即时截断在途会话
    where: tenantWhere(session.tenantId, { id: session.portalAccountId, status: "ACTIVE" as const }),
    select: { id: true },
  });
  if (!account) {
    return { ok: false, response: NextResponse.json({ error: "账号已停用" }, { status: 401 }) };
  }
  return { ok: true, session };
}

// ============================================================
// DTO 白名单(设计 §3)—— 门户唯一出数形状
// ============================================================

/** 门户库存行:字段逐个挑出。**没有价格、没有供应商、没有内部备注的字段位** */
export interface PortalInventoryRow {
  materialCode: string;
  qty: string;
  warehouse: string | null;
  lotNo: string | null;
  updatedAt: string | null;
}

export interface PortalInventoryResult {
  state: "ok" | "not_configured" | "error";
  note: string | null;
  fetchedAt: string | null;
  rows: PortalInventoryRow[];
}

/**
 * 「我的库存」:ErpProvider.pullInventory 按本客户 code 过滤(customerCode 维度)。
 * ERP 未配置 → 「待接入」空态,不显示 0;失败 → 如实报错。
 */
export async function portalInventory(session: PortalSessionPayload): Promise<PortalInventoryResult> {
  const customer = await prisma.customer.findFirst({
    where: tenantWhere(session.tenantId, { id: session.customerId }),
    select: { code: true },
  });
  if (!customer) return { state: "error", note: "客户档案缺失", fetchedAt: null, rows: [] };

  const target = await resolveErpTarget(session.tenantId);
  if (target.kind === "NONE") {
    return { state: "not_configured", note: "库存数据待接入(ERP 未配置)", fetchedAt: null, rows: [] };
  }
  try {
    const provider = target.provider; // closed-loop:必须用 target 里的租户感知实例,不得回退无租户工厂
    /*
     * closed-loop P0-5/R3-2:**Provider 层带 customerCode 过滤 + 分页** ——
     * 门户请求不再全量拉取整租户库存。应用层保留二次校验(defense-in-depth):
     * Provider 若忽略过滤参数,越界行仍会在这里被丢弃并如实计数。
     */
    const PAGE_LIMIT = 200;
    const { items, page: pageInfo } = await provider.pullInventory(target.config, {
      customerCode: customer.code,
      limit: PAGE_LIMIT,
    });
    const norm = (v: string | null) => (v ?? "").toUpperCase();
    const scoped = items.filter((i) => norm(i.customerCode) === norm(customer.code));
    const leaked = items.length - scoped.length;
    return {
      state: "ok",
      note: [
        target.kind === "ERP_LAB" ? "数据来自 ERP 仿真环境(联调用)" : null,
        pageInfo.hasMore ? `仅显示前 ${PAGE_LIMIT} 条(共 ${pageInfo.total ?? "更多"} 条)` : null,
        leaked > 0 ? `Provider 未执行客户过滤,已在应用层丢弃 ${leaked} 条越界行(defense-in-depth)` : null,
      ]
        .filter(Boolean)
        .join(";") || null,
      fetchedAt: new Date().toISOString(),
      // 白名单序列化:逐字段挑出
      rows: scoped.map((i) => ({
        materialCode: i.materialCode ?? i.internalPn ?? "?",
        qty: i.qty,
        warehouse: i.warehouse,
        lotNo: i.lotNo,
        updatedAt: i.receivedAt,
      })),
    };
  } catch (e) {
    if (e instanceof ErpNotConfiguredError || e instanceof ErpNotImplementedError) {
      return { state: "not_configured", note: e.message, fetchedAt: null, rows: [] };
    }
    return {
      state: "error",
      note: `数据源失败:${e instanceof Error ? e.message : "未知错误"}`,
      fetchedAt: null,
      rows: [],
    };
  }
}

// ============================================================
// R3-7:出入流水 / 批次(合约接上;白名单 DTO 延续同一纪律)
// ============================================================

/** 门户流水行:无单价、无供应商、无内部备注字段位 */
export interface PortalMovementRow {
  materialCode: string;
  movementType: string;
  qty: string;
  warehouse: string | null;
  lotNo: string | null;
  refDocNo: string | null;
  occurredAt: string;
}

/** 门户批次行:**没有 supplierCode 字段位**(供应商归属是内部信息) */
export interface PortalLotRow {
  lotNo: string;
  materialCode: string;
  qty: string;
  warehouse: string | null;
  receivedAt: string | null;
  expiresAt: string | null;
  status: string | null;
}

interface PortalSourceResult<T> {
  state: "ok" | "not_configured" | "error";
  note: string | null;
  fetchedAt: string | null;
  rows: T[];
}

/** 共用取数壳:客户 scope + Provider 过滤 + defense-in-depth 二次校验 + 白名单映射 */
async function portalScopedPull<Raw extends { customerCode?: string | null }, Row>(
  session: PortalSessionPayload,
  pull: (provider: Awaited<ReturnType<typeof resolveErpTarget>> & { kind: Exclude<Awaited<ReturnType<typeof resolveErpTarget>>["kind"], "NONE"> }, customerCode: string) => Promise<{ items: Raw[]; page: { hasMore: boolean; total: number | null } }>,
  toRow: (raw: Raw) => Row,
  emptyNote: string,
): Promise<PortalSourceResult<Row>> {
  const customer = await prisma.customer.findFirst({
    where: tenantWhere(session.tenantId, { id: session.customerId }),
    select: { code: true },
  });
  if (!customer) return { state: "error", note: "客户档案缺失", fetchedAt: null, rows: [] };

  const target = await resolveErpTarget(session.tenantId);
  if (target.kind === "NONE") {
    return { state: "not_configured", note: emptyNote, fetchedAt: null, rows: [] };
  }
  try {
    const PAGE_LIMIT = 200;
    const { items, page: pageInfo } = await pull(target as never, customer.code);
    const norm = (v: string | null | undefined) => (v ?? "").toUpperCase();
    const scoped = items.filter((i) => norm(i.customerCode) === norm(customer.code));
    const leaked = items.length - scoped.length;
    return {
      state: "ok",
      note:
        [
          target.kind === "ERP_LAB" ? "数据来自 ERP 仿真环境(联调用)" : null,
          pageInfo.hasMore ? `仅显示前 ${PAGE_LIMIT} 条(共 ${pageInfo.total ?? "更多"} 条)` : null,
          leaked > 0 ? `Provider 未执行客户过滤,已在应用层丢弃 ${leaked} 条越界行(defense-in-depth)` : null,
        ]
          .filter(Boolean)
          .join(";") || null,
      fetchedAt: new Date().toISOString(),
      rows: scoped.map(toRow),
    };
  } catch (e) {
    if (e instanceof ErpNotConfiguredError || e instanceof ErpNotImplementedError) {
      return { state: "not_configured", note: e.message, fetchedAt: null, rows: [] };
    }
    return {
      state: "error",
      note: `数据源失败:${e instanceof Error ? e.message : "未知错误"}`,
      fetchedAt: null,
      rows: [],
    };
  }
}

export async function portalMovements(session: PortalSessionPayload): Promise<PortalSourceResult<PortalMovementRow>> {
  return portalScopedPull(
    session,
    (target, customerCode) =>
      target.provider.pullInventoryMovements(target.config, { customerCode, limit: 200 }),
    (m) => ({
      materialCode: m.materialCode,
      movementType: m.movementType,
      qty: m.qty,
      warehouse: m.warehouseCode,
      lotNo: m.lotNo,
      refDocNo: m.refDocNo,
      occurredAt: m.occurredAt,
    }),
    "出入流水数据待接入(ERP 未配置)",
  );
}

export async function portalLots(session: PortalSessionPayload): Promise<PortalSourceResult<PortalLotRow>> {
  return portalScopedPull(
    session,
    (target, customerCode) =>
      target.provider.pullInventoryLots(target.config, { customerCode, limit: 200 }),
    (l) => ({
      lotNo: l.lotNo,
      materialCode: l.materialCode,
      qty: l.qty,
      warehouse: l.warehouseCode,
      receivedAt: l.receivedAt,
      expiresAt: l.expiresAt,
      status: l.status,
    }),
    "批次数据待接入(ERP 未配置)",
  );
}
