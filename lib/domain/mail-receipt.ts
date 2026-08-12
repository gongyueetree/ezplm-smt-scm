/**
 * 邮件发送与**回执语义**(纯函数)。
 *
 * 客户 Q3 选了「**已读回执**」。这里必须先把技术限制写死在代码与文案里:
 *
 * > 已读回执依赖**收件方邮件客户端**配合。Outlook / Gmail 默认会询问用户
 * > 或直接拒绝,拿不到是常态。因此:
 * >
 * >     **「没收到已读回执」不能推断「供应商没看」。**
 *
 * 所以三种状态**必须分开**,而且不允许互相推导:
 *
 * - `READ_RECEIPT_REQUESTED`:我们在邮件头里请求了回执(Disposition-Notification-To);
 * - `READ_RECEIPT_RECEIVED`:确实收到了对方客户端回的回执;
 * - `OPEN_TRACKED`:追踪像素被加载过 —— 只是**弱证据**,图片默认不加载的客户端拿不到,
 *   预览窗格自动加载又会造成"没人看却记成已读"。
 *
 * **禁止 `SENT = READ`。** 采购据此以为催过了、对方看过了,而实际可能根本没打开 ——
 * 这类误判会直接变成交期事故。
 */

export type MessageState = "DRAFT" | "QUEUED" | "SENT" | "DELIVERY_FAILED";

export const STATE_LABEL: Record<MessageState, string> = {
  DRAFT: "草稿 · 未发送",
  QUEUED: "已排队 · 未发送",
  SENT: "已发送",
  DELIVERY_FAILED: "发送失败",
};

/** 状态机:只允许这些流转 */
const TRANSITIONS: Record<MessageState, MessageState[]> = {
  DRAFT: ["QUEUED"],
  QUEUED: ["SENT", "DELIVERY_FAILED"],
  // 发失败后可以重新排队重试;已发送是终态(要改内容就另发一封)
  DELIVERY_FAILED: ["QUEUED"],
  SENT: [],
};

export type TransitionCheck = { ok: true } | { ok: false; message: string };

export function checkMessageTransition(from: MessageState, to: MessageState): TransitionCheck {
  if ((TRANSITIONS[from] ?? []).includes(to)) return { ok: true };
  return {
    ok: false,
    message: `不允许从「${STATE_LABEL[from]}」流转到「${STATE_LABEL[to]}」`,
  };
}

export interface ReadEvidence {
  readReceiptRequested: boolean;
  readReceiptReceivedAt: string | null;
  openTrackedAt: string | null;
  state: MessageState;
}

export type ReadConclusion = "CONFIRMED_READ" | "LIKELY_OPENED" | "UNKNOWN" | "NOT_SENT";

export const READ_CONCLUSION_LABEL: Record<ReadConclusion, string> = {
  CONFIRMED_READ: "对方已回已读回执",
  LIKELY_OPENED: "疑似已打开(追踪像素)",
  UNKNOWN: "是否已读未知",
  NOT_SENT: "尚未发送",
};

/**
 * 由证据推结论。
 *
 * 关键:**没有证据时返回 UNKNOWN,而不是"未读"**。
 * "未读"是一个断言,而我们并不知道 —— 多数情况下对方看了但客户端没回执。
 */
export function concludeRead(e: ReadEvidence): ReadConclusion {
  if (e.state !== "SENT") return "NOT_SENT";
  if (e.readReceiptReceivedAt) return "CONFIRMED_READ";
  if (e.openTrackedAt) return "LIKELY_OPENED";
  return "UNKNOWN";
}

/** 给界面的一句话说明 —— 每种结论都要带上它的局限 */
export function readConclusionNote(c: ReadConclusion): string {
  switch (c) {
    case "CONFIRMED_READ":
      return "对方邮件客户端回了已读回执 —— 这是最强的一档证据。";
    case "LIKELY_OPENED":
      return "邮件里的追踪像素被加载过。**只是弱证据**:预览窗格自动加载也会触发,不等于人真的读了。";
    case "UNKNOWN":
      return "尚未收到已读回执。**这不代表对方没看** —— Outlook / Gmail 默认不回执,拿不到是常态。要确认请电话跟进或让对方在系统里点确认。";
    case "NOT_SENT":
      return "邮件尚未发出。";
  }
}

export interface SmtpConfigInput {
  host: string | undefined;
  port: string | undefined;
  user: string | undefined;
  password: string | undefined;
  from: string | undefined;
  secure: string | undefined;
}

export interface SmtpConfigResult {
  configured: boolean;
  /** 缺哪些参数 —— 逐项列出,不是笼统一句"未配置" */
  missing: string[];
  host: string | null;
  port: number | null;
  secure: boolean;
  from: string | null;
  user: string | null;
}

/**
 * 解析 SMTP 配置。
 *
 * **密码只判断有没有,永远不回传、不打印。**
 * 缺参数时逐项列出,让运维知道该补哪一个,而不是对着"未配置"三个字发呆。
 */
export function resolveSmtpConfig(input: SmtpConfigInput): SmtpConfigResult {
  const missing: string[] = [];
  const host = input.host?.trim() || null;
  const from = input.from?.trim() || null;
  const user = input.user?.trim() || null;
  if (!host) missing.push("SMTP_HOST");
  if (!input.port?.trim()) missing.push("SMTP_PORT");
  if (!user) missing.push("SMTP_USER");
  if (!input.password) missing.push("SMTP_PASSWORD");
  if (!from) missing.push("SMTP_FROM");

  const portNum = Number(input.port);
  const port = Number.isFinite(portNum) && portNum > 0 ? Math.floor(portNum) : null;
  if (input.port?.trim() && port === null) missing.push("SMTP_PORT(不是有效端口)");

  return {
    configured: missing.length === 0,
    missing,
    host,
    port,
    // 465 默认隐式 TLS;其余按显式配置
    secure: input.secure === undefined || input.secure.trim() === "" ? port === 465 : input.secure.trim() === "true",
    from,
    user,
  };
}
