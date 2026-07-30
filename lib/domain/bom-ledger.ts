/**
 * BOM 台账指标(客户 docx 对 BOM 管理页的逐条意见)。
 *
 * 客户要的新增卡片:
 * - 停产 EOL 物料占用的 BOM 数量;
 * - 超期未更新 BOM。
 * 以及:风险分级色标、卡片可下钻(点卡片进列表要**自动筛好**,不用二次筛选)。
 *
 * 纪律:
 * - 每个指标同时返回**命中的 BOM id 列表**,下钻直接用它筛 —— 不让 UI 再算一遍口径,
 *   两处各算一次迟早会不一致;
 * - **生命周期未知不算 EOL**:本地库没有这颗料时是"不知道",不是"在产",
 *   也不是"停产";未知数单独暴露,让人知道这个指标覆盖了多少;
 * - 超期天数是**口径**不是魔法数,由调用方传入并在 UI 标注是否经业务确认。
 */

/** 台账一行(由数据层查好后传入,便于纯函数化) */
export interface BomLedgerRow {
  bomId: string;
  name: string;
  customerId: string | null;
  /** 最新版本的更新时间(ISO);无版本时为 null */
  latestVersionAt: string | null;
  lineCount: number;
  /** 命中本地库且生命周期为 EOL 的行数 */
  eolLineCount: number;
  /** 本地库查不到、生命周期未知的行数 */
  unknownLifecycleLineCount: number;
  /** 尚未人工确认匹配的行数 */
  unconfirmedLineCount: number;
  /** 完全没有候选的行数 */
  noCandidateLineCount: number;
}

/** 超期未更新的缺省口径(天);**未经业务确认**,UI 必须标注 */
export const DEFAULT_STALE_DAYS = 90;

export interface BomLedgerKpi {
  totalBoms: number;
  /** 有 EOL 物料的 BOM */
  eolAffected: { count: number; bomIds: string[]; lineCount: number };
  /** 超期未更新的 BOM */
  stale: { count: number; bomIds: string[]; staleDays: number };
  /** 有未人工确认行的 BOM */
  unconfirmed: { count: number; bomIds: string[]; lineCount: number };
  /** 有无候选行的 BOM */
  noCandidate: { count: number; bomIds: string[]; lineCount: number };
  /** 生命周期未知的行数合计 —— 用于说明 EOL 指标的覆盖面 */
  unknownLifecycleLines: number;
  /** 从未产出版本的 BOM(既不算超期也不算新鲜,单列) */
  noVersion: { count: number; bomIds: string[] };
}

const MS_PER_DAY = 86_400_000;

function dayStart(iso: string): number | null {
  const d = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.parse(`${d}T00:00:00.000Z`);
  return Number.isFinite(t) ? t : null;
}

/** 距最新版本已过天数;无版本或日期非法时返回 null(不当作 0 天) */
export function daysSinceUpdate(latestVersionAt: string | null, today: string): number | null {
  if (!latestVersionAt) return null;
  const then = dayStart(latestVersionAt);
  const now = dayStart(today);
  if (then === null || now === null) return null;
  return Math.round((now - then) / MS_PER_DAY);
}

export function deriveBomLedgerKpi(
  rows: readonly BomLedgerRow[],
  options: { today: string; staleDays?: number },
): BomLedgerKpi {
  const staleDays = options.staleDays ?? DEFAULT_STALE_DAYS;

  const eolRows = rows.filter((r) => r.eolLineCount > 0);
  const unconfirmedRows = rows.filter((r) => r.unconfirmedLineCount > 0);
  const noCandidateRows = rows.filter((r) => r.noCandidateLineCount > 0);
  const noVersionRows = rows.filter((r) => r.latestVersionAt === null);
  const staleRows = rows.filter((r) => {
    const d = daysSinceUpdate(r.latestVersionAt, options.today);
    return d !== null && d > staleDays;
  });

  return {
    totalBoms: rows.length,
    eolAffected: {
      count: eolRows.length,
      bomIds: eolRows.map((r) => r.bomId),
      lineCount: eolRows.reduce((a, r) => a + r.eolLineCount, 0),
    },
    stale: { count: staleRows.length, bomIds: staleRows.map((r) => r.bomId), staleDays },
    unconfirmed: {
      count: unconfirmedRows.length,
      bomIds: unconfirmedRows.map((r) => r.bomId),
      lineCount: unconfirmedRows.reduce((a, r) => a + r.unconfirmedLineCount, 0),
    },
    noCandidate: {
      count: noCandidateRows.length,
      bomIds: noCandidateRows.map((r) => r.bomId),
      lineCount: noCandidateRows.reduce((a, r) => a + r.noCandidateLineCount, 0),
    },
    unknownLifecycleLines: rows.reduce((a, r) => a + r.unknownLifecycleLineCount, 0),
    noVersion: { count: noVersionRows.length, bomIds: noVersionRows.map((r) => r.bomId) },
  };
}

export type RiskTone = "danger" | "warn" | "ok";

/**
 * 风险色标(客户:「无风险分级色标:高风险『未识别物料 8、需人工确认 42』纯白底色,
 * 无橙红警示」)。
 *
 * 0 = 正常;有但不多 = 橙;超过阈值 = 红。阈值同样是口径,由调用方给。
 */
export function riskTone(count: number, dangerAt = 1): RiskTone {
  if (count <= 0) return "ok";
  return count >= dangerAt ? "danger" : "warn";
}
