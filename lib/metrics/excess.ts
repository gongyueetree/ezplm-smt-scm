/**
 * F1 · lib/metrics:Excess KPI。
 * 数据源状态优先:未配置(无快照)时返回 state,**不显示 0** ——
 * "没接入"与"没有呆滞"是两回事(客户 Q1 已确认走 ERP,凭据未到)。
 */
import Decimal from "decimal.js";
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export interface ExcessMetric {
  state: "NOT_CONFIGURED" | "READY";
  snapshotAt: string | null;
  lineCount: number;
  totalQty: string | null;
}

export async function excessMetric(tenantId: string): Promise<ExcessMetric> {
  const latest = await prisma.excessSnapshot.findFirst({
    where: tenantWhere(tenantId),
    orderBy: { snapshotAt: "desc" },
    include: { lines: { select: { qty: true } } },
  });
  if (!latest) {
    return { state: "NOT_CONFIGURED", snapshotAt: null, lineCount: 0, totalQty: null };
  }
  const total = latest.lines.reduce((acc, l) => acc.plus(new Decimal(String(l.qty))), new Decimal(0));
  return {
    state: "READY",
    snapshotAt: latest.snapshotAt.toISOString(),
    lineCount: latest.lines.length,
    totalQty: total.toFixed(),
  };
}
