/**
 * F3:供应商免登录确认(纯函数)。设计见 docs/design/F3-CHECKPOINT-A.md。
 *
 * 铁律:
 * - 原始 token 只在生成那一刻存在,库里只有 SHA-256;
 * - 状态三层互不推导:邮件发没发(OutboundMessage)≠ 读没读(回执)≠ 确认没确认(本表);
 * - 单次响应:资格判定纯函数 + 落库时条件更新双保险。
 */
import { createHash, randomBytes } from "crypto";
import { z } from "zod";

/** 生成一对:raw 进 URL(仅此一次),hash 进库 */
export function generateActionToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashActionToken(raw) };
}

export function hashActionToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** 审计里只允许出现的 token 痕迹 */
export function tokenAuditRef(hash: string): string {
  return hash.slice(0, 8);
}

export const EXPIRY_DAYS_DEFAULT = 14;
export const EXPIRY_DAYS_MIN = 1;
export const EXPIRY_DAYS_MAX = 60;

export function expiryFromDays(days: number, now = new Date()): Date {
  const d = Math.min(EXPIRY_DAYS_MAX, Math.max(EXPIRY_DAYS_MIN, Math.floor(days)));
  return new Date(now.getTime() + d * 24 * 3600 * 1000);
}

export type ActionStatus = "PENDING" | "RESPONDED" | "EXPIRED" | "REVOKED";

/**
 * 访问判定:404/410/409 的语义在这里定死(路由只翻译成 HTTP 码)。
 * - 未知/已撤销 → not_found(**不可区分**,防枚举);
 * - 过期 → expired(410);
 * - 已响应 → already_responded(409,页面不再展示业务数据);
 * - PENDING 且未过期 → ok。
 */
export function classifyAccess(
  req: { status: ActionStatus; expiresAt: Date } | null,
  now = new Date(),
): "ok" | "not_found" | "expired" | "already_responded" {
  if (!req || req.status === "REVOKED") return "not_found";
  if (req.status === "RESPONDED") return "already_responded";
  if (req.expiresAt < now) return "expired";
  return "ok";
}

/** 邮件状态与确认状态**不可互推**(单测锁定):任何邮件状态都不改变响应资格 */
export function canRespond(access: ReturnType<typeof classifyAccess>): boolean {
  return access === "ok";
}

// ---- 响应体(公开接口输入,最小字段) ----

export const PoConfirmResponseSchema = z.object({
  decision: z.enum(["CONFIRM", "CONFIRM_WITH_CHANGES", "CANNOT_ACCEPT"]),
  respondedByName: z.string().trim().min(1).max(80),
  respondedByEmail: z.string().trim().email().max(160),
  supplierNote: z.string().trim().max(1000).nullable().default(null),
  /** CONFIRM_WITH_CHANGES 时逐行给出;CONFIRM/CANNOT_ACCEPT 可空 */
  lines: z
    .array(
      z.object({
        lineNo: z.number().int().min(1),
        confirmedQty: z.string().regex(/^\d+(\.\d+)?$/).nullable().default(null),
        confirmedEta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
      }),
    )
    .max(500)
    .default([]),
});
export type PoConfirmResponse = z.infer<typeof PoConfirmResponseSchema>;

/** CONFIRM_WITH_CHANGES 必须至少有一行真的改了 —— 否则应该点「确认」 */
export function validatePoConfirm(input: PoConfirmResponse): string | null {
  if (input.decision === "CONFIRM_WITH_CHANGES") {
    const changed = input.lines.some((l) => l.confirmedQty !== null || l.confirmedEta !== null);
    if (!changed) return "选择「有变更地确认」时必须至少填写一行变更(数量或交期)";
  }
  return null;
}

/** PoAcknowledgement.decision 映射 */
export function toAckDecision(d: PoConfirmResponse["decision"]): "ACCEPTED" | "PARTIAL" | "REJECTED" {
  switch (d) {
    case "CONFIRM":
      return "ACCEPTED";
    case "CONFIRM_WITH_CHANGES":
      return "PARTIAL";
    case "CANNOT_ACCEPT":
      return "REJECTED";
  }
}

