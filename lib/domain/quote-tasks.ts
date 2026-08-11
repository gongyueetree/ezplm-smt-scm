/**
 * 报价责任拆分(PM 派工)与 NRE 填报(纯函数)。
 *
 * 客户 Q6 答复:
 * 「工程填完**直接回报价**(不需审批);**PM 派工**;
 *   NRE 项由客户提供标准清单、**设为可选**、**要有备注项**」。
 *
 * 三个由此定下的决定:
 *
 * 1. **NRE 没有单独的审批环节。** 填完即回到报价上。
 *    再加一道审批是我们自己加的流程,客户没要。
 *
 * 2. **NRE 项目字典可配置,不硬编码。** 客户说标准清单他们提供(C4 尚未给到)。
 *    与其先塞几条我们编的"治具费/钢网费"冒充标准,不如让字典为空并明说
 *    「尚未维护」—— 空字典时仍允许手填名称,业务不至于被卡住。
 *
 * 3. **NRE 金额直接落成 category=NRE 的报价行**,不另开一套金额表。
 *    两套金额迟早对不上,而报价总额只能有一个来源。
 */
import Decimal from "decimal.js";

export type QuoteTaskKind = "MATERIAL" | "NRE" | "LABOR" | "OTHER";
export type QuoteTaskStatus = "PENDING" | "IN_PROGRESS" | "SUBMITTED";

export const TASK_KIND_LABEL: Record<QuoteTaskKind, string> = {
  MATERIAL: "物料成本",
  NRE: "NRE(一次性工程费用)",
  LABOR: "人工/制费",
  OTHER: "其它",
};

export const TASK_STATUS_LABEL: Record<QuoteTaskStatus, string> = {
  PENDING: "待接手",
  IN_PROGRESS: "填报中",
  SUBMITTED: "已回报价",
};

export interface TaskRow {
  status: QuoteTaskStatus;
  required: boolean;
}

export interface TaskSummary {
  total: number;
  submitted: number;
  open: number;
  /** 勾了「必须完成」却还没回的任务数 —— 只有这些会拦提交 */
  blocking: number;
}

export function summarizeTasks(rows: readonly TaskRow[]): TaskSummary {
  const submitted = rows.filter((r) => r.status === "SUBMITTED").length;
  const blocking = rows.filter((r) => r.required && r.status !== "SUBMITTED").length;
  return { total: rows.length, submitted, open: rows.length - submitted, blocking };
}

/**
 * 提交报价审批时的任务检查。
 *
 * **只拦被显式勾成「必须完成」的任务。** 什么算关键项由派工人决定,
 * 系统不替业务发明规则 —— 硬性要求所有任务完成才能提交,
 * 只会逼人建假任务或干脆不用派工功能。
 */
export function checkTasksBeforeSubmit(rows: readonly TaskRow[]):
  | { ok: true; warning: string | null }
  | { ok: false; code: string; message: string } {
  const s = summarizeTasks(rows);
  if (s.blocking > 0) {
    return {
      ok: false,
      code: "required_tasks_open",
      message: `还有 ${s.blocking} 项被标记为「必须完成」的分项任务没有回到报价上 —— 提交前请先催回或取消该标记`,
    };
  }
  return {
    ok: true,
    warning:
      s.open > 0
        ? `另有 ${s.open} 项分项任务尚未回报价(未标记为必须完成,不阻塞提交)`
        : null,
  };
}

export interface NreItemInput {
  /** 引用字典项时给 definitionId;字典没有该项时允许直接手填 name */
  definitionId: string | null;
  name: string;
  /** 金额字符串;**不接受空串当 0** */
  amount: string;
  /** 备注(客户点名要的) */
  note: string | null;
}

export type NreCheck =
  | { ok: true; items: { definitionId: string | null; name: string; amount: string; note: string | null }[] }
  | { ok: false; code: string; message: string };

/**
 * NRE 填报校验。
 *
 * - 名称必填(字典项也要带上名称快照:字典后来改名不该改写历史报价);
 * - 金额必须是有效数字且 ≥ 0。空串**不当 0** —— "还没填"和"不收费"是两回事,
 *   前者填 0 会让客户看到一张写着"治具费 0 元"的报价单;
 * - 允许 0(确实有免收的项目),但必须是人明确填的 0。
 */
export function checkNreItems(items: readonly NreItemInput[]): NreCheck {
  if (items.length === 0) {
    return { ok: false, code: "empty", message: "至少填一项 NRE —— 不收 NRE 的话不必提交本表" };
  }
  const out: { definitionId: string | null; name: string; amount: string; note: string | null }[] = [];
  for (const [i, it] of items.entries()) {
    const name = it.name?.trim();
    if (!name) {
      return { ok: false, code: "name_required", message: `第 ${i + 1} 项没有名称` };
    }
    const raw = (it.amount ?? "").trim();
    if (raw === "") {
      return {
        ok: false,
        code: "amount_required",
        message: `「${name}」没有填金额 —— 留空不会按 0 处理,请填写金额,或删掉这一项`,
      };
    }
    let d: Decimal;
    try {
      d = new Decimal(raw);
    } catch {
      return { ok: false, code: "amount_invalid", message: `「${name}」的金额不是有效数字:${raw}` };
    }
    if (!d.isFinite() || d.isNegative()) {
      return { ok: false, code: "amount_invalid", message: `「${name}」的金额必须是不小于 0 的数字` };
    }
    out.push({ definitionId: it.definitionId, name, amount: d.toFixed(), note: it.note?.trim() || null });
  }
  return { ok: true, items: out };
}

/** NRE 合计(Decimal;调用方保证同币种) */
export function sumNre(items: readonly { amount: string }[]): string {
  return items.reduce((acc, it) => acc.plus(new Decimal(it.amount)), new Decimal(0)).toFixed(2);
}
