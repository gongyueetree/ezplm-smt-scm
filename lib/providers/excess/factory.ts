/**
 * Excess Provider 工厂。
 *
 * 选择逻辑很简单:**库里有快照就用库里的,没有就是未配置**。
 * 不引入开关环境变量 —— 多一个开关就多一种"配了但没生效"的故障模式,
 * 而这里的判据本身就是可观测的(有没有快照)。
 */
import { prisma } from "@/lib/server/db";
import { tenantWhere } from "@/lib/server/tenant-scope";
import {
  createDbExcessProvider,
  createUnconfiguredExcessProvider,
  type ExcessProvider,
} from "./index";

export async function getExcessProvider(): Promise<ExcessProvider> {
  const any = await prisma.excessSnapshot.findFirst({ select: { id: true } });
  if (!any) return createUnconfiguredExcessProvider();

  return createDbExcessProvider({
    findLatestSnapshot: async (tenantId) =>
      prisma.excessSnapshot.findFirst({
        where: tenantWhere(tenantId),
        orderBy: { snapshotAt: "desc" },
        select: { id: true, snapshotAt: true, source: true },
      }),
    findLines: async ({ tenantId, snapshotId, mpns, customerId }) =>
      prisma.excessLine.findMany({
        where: tenantWhere(tenantId, {
          snapshotId,
          mpn: { in: [...mpns] },
          // 只取通用 + 本客户;别家客户的行由上层护栏判定,这里先不过滤掉,
          // 否则页面就看不到"有 500 属于别家、不可占用"这条信息
          ...(customerId ? {} : {}),
        }),
        select: {
          customerId: true,
          mpn: true,
          internalPn: true,
          qty: true,
          availableQty: true,
          notes: true,
        },
      }),
  });
}
