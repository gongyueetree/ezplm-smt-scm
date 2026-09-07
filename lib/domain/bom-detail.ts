/**
 * F7:BOM 详情页的纯函数层。
 *
 * - KPI 口径(spec §1):已匹配 = 有生效人工决定且不是 NO_MATCH;
 *   需人工确认 = 未决 + 有候选 + 最高置信度 **低于租户阈值**;
 *   未识别 = 未决 + 一个候选都没有;NO_MATCH 是「人确认过没有」,单列不混入未识别。
 * - 批量确认资格(spec §2):未决 + 最高候选 ≥ 阈值 + 首选候选来源不是相似度类
 *   (相似度候选"只是像",批量点掉等于让 AI 定案 —— 违反人工确认铁律)。
 * - 阈值来自 TenantSettings.matchConfidenceThreshold,**不硬编码**。
 */
import { z } from "zod";

/** 相似度类来源:永远不进批量确认,不管置信度多高 */
export const SIMILARITY_SOURCES = new Set(["LOCAL_SIMILAR", "EZPLM_SIMILAR", "DESCRIPTION"]);

export interface BomKpiLine {
  id: string;
  /** 生效决定;null = 未决 */
  decision: "ACCEPT_CANDIDATE" | "MANUAL_ASSIGN" | "NO_MATCH" | null;
  /** 候选(按置信度降序;只需要 source + confidence) */
  candidates: { source: string; confidence: number }[];
}

export interface BomDetailKpis {
  totalLines: number;
  matched: number;
  /** 0–1;总数为 0 时为 null(0/0 显示 "—" 而不是 100%) */
  matchRate: number | null;
  needsReview: number;
  unrecognized: number;
  /** 人确认过「无匹配」的行(与未识别分开:一个是查过没有,一个是没人看过) */
  confirmedNoMatch: number;
  /** 可进批量确认的行数(≥阈值 + 非相似度来源 + 未决) */
  batchEligible: number;
  /** 多候选行数(≥2 个候选) */
  multiCandidate: number;
}

export function deriveBomKpis(lines: readonly BomKpiLine[], threshold: number): BomDetailKpis {
  let matched = 0;
  let needsReview = 0;
  let unrecognized = 0;
  let confirmedNoMatch = 0;
  let batchEligible = 0;
  let multiCandidate = 0;

  for (const l of lines) {
    if (l.candidates.length >= 2) multiCandidate += 1;
    if (l.decision === "ACCEPT_CANDIDATE" || l.decision === "MANUAL_ASSIGN") {
      matched += 1;
      continue;
    }
    if (l.decision === "NO_MATCH") {
      confirmedNoMatch += 1;
      continue;
    }
    // 未决
    if (l.candidates.length === 0) {
      unrecognized += 1;
      continue;
    }
    const top = l.candidates[0];
    if (top.confidence >= threshold && !SIMILARITY_SOURCES.has(top.source)) {
      batchEligible += 1;
    } else {
      needsReview += 1;
    }
  }

  return {
    totalLines: lines.length,
    matched,
    matchRate: lines.length === 0 ? null : matched / lines.length,
    needsReview,
    unrecognized,
    confirmedNoMatch,
    batchEligible,
    multiCandidate,
  };
}

/** 批量确认资格判定(服务端复核用同一函数 —— 前端勾选只是意向,资格以服务端为准) */
export function eligibleForBulkConfirm(
  line: BomKpiLine,
  threshold: number,
): { eligible: boolean; reason: string | null } {
  if (line.decision) return { eligible: false, reason: "该行已有人工决定" };
  if (line.candidates.length === 0) return { eligible: false, reason: "无候选" };
  const top = line.candidates[0];
  if (SIMILARITY_SOURCES.has(top.source)) {
    return { eligible: false, reason: "首选候选为相似度来源 —— 只是像,必须逐行人工确认" };
  }
  if (top.confidence < threshold) {
    return { eligible: false, reason: `置信度 ${(top.confidence * 100).toFixed(0)}% 低于阈值` };
  }
  return { eligible: true, reason: null };
}

// ============================================================
// 制造工程信息(T2)的录入校验
// ============================================================

const KvRowSchema = z.object({
  label: z.string().trim().min(1).max(60),
  value: z.string().trim().max(300),
});

const ProcessStepSchema = z.object({
  seq: z.number().int().min(1).max(999),
  process: z.string().trim().min(1).max(80),
  workCenter: z.string().trim().max(80).default(""),
  /** 节拍(秒);未知留空,不填 0 冒充 */
  taktSeconds: z.number().positive().nullable().default(null),
  keyParams: z.string().trim().max(300).default(""),
});

export const ManufacturingInfoSchema = z.object({
  processRoute: z.array(ProcessStepSchema).max(100).default([]),
  panelization: z.array(KvRowSchema).max(50).default([]),
  stencil: z.array(KvRowSchema).max(50).default([]),
  tooling: z.array(KvRowSchema).max(50).default([]),
  note: z.string().trim().max(1000).nullable().default(null),
});
export type ManufacturingInfo = z.infer<typeof ManufacturingInfoSchema>;

export function emptyManufacturingInfo(): ManufacturingInfo {
  return { processRoute: [], panelization: [], stencil: [], tooling: [], note: null };
}

export function isManufacturingInfoEmpty(info: ManufacturingInfo): boolean {
  return (
    info.processRoute.length === 0 &&
    info.panelization.length === 0 &&
    info.stencil.length === 0 &&
    info.tooling.length === 0
  );
}
