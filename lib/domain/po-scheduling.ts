/**
 * 由需求日期反推下单日与采购数量
 * (客户 docx 原话:「MOQ, LEAD TIME 的时间预设好的材料,如何可以根据 request date
 *  直接预设时间和购买数量?」)。
 *
 * 纪律:
 * - Lead Time 未知时**不猜**:返回 null 并说明原因,不拿 0 天当默认(那会给出
 *   "今天下单就来得及"的错误结论);
 * - 数量圆整复用 `calculateRoundedPurchaseQty`(与 GTB 同一套 MOQ/SPQ 规则,
 *   不另写一份);
 * - 现货/期货只给**建议**,最终由人工按钮选定(客户明确要这个按钮)。
 */
import { calculateRoundedPurchaseQty } from "./offers";

/** 与 prisma enum SourcingMode 同词汇(SPOT/FUTURES),不另造一套叫法 */
export type SourcingMode = "SPOT" | "FUTURES";

export const SOURCING_MODE_LABELS: Record<SourcingMode, string> = {
  SPOT: "现货",
  FUTURES: "期货",
};

export interface PoSchedulingInput {
  /** 需求日期(ISO,取日期部分) */
  requestDate: string;
  /** 供应商预设交期天数;null = 未预设 */
  leadTimeDays: number | null;
  demandQty: number;
  moq?: number | null;
  spq?: number | null;
  /** 今天(ISO);由调用方传入,便于单测复现 */
  today: string;
}

export interface PoSchedulingResult {
  /** 建议下单日 = 需求日 − 交期;交期未知时为 null */
  orderByDate: string | null;
  /** 圆整后的采购数量(MOQ 下限 + SPQ 向上圆整) */
  purchaseQty: number;
  /** 距建议下单日还有几天;负数 = 已过期;未知时 null */
  daysUntilOrderBy: number | null;
  /** 建议下单日已过 —— 按预设交期已来不及 */
  overdue: boolean;
  /** 建议模式;交期未知时为 null(不猜) */
  suggestedMode: SourcingMode | null;
  /** 推导过程,逐步可核对 */
  steps: string[];
}

const MS_PER_DAY = 86_400_000;

/** 取 ISO 串的日期部分并转成 UTC 零点的时间戳;非法输入返回 null */
function dayStart(iso: string): number | null {
  const datePart = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const t = Date.parse(`${datePart}T00:00:00.000Z`);
  return Number.isFinite(t) ? t : null;
}

function toIsoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function planPoLine(input: PoSchedulingInput): PoSchedulingResult {
  const steps: string[] = [];

  const purchaseQty = calculateRoundedPurchaseQty(input.demandQty, {
    moq: input.moq,
    spq: input.spq,
  });
  steps.push(
    `采购量 = max(需求 ${input.demandQty}, MOQ ${input.moq ?? 0}) 再按 SPQ ${input.spq ?? 1} 向上圆整 = ${purchaseQty}`,
  );

  const requestTs = dayStart(input.requestDate);
  const todayTs = dayStart(input.today);

  if (input.leadTimeDays === null || !Number.isFinite(input.leadTimeDays)) {
    steps.push("交期未预设 —— 无法反推下单日;请先在供应商预设里补 Lead Time,不做默认假设");
    return {
      orderByDate: null,
      purchaseQty,
      daysUntilOrderBy: null,
      overdue: false,
      suggestedMode: null,
      steps,
    };
  }

  if (requestTs === null || todayTs === null) {
    steps.push("需求日期或当前日期不是合法日期 —— 不反推");
    return {
      orderByDate: null,
      purchaseQty,
      daysUntilOrderBy: null,
      overdue: false,
      suggestedMode: null,
      steps,
    };
  }

  const lt = Math.max(0, Math.trunc(input.leadTimeDays));
  const orderByTs = requestTs - lt * MS_PER_DAY;
  const orderByDate = toIsoDate(orderByTs);
  const daysUntilOrderBy = Math.round((orderByTs - todayTs) / MS_PER_DAY);
  const overdue = daysUntilOrderBy < 0;

  steps.push(
    `建议下单日 = 需求日 ${toIsoDate(requestTs)} − 交期 ${lt} 天 = ${orderByDate}` +
      `(距今 ${daysUntilOrderBy} 天${overdue ? ",已过期" : ""})`,
  );

  // 建议模式:按预设交期已来不及 → 只能找现货;还来得及 → 走期货按交期排
  const suggestedMode: SourcingMode = overdue ? "SPOT" : "FUTURES";
  steps.push(
    overdue
      ? "建议模式:现货 —— 按预设交期已来不及,需现货或加急(仍需人工确认)"
      : "建议模式:期货 —— 按预设交期尚有余量(仍需人工确认)",
  );

  return { orderByDate, purchaseQty, daysUntilOrderBy, overdue, suggestedMode, steps };
}
