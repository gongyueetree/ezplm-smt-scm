/**
 * 采购策略阈值(Backlog B3)。
 * 阈值从"页面内常量"升级为按租户持久化;
 * **口径未经业务确认前,UI 必须标注为演示阈值,不得当作正式风控**。
 */
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";
import type { SessionRef } from "./rfq";

/** 未配置时的兜底(与此前页面内常量一致,标注为未确认) */
export const FALLBACK_POLICY = {
  currency: "CNY",
  maxUnitPrice: "10",
  maxLeadTimeDays: 30,
  confirmedByBusiness: false,
} as const;

export interface PolicyView {
  currency: string;
  /** null = 不校验该项 */
  maxUnitPrice: string | null;
  maxLeadTimeDays: number | null;
  confirmedByBusiness: boolean;
  /** true = 尚未在系统中配置,当前用兜底值 */
  isFallback: boolean;
  updatedAt: string | null;
}

export async function getProcurementPolicy(tenantId: string): Promise<PolicyView> {
  const row = await prisma.procurementPolicy.findFirst({ where: tenantWhere(tenantId) });
  if (!row) {
    return {
      currency: FALLBACK_POLICY.currency,
      maxUnitPrice: FALLBACK_POLICY.maxUnitPrice,
      maxLeadTimeDays: FALLBACK_POLICY.maxLeadTimeDays,
      confirmedByBusiness: false,
      isFallback: true,
      updatedAt: null,
    };
  }
  return {
    currency: row.currency,
    maxUnitPrice: row.maxUnitPrice === null ? null : String(row.maxUnitPrice),
    maxLeadTimeDays: row.maxLeadTimeDays,
    confirmedByBusiness: row.confirmedByBusiness,
    isFallback: false,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface SavePolicyInput {
  currency: string;
  maxUnitPrice: string | null;
  maxLeadTimeDays: number | null;
  confirmedByBusiness: boolean;
}

export async function saveProcurementPolicy(session: SessionRef, input: SavePolicyInput) {
  const existing = await prisma.procurementPolicy.findFirst({
    where: tenantWhere(session.tenantId),
  });

  return prisma.$transaction(async (tx) => {
    const data = {
      currency: input.currency.toUpperCase(),
      maxUnitPrice: input.maxUnitPrice,
      maxLeadTimeDays: input.maxLeadTimeDays,
      confirmedByBusiness: input.confirmedByBusiness,
      updatedById: session.userId,
    };
    if (existing) {
      await tx.procurementPolicy.updateMany({
        where: tenantWhere(session.tenantId, { id: existing.id }),
        data,
      });
    } else {
      await tx.procurementPolicy.create({ data: tenantData(session.tenantId, data) });
    }
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "PROCUREMENT_POLICY_SAVE",
      entityType: "ProcurementPolicy",
      entityId: existing?.id ?? session.tenantId,
      before: existing
        ? {
            currency: existing.currency,
            maxUnitPrice: existing.maxUnitPrice === null ? null : String(existing.maxUnitPrice),
            maxLeadTimeDays: existing.maxLeadTimeDays,
            confirmedByBusiness: existing.confirmedByBusiness,
          }
        : undefined,
      after: data,
    });
  });
}
