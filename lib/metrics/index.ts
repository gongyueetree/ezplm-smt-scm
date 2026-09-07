/**
 * F1:KPI **唯一查询层**(KICKOFF 修订 4)。
 *
 * 规矩:任何看板/工作台要显示聚合数字,一律从这里取 ——
 * 管理看板、F6 品质看板、F2 ECN KPI、F7 BOM 详情 KPI 共用同一来源,
 * 「两个页面同一指标数字不一样」这类事故从结构上杜绝。
 * 汇总算法在 lib/domain(纯函数可单测),本层只带 tenant scope 取数。
 */
export { quoteStatsMetric, orderConversionMetric, grossMarginMetric } from "./quotes";
export { inventoryMetrics } from "./inventory";
export { opoMetric } from "./opo";
export { excessMetric, type ExcessMetric } from "./excess";
export { shortageMetric } from "./shortage";
export { scrapLossMetric, type ScrapLossMetric } from "./scrap";
export { qualityMetric, type QualityMetric } from "./quality";
export * from "./bom-detail";