export const OpoEtaResponseSchema = z.object({
  respondedByName: z.string().trim().min(1).max(80),
  respondedByEmail: z.string().trim().email().max(160),
  lines: z
    .array(
      z.object({
        opoLineId: z.string().min(1),
        replyEta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
        replyQty: z.string().regex(/^\d+(\.\d+)?$/).nullable().default(null),
        replyNote: z.string().trim().max(500).nullable().default(null),
      }),
    )
    .min(1)
    .max(500),
});
export type OpoEtaResponse = z.infer<typeof OpoEtaResponseSchema>;

/** 每行至少有一项实质内容(全空行 = 没回复) */
export function validateOpoEta(input: OpoEtaResponse): string | null {
  const empty = input.lines.filter((l) => !l.replyEta && !l.replyQty && !l.replyNote);
  if (empty.length === input.lines.length) return "至少回复一行交期/数量/说明";
  return null;
}

// ---- R3-4:CALL_MATERIAL / RFQ_QUOTE 响应体 ----

export const CallMaterialResponseSchema = z.object({
  respondedByName: z.string().trim().min(1).max(80),
  respondedByEmail: z.string().trim().email().max(160),
  /** 能否供应:必选,不给默认 —— 沉默不是表态 */
  canSupply: z.boolean(),
  replyQty: z.string().regex(/^\d+(\.\d+)?$/).nullable().default(null),
  replyEta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  replyNote: z.string().trim().max(500).nullable().default(null),
});
export type CallMaterialResponse = z.infer<typeof CallMaterialResponseSchema>;

/** 能供 → 数量必填(光说"能供"不给量,采购没法排产);不能供 → 数量/交期无意义,说明可选 */
export function validateCallMaterial(input: CallMaterialResponse): string | null {
  if (input.canSupply && !input.replyQty) return "选择「可以供应」时必须填写可供数量";
  if (input.canSupply && input.replyQty && Number(input.replyQty) <= 0) return "可供数量必须大于 0";
  return null;
}

export const RfqQuoteLineSchema = z.object({
  mpn: z.string().trim().min(1).max(120),
  unitPrice: z.string().regex(/^\d+(\.\d+)?$/),
  moq: z.string().regex(/^\d+(\.\d+)?$/).nullable().default(null),
  spq: z.string().regex(/^\d+(\.\d+)?$/).nullable().default(null),
  leadTimeDays: z.number().int().min(0).max(3650).nullable().default(null),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  note: z.string().trim().max(500).nullable().default(null),
});

export const RfqQuoteResponseSchema = z.object({
  respondedByName: z.string().trim().min(1).max(80),
  respondedByEmail: z.string().trim().email().max(160),
  /** 一次报价一个币种(与 SupplierQuote 同口径);跨币种分次报 */
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  lines: z.array(RfqQuoteLineSchema).min(1).max(200),
});
export type RfqQuoteResponse = z.infer<typeof RfqQuoteResponseSchema>;

/** 单价必须为正;同一 MPN 不允许重复行(重复=输入错误,不猜哪行算数) */
export function validateRfqQuote(input: RfqQuoteResponse): string | null {
  const bad = input.lines.find((l) => Number(l.unitPrice) <= 0);
  if (bad) return `型号 ${bad.mpn} 的单价必须大于 0`;
  const seen = new Set<string>();
  for (const l of input.lines) {
    const key = l.mpn.toUpperCase();
    if (seen.has(key)) return `型号 ${l.mpn} 出现重复报价行,请合并后提交`;
    seen.add(key);
  }
  return null;
}

/** 公开链接拼装:APP_PUBLIC_URL 缺失时返回相对路径 + 告警位 */
export function buildConfirmUrl(rawToken: string, publicUrl: string | undefined, basePath = ""): {
  url: string;
  absolute: boolean;
} {
  const path = `${basePath}/confirm/${rawToken}`;
  const base = publicUrl?.trim().replace(/\/+$/, "");
  if (!base) return { url: path, absolute: false };
  return { url: `${base}${path}`, absolute: true };
}
