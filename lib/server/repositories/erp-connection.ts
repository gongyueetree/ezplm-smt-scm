/**
 * ERP 连接与凭据数据层。
 *
 * 纪律:
 * - 全部经 tenantWhere / tenantData;跨租户连接不可访问;
 * - **凭据只进不出**:任何返回值都不含明文,只回 maskedHint;
 * - **AuditLog 只记字段名不记值**(见 writeAudit 调用处);
 * - `status=CONNECTED` **只能**由真实 testConnection 成功后写入。
 */
import type { ErpConnectionStatus, ErpVendor } from "@prisma/client";
import { getErpProvider } from "@/lib/providers/erp";
import type { ConnectionTestResult, ErpConnectionConfig } from "@/lib/providers/erp/types";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import {
  credentialKeyAvailable,
  openCredential,
  redactSensitive,
  sealCredential,
} from "@/lib/server/erp-credentials";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export interface ConnectionView {
  id: string;
  name: string;
  vendor: ErpVendor;
  edition: string | null;
  /** 已脱敏 */
  config: unknown;
  status: ErpConnectionStatus;
  lastTestAt: string | null;
  lastTestResult: unknown;
  syncCron: string | null;
  enabled: boolean;
  /** 只有字段名与掩码,**没有明文** */
  credentials: { field: string; maskedHint: string; updatedAt: string }[];
  createdAt: string;
}

