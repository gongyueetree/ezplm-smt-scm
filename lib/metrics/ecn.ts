/**
 * F2:ECN KPI(lib/metrics 唯一查询层;列表页与管理/工程工作台共同消费)。
 */
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";

export interface EcnMetric {
  active: number;
  awaitingReview: number;
  customerConfirm: number;
  /** dueDate 已过且未到终态 */
  overdue: number;
  releasedThisMonth: number;
}

const TERMINAL = ["CLOSED", "VOIDED"] as const;

export async function ecnMetric(tenantId: string, now = new Date()): Promise<EcnMetric> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [active, awaitingReview, customerConfirm, overdue, releasedThisMonth] = await Promise.all([
    prisma.ecn.count({
      where: tenantWhere(tenantId, { status: { notIn: TERMINAL as never } }),
    }),
    prisma.ecn.count({ where: tenantWhere(tenantId, { status: "REVIEW" as never }) }),
    prisma.ecn.count({ where: tenantWhere(tenantId, { status: "CUSTOMER_CONFIRM" as never }) }),
    prisma.ecn.count({
      where: tenantWhere(tenantId, {
        status: { notIn: TERMINAL as never },
        dueDate: { lt: now },
      }),
    }),
    prisma.ecn.count({
      where: tenantWhere(tenantId, { status: "RELEASED" as never, releasedAt: { gte: monthStart } }),
    }),
  ]);
  return { active, awaitingReview, customerConfirm, overdue, releasedThisMonth };
}
