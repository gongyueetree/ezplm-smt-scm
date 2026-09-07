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
import { getErpProvider, ErpNotConfiguredError, ErpNotImplementedError } from "@/lib/providers/erp";
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
    where: tenantWhere(session.tenantId, { id: session.portalAccountId, active: true }),
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
    const provider = getErpProvider(target.kind);
    const { items } = await provider.pullInventory(target.config, {});
    const norm = (v: string | null) => (v ?? "").toUpperCase();
    return {
      state: "ok",
      note: target.kind === "ERP_LAB" ? "数据来自 ERP 仿真环境(联调用)" : null,
      fetchedAt: new Date().toISOString(),
      // 白名单序列化:逐字段挑出;**只**保留本客户 customerCode 的行
      rows: items
        .filter((i) => norm(i.customerCode) === norm(customer.code))
        .map((i) => ({
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