function toView(row: {
  id: string;
  name: string;
  vendor: ErpVendor;
  edition: string | null;
  config: unknown;
  status: ErpConnectionStatus;
  lastTestAt: Date | null;
  lastTestResult: unknown;
  syncCron: string | null;
  enabled: boolean;
  createdAt: Date;
  credentials: { field: string; maskedHint: string; updatedAt: Date }[];
}): ConnectionView {
  return {
    id: row.id,
    name: row.name,
    vendor: row.vendor,
    edition: row.edition,
    // 再脱敏一次:即便有人把密钥误写进 config,也不会漏出去
    config: redactSensitive(row.config),
    status: row.status,
    lastTestAt: row.lastTestAt?.toISOString() ?? null,
    lastTestResult: redactSensitive(row.lastTestResult),
    syncCron: row.syncCron,
    enabled: row.enabled,
    credentials: row.credentials.map((c) => ({
      field: c.field,
      maskedHint: c.maskedHint,
      updatedAt: c.updatedAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listConnections(session: SessionRef): Promise<ConnectionView[]> {
  const rows = await prisma.erpConnection.findMany({
    where: tenantWhere(session.tenantId),
    include: { credentials: { select: { field: true, maskedHint: true, updatedAt: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toView);
}

export async function getConnection(session: SessionRef, id: string): Promise<ConnectionView | null> {
  const row = await prisma.erpConnection.findFirst({
    where: tenantWhere(session.tenantId, { id }),
    include: { credentials: { select: { field: true, maskedHint: true, updatedAt: true } } },
  });
  return row ? toView(row) : null;
}

export interface UpsertConnectionInput {
  name: string;
  vendor: ErpVendor;
  edition?: string | null;
  config?: Record<string, unknown>;
  syncCron?: string | null;
  /** 明文凭据:落库前加密,**不进任何日志** */
  secrets?: Record<string, string>;
}

export type UpsertOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: string };

export async function createConnection(
  session: SessionRef,
  input: UpsertConnectionInput,
): Promise<UpsertOutcome> {
  if (input.secrets && Object.keys(input.secrets).length > 0 && !credentialKeyAvailable()) {
    return {
      ok: false,
      reason: "未配置 ERP_CREDENTIAL_KEY —— 拒绝以明文保存凭据,请先配置加密密钥",
    };
  }
  const dup = await prisma.erpConnection.findFirst({
    where: tenantWhere(session.tenantId, { name: input.name }),
    select: { id: true },
  });
  if (dup) return { ok: false, reason: "同名连接已存在" };

  const created = await prisma.$transaction(async (tx) => {
    const conn = await tx.erpConnection.create({
      data: tenantData(session.tenantId, {
        name: input.name,
        vendor: input.vendor,
        edition: input.edition ?? null,
        config: (input.config ?? {}) as object,
        syncCron: input.syncCron ?? null,
        // 新建一律 NOT_CONFIGURED:**没测过就不能说连上了**
        status: "NOT_CONFIGURED",
        createdById: session.userId,
      }),
    });

    for (const [field, plain] of Object.entries(input.secrets ?? {})) {
      if (!plain?.trim()) continue;
      const sealed = sealCredential(plain);
      await tx.erpCredential.create({
        data: tenantData(session.tenantId, {
          connectionId: conn.id,
          field,
          cipherText: sealed.cipherText,
          iv: sealed.iv,
          authTag: sealed.authTag,
          maskedHint: sealed.maskedHint,
          updatedById: session.userId,
        }),
      });
    }

    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "ERP_CONNECTION_CREATE",
      entityType: "ErpConnection",
      entityId: conn.id,
      // 只记字段名,不记值
      after: {
        name: input.name,
        vendor: input.vendor,
        edition: input.edition ?? null,
        config: redactSensitive(input.config ?? {}),
        secretFields: Object.keys(input.secrets ?? {}),
      },
    });
    return conn;
  });

  return { ok: true, id: created.id };
}

/** 组装 Provider 入参(解密只在此处发生,结果不落任何日志) */
async function buildProviderConfig(
  session: SessionRef,
  connectionId: string,
): Promise<{ conn: { vendor: ErpVendor; edition: string | null; config: unknown }; cfg: ErpConnectionConfig } | null> {
  const conn = await prisma.erpConnection.findFirst({
    where: tenantWhere(session.tenantId, { id: connectionId }),
    include: { credentials: true },
  });
  if (!conn) return null;

  const secrets: Record<string, string> = {};
  for (const c of conn.credentials) {
    try {
      secrets[c.field] = openCredential(c);
    } catch {
      // 解不开(密钥换过)就当作缺这项:后续会被判为"缺凭据 → 待联调"
    }
  }

  return {
    conn: { vendor: conn.vendor, edition: conn.edition, config: conn.config },
    cfg: {
      vendor: conn.vendor,
      edition: conn.edition,
      config: (conn.config ?? {}) as Record<string, unknown>,
      secrets,
    },
  };
}

/**
 * 真实连接测试。
 *
 * **CONNECTED 只能在 provider 真的返回 ok=true 时写入。**
 * 未配凭据 → NOT_CONFIGURED;能连但能力不全 → DEGRADED;失败 → FAILED。
 */
export async function testConnection(
  session: SessionRef,
  connectionId: string,
): Promise<{ ok: true; result: ConnectionTestResult; status: ErpConnectionStatus } | { ok: false; reason: string }> {
  const built = await buildProviderConfig(session, connectionId);
  if (!built) return { ok: false, reason: "连接不存在或不属于当前租户" };

  const provider = getErpProvider(built.conn.vendor);
  const result = await provider.testConnection(built.cfg);

  let status: ErpConnectionStatus;
  if (result.ok) {
    status = result.capabilities.length > 0 ? "CONNECTED" : "DEGRADED";
  } else if (result.failureReason?.includes("缺少必填项") || result.failureReason?.includes("尚未联调")) {
    status = "NOT_CONFIGURED";
  } else {
    status = "FAILED";
  }

  await prisma.$transaction(async (tx) => {
    await tx.erpConnection.update({
      where: { id: connectionId },
      data: {
        status,
        lastTestAt: new Date(),
        lastTestResult: redactSensitive(result) as object,
      },
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "ERP_CONNECTION_TEST",
      entityType: "ErpConnection",
      entityId: connectionId,
      after: { status, ok: result.ok, responseMs: result.responseMs, failureReason: result.failureReason },
    });
  });

  return { ok: true, result, status };
}

export async function getMetadata(session: SessionRef, connectionId: string) {
  const built = await buildProviderConfig(session, connectionId);
  if (!built) return null;
  return getErpProvider(built.conn.vendor).getMetadata(built.cfg);
}

export { buildProviderConfig };
