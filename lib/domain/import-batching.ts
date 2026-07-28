/**
 * 大 BOM 分批(SPEC §15 / CLAUDE.md)。
 * 规则:唯一 MPN > 50 时必须走 ImportJob,分批每次处理 10–20 个;
 * 禁止在单个同步请求中处理整张大 BOM。
 */

/** 超过此唯一 MPN 数必须走 ImportJob */
export const IMPORT_JOB_THRESHOLD = 50;
/** SPEC 规定的分批区间 */
export const MIN_BATCH_SIZE = 10;
export const MAX_BATCH_SIZE = 20;
export const DEFAULT_BATCH_SIZE = 20;

export function shouldUseImportJob(uniqueMpnCount: number): boolean {
  return uniqueMpnCount > IMPORT_JOB_THRESHOLD;
}

/** 批大小夹到 [10, 20];非法输入回落到默认值 */
export function normalizeBatchSize(size?: number | null): number {
  if (!size || !Number.isFinite(size)) return DEFAULT_BATCH_SIZE;
  return Math.min(MAX_BATCH_SIZE, Math.max(MIN_BATCH_SIZE, Math.trunc(size)));
}

/** 切分为批次;空输入返回空数组(不产生空批) */
export function splitIntoBatches<T>(items: readonly T[], batchSize?: number): T[][] {
  const size = normalizeBatchSize(batchSize);
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

export interface JobProgress {
  total: number;
  processed: number;
  /** 0–100,保留 1 位小数 */
  percent: number;
  done: boolean;
  remaining: number;
}

export function computeProgress(total: number, processed: number): JobProgress {
  const safeTotal = Math.max(0, total);
  const safeProcessed = Math.min(Math.max(0, processed), safeTotal);
  const percent = safeTotal === 0 ? 100 : Number(((safeProcessed / safeTotal) * 100).toFixed(1));
  return {
    total: safeTotal,
    processed: safeProcessed,
    percent,
    done: safeProcessed >= safeTotal,
    remaining: safeTotal - safeProcessed,
  };
}

/** 下一批的切片区间(拉取式处理:每次轮询/SSE tick 处理一批) */
export function nextBatchSlice(
  total: number,
  processed: number,
  batchSize?: number,
): { start: number; end: number } | null {
  if (processed >= total) return null;
  const size = normalizeBatchSize(batchSize);
  return { start: processed, end: Math.min(total, processed + size) };
}
