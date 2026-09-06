/**
 * 管理工作台快照(SPEC §16)。
 *
 * F1 重构:本文件不再自己聚合 —— 全部转发 lib/metrics(KPI 唯一查询层)。
 * 后续 F6 品质看板 / F2 ECN KPI 消费同一层,两个页面同一指标必然同数。
 */
import {
  excessMetric,
  grossMarginMetric,
  inventoryMetrics,
  opoMetric,
  orderConversionMetric,
  qualityMetric,
  quoteStatsMetric,
  scrapLossMetric,
  shortageMetric,
  type ExcessMetric,
  type QualityMetric,
  type ScrapLossMetric,
} from "@/lib/metrics";

export interface ManagementSnapshot {
  quotes: Awaited<ReturnType<typeof quoteStatsMetric>>["stats"];
  /** 真正的订单转化率(靠 PM 人工标记中标),与审批通过率分开显示 */
  conversion: Awaited<ReturnType<typeof orderConversionMetric>>["conversion"];
  /** 报价数超过统计上限 —— 转化率只覆盖了前 N 张,页面必须说明 */
  conversionTruncated: boolean;
  /** 毛利:收入取冻结快照,成本取冻结版本原始行(缺成本的报价整张排除并列明) */
  margin: Awaited<ReturnType<typeof grossMarginMetric>>["margin"];
  marginTruncated: boolean;
  opo: Awaited<ReturnType<typeof opoMetric>>;
  aging: Awaited<ReturnType<typeof inventoryMetrics>>["aging"];
  slowMoving: Awaited<ReturnType<typeof inventoryMetrics>>["slowMoving"];
  /** 库存缓存的最新时点;无数据为 null(诚实展示数据新鲜度) */
  inventoryFetchedAt: string | null;
  excess: ExcessMetric;
  shortage: Awaited<ReturnType<typeof shortageMetric>>;
  scrap: ScrapLossMetric;
  quality: QualityMetric;
}

export async function getManagementSnapshot(
  tenantId: string,
  now: string,
): Promise<ManagementSnapshot> {
  const period = now.slice(0, 7);
  const [
    quotesR,
    conversionR,
    marginR,
    opo,
    inventory,
    excess,
    shortage,
    scrap,
    quality,
  ] = await Promise.all([
    quoteStatsMetric(tenantId),
    orderConversionMetric(tenantId),
    grossMarginMetric(tenantId),
    opoMetric(tenantId, now),
    inventoryMetrics(tenantId, now),
    excessMetric(tenantId),
    shortageMetric(tenantId),
    scrapLossMetric(tenantId, period),
    qualityMetric(tenantId, now),
  ]);

  return {
    quotes: quotesR.stats,
    conversion: conversionR.conversion,
    conversionTruncated: conversionR.truncated,
    margin: marginR.margin,
    marginTruncated: marginR.truncated,
    opo,
    aging: inventory.aging,
    slowMoving: inventory.slowMoving,
    inventoryFetchedAt: inventory.inventoryFetchedAt,
    excess,
    shortage,
    scrap,
    quality,
  };
}
