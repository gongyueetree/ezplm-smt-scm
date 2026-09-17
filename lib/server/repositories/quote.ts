/**
 * 报价数据访问(SPEC §12 + CLAUDE.md 报价六条规则)。
 *
 * 落库层只做三件事:取数、按领域函数的判定落库、写 AuditLog。
 * 任何"能不能改 / 能不能提交 / 能不能覆盖"的判断都在 lib/domain/quote-status.ts,
 * 本层不得另起一套判断(否则规则会在两处漂移)。
 */
import { ApprovalDecision, Prisma } from "@prisma/client";
import { hasUsableCost } from "@/lib/domain/price-guard";
import { buildQuoteLinePatch, type QuoteLinePatchInput } from "@/lib/domain/quote-line-patch";
import {
  BUILTIN_LABOR_TEMPLATES,
  summarizeQuote,
  type LaborRateTemplate,
  type QuoteLineForCalc,
} from "@/lib/domain/quote-calc";
import {
  buildQuoteSnapshot,
  type QuoteDocHeader,
  type QuoteDocLine,
  checkParameterMutation,
  checkQuoteTransition,
  checkRevisionWrite,
  planNextRevision,
  resolveExportSource,
  type MutationKind,
  type QuoteSnapshot,
  type QuoteStatusValue,
} from "@/lib/domain/quote-status";
import { checkTasksBeforeSubmit, type TaskRow } from "@/lib/domain/quote-tasks";
import { buildCostEvidenceForQuoteLines } from "@/lib/server/repositories/cost-matrix";
import { getTenantSettings } from "@/lib/server/tenant-settings";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { pickQuoteTemplate } from "@/lib/domain/quote-template";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";
import type { SessionRef } from "./rfq";

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

async function nextQuoteCode(tenantId: string, now: Date): Promise<string> {
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const prefix = `Q-${stamp}-`;
  const last = await prisma.quote.findFirst({
    where: tenantWhere(tenantId, { code: { startsWith: prefix } }),
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const seq = last ? Number(last.code.slice(prefix.length)) : 0;
  return `${prefix}${String((Number.isFinite(seq) ? seq : 0) + 1).padStart(3, "0")}`;
}

export interface CreateQuoteInput {
  rfqId: string;
  customerId: string;
  currency?: string;
  laborTemplateId?: string;
}

/** 新建报价:Quote + Revision 1(DRAFT) */
export async function createQuote(session: SessionRef, input: CreateQuoteInput) {
  // 按客户等级挑报价模板(客户 xlsx:A/B/C 差异化报价规则)。
  // 模板只提供**默认值**:选中的人工费率模板会带入,默认 Markup 由 UI 展示给人确认,
  // 系统**不替人把 Markup 写进报价行** —— 金额一律由确定性函数按人工确认的参数算。
  const customer = await prisma.customer.findFirst({
    where: tenantWhere(session.tenantId, { id: input.customerId }),
    select: { tier: true },
  });
  const templates = await prisma.quoteTemplate.findMany({
    where: tenantWhere(session.tenantId),
    select: {
      id: true,
      name: true,
      tier: true,
      defaultMarkupPct: true,
      laborTemplateId: true,
      confirmedByBusiness: true,
    },
  });
  const pick = pickQuoteTemplate(
    templates.map((t) => ({
      id: t.id,
      name: t.name,
      tier: t.tier,
      defaultMarkupPct: t.defaultMarkupPct?.toString() ?? null,
      laborTemplateId: t.laborTemplateId,
      confirmedByBusiness: t.confirmedByBusiness,
    })),
    customer?.tier ?? null,
  );

  const template =
    BUILTIN_LABOR_TEMPLATES.find(
      (t) => t.id === (input.laborTemplateId ?? pick.template?.laborTemplateId),
    ) ?? BUILTIN_LABOR_TEMPLATES[0];

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const code = await nextQuoteCode(session.tenantId, new Date());
      return await prisma.$transaction(async (tx) => {
        const quote = await tx.quote.create({
          data: tenantData(session.tenantId, {
            code,
            rfqId: input.rfqId,
            customerId: input.customerId,
            createdById: session.userId,
          }),
        });
        const version = await tx.quoteVersion.create({
          data: tenantData(session.tenantId, {
            quoteId: quote.id,
            revision: 1,
            status: "DRAFT",
            currency: input.currency ?? "CNY",
            laborRateTemplate: template as unknown as Prisma.InputJsonValue,
            createdById: session.userId,
          }),
        });
        await writeAudit(tx, {
          tenantId: session.tenantId,
          userId: session.userId,
          action: "QUOTE_CREATE",
          entityType: "QuoteVersion",
          entityId: version.id,
          after: { code, revision: 1, status: "DRAFT" },
        });
        return { quote, version };
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new Error("报价编号生成失败(并发冲突重试耗尽)");
}

export async function getQuoteVersion(session: SessionRef, versionId: string) {
  return prisma.quoteVersion.findFirst({
    where: tenantWhere(session.tenantId, { id: versionId }),
    include: {
      quote: true,
      lines: { orderBy: { lineNo: "asc" } },
      approvals: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function listQuotes(session: SessionRef) {
  return prisma.quote.findMany({
    where: tenantWhere(session.tenantId),
    orderBy: { createdAt: "desc" },
    include: { versions: { orderBy: { revision: "desc" } } },
  });
}

/** 把落库行转为计算输入 */
function toCalcLines(
  lines: { lineNo: number; category: string; qty: unknown; purchaseCost: unknown; markupPct: unknown; customerPrice: unknown }[],
): QuoteLineForCalc[] {
  return lines.map((l) => ({
    lineNo: l.lineNo,
    category: l.category as QuoteLineForCalc["category"],
    qty: l.qty === null ? null : String(l.qty),
    purchaseCost: l.purchaseCost === null ? null : String(l.purchaseCost),
    markupPct: l.markupPct === null ? null : String(l.markupPct),
    customerPrice: l.customerPrice === null ? null : String(l.customerPrice),
  }));
}

/** 实时汇总(草稿态展示用;正式导出一律走快照) */
export async function summarizeVersion(session: SessionRef, versionId: string) {
  const version = await getQuoteVersion(session, versionId);
  if (!version) return null;
  return summarizeQuote(toCalcLines(version.lines), { currency: version.currency });
}

export interface UpsertLineInput {
  lineNo: number;
  category: string;
  qty?: string | null;
  purchaseCost?: string | null;
  markupPct?: string | null;
  customerPrice?: string | null;
  quotedMfg?: string | null;
  quotedMpn?: string | null;
  materialCategory?: string | null;
  altMfg?: string | null;
  altMpn?: string | null;
  note?: string | null;
}

export type MutationOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; code: "not_found" | "frozen"; message: string };

/** 写入报价行 —— 先过冻结守卫(规则 4) */
export async function upsertQuoteLine(
  session: SessionRef,
  versionId: string,
  input: UpsertLineInput,
  kind: MutationKind = "edit_line",
): Promise<MutationOutcome<{ id: string }>> {
  const version = await prisma.quoteVersion.findFirst({
    where: tenantWhere(session.tenantId, { id: versionId }),
    select: { id: true, status: true },
  });
  if (!version) return { ok: false, code: "not_found", message: "报价版本不存在或不属于当前租户" };

  const guard = checkParameterMutation(version.status as QuoteStatusValue, kind);
  if (!guard.ok) return { ok: false, code: "frozen", message: guard.message! };

  const existing = await prisma.quoteLine.findFirst({
    where: tenantWhere(session.tenantId, { quoteVersionId: versionId, lineNo: input.lineNo }),
    select: { id: true },
  });

  const data = {
    category: input.category as never,
    qty: input.qty ?? null,
    purchaseCost: input.purchaseCost ?? null,
    markupPct: input.markupPct ?? null,
    customerPrice: input.customerPrice ?? null,
    quotedMfg: input.quotedMfg ?? null,
    quotedMpn: input.quotedMpn ?? null,
    materialCategory: input.materialCategory ?? null,
    altMfg: input.altMfg ?? null,
    altMpn: input.altMpn ?? null,
    note: input.note ?? null,
  };

  const id = await prisma.$transaction(async (tx) => {
    let lineId: string;
    if (existing) {
      await tx.quoteLine.updateMany({
        where: tenantWhere(session.tenantId, { id: existing.id }),
        data,
      });
      lineId = existing.id;
    } else {
      const created = await tx.quoteLine.create({
        data: tenantData(session.tenantId, {
          quoteVersionId: versionId,
          lineNo: input.lineNo,
          ...data,
        }),
      });
      lineId = created.id;
    }
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: existing ? "QUOTE_LINE_UPDATE" : "QUOTE_LINE_CREATE",
      entityType: "QuoteLine",
      entityId: lineId,
      after: { versionId, lineNo: input.lineNo, ...data },
    });
    return lineId;
  });

  return { ok: true, data: { id } };
}

export interface QuoteLinePatchRequest {
  lineNo: number;
  patch: QuoteLinePatchInput;
}

/**
 * R0-4:在**调用方的事务内**按字段级 patch 更新报价行 —— 只改显式给出的字段。
 *
 * 与 `upsertQuoteLine` 的区别见 lib/domain/quote-line-patch.ts:
 * 整行保存仍走 upsert(未给的字段就是要清空);只改几个参数的场景走这里。
 * 本函数**不创建行** —— 创建是 upsert 的语义;找不到行按 missing 返回,由调用方决定怎么报。
 *
 * 冻结守卫照旧:PENDING/APPROVED 下参数全冻结(CLAUDE.md 报价规则 4)。
 */
export async function patchQuoteLinesInTx(
  tx: Prisma.TransactionClient,
  session: SessionRef,
  versionId: string,
  requests: QuoteLinePatchRequest[],
  kind: MutationKind = "edit_line",
): Promise<{ applied: number; missing: number[]; skipped: number[] }> {
  const version = await tx.quoteVersion.findFirst({
    where: tenantWhere(session.tenantId, { id: versionId }),
    select: { id: true, status: true },
  });
  if (!version) throw new Error("报价版本不存在或不属于当前租户");

  const guard = checkParameterMutation(version.status as QuoteStatusValue, kind);
  if (!guard.ok) throw new Error(guard.message!);

  let applied = 0;
  const missing: number[] = [];
  const skipped: number[] = [];

  for (const req of requests) {
    const data = buildQuoteLinePatch(req.patch);
    // 空 patch 不写库 —— 写一行"什么都没改"的 update 只会污染审计
    if (Object.keys(data).length === 0) {
      skipped.push(req.lineNo);
      continue;
    }
    const existing = await tx.quoteLine.findFirst({
      where: tenantWhere(session.tenantId, { quoteVersionId: versionId, lineNo: req.lineNo }),
      select: { id: true },
    });
    if (!existing) {
      missing.push(req.lineNo);
      continue;
    }
    await tx.quoteLine.updateMany({
      where: tenantWhere(session.tenantId, { id: existing.id }),
      data: data as Prisma.QuoteLineUpdateManyMutationInput,
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "QUOTE_LINE_PATCH",
      entityType: "QuoteLine",
      entityId: existing.id,
      // 审计记录**改了哪几个字段**,而不是整行 —— 否则看不出这次到底动了什么
      after: { versionId, lineNo: req.lineNo, changedFields: Object.keys(data), ...data },
    });
    applied += 1;
  }
  return { applied, missing, skipped };
}

/**
 * 人工确认物料分类(规则 2 的前提)。
 * 单独成一个动作:AI 填的分类不会自动变成"已确认"。
 */
export async function confirmLineCategory(
  session: SessionRef,
  lineId: string,
  materialCategory: string,
): Promise<MutationOutcome<{ id: string }>> {
  const line = await prisma.quoteLine.findFirst({
    where: tenantWhere(session.tenantId, { id: lineId }),
    include: { quoteVersion: { select: { status: true } } },
  });
  if (!line) return { ok: false, code: "not_found", message: "报价行不存在或不属于当前租户" };

  const guard = checkParameterMutation(line.quoteVersion.status as QuoteStatusValue, "edit_line");
  if (!guard.ok) return { ok: false, code: "frozen", message: guard.message! };

  await prisma.$transaction(async (tx) => {
    await tx.quoteLine.updateMany({
      where: tenantWhere(session.tenantId, { id: lineId }),
      data: {
        materialCategory,
        categoryConfirmed: true,
        categoryConfirmedById: session.userId,
        categoryConfirmedAt: new Date(),
      },
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "QUOTE_LINE_CATEGORY_CONFIRM",
      entityType: "QuoteLine",
      entityId: lineId,
      before: { materialCategory: line.materialCategory, categoryConfirmed: line.categoryConfirmed },
      after: { materialCategory, categoryConfirmed: true },
    });
  });
  return { ok: true, data: { id: lineId } };
}


/**
 * 正式报价单表头与明细描述字段 —— 随快照一起冻结。
 *
 * 为什么要冻结:正式文件只用快照(SPEC §12)。若渲染时才去查客户名与有效期,
 * 提交后改了客户名,已批准的报价单也会跟着变,那就不叫冻结了。
 */
async function buildDocFields(
  tenantId: string,
  version: NonNullable<Awaited<ReturnType<typeof getQuoteVersion>>>,
): Promise<{ doc: QuoteDocHeader; docLines: QuoteDocLine[] }> {
  const customer = await prisma.customer.findFirst({
    where: tenantWhere(tenantId, { id: version.quote.customerId }),
    select: { name: true, code: true },
  });
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId },
    select: { name: true },
  });
  return {
    doc: {
      customerName: customer?.name ?? null,
      customerCode: customer?.code ?? null,
      validUntil: version.validUntil ? version.validUntil.toISOString().slice(0, 10) : null,
      sellerName: tenant?.name ?? "本公司",
    },
    docLines: version.lines.map((l) => ({
      lineNo: l.lineNo,
      quotedMfg: l.quotedMfg ?? null,
      quotedMpn: l.quotedMpn ?? null,
      materialCategory: l.materialCategory ?? null,
      altMfg: l.altMfg ?? null,
      altMpn: l.altMpn ?? null,
      note: l.note ?? null,
    })),
  };
}

export type TransitionOutcome =
  | { ok: true; status: QuoteStatusValue }
  | { ok: false; code: string; message: string; unconfirmedLines?: number[] };

/**
 * 提交审批(规则 2 + 3):
 * 领域函数判定可否提交 → 汇总重算 → **冻结 submittedSnapshot** → 落状态。
 * 快照用重算结果,不用前端传来的数字。
 */
export async function submitQuoteForApproval(
  session: SessionRef,
  versionId: string,
): Promise<TransitionOutcome> {
  const version = await getQuoteVersion(session, versionId);
  if (!version) return { ok: false, code: "not_found", message: "报价版本不存在或不属于当前租户" };

  const check = checkQuoteTransition({
    from: version.status as QuoteStatusValue,
    to: "PENDING_APPROVAL",
    roles: session.roles,
    lines: version.lines.map((l) => ({
      lineNo: l.lineNo,
      categoryConfirmed: l.categoryConfirmed,
    })),
  });
  if (!check.ok) {
    return {
      ok: false,
      code: check.code,
      message: check.message,
      unconfirmedLines: check.code === "categories_unconfirmed" ? check.unconfirmedLines : undefined,
    };
  }

  /*
   * PR-D:被 PM 勾成「必须完成」的分项任务没回来之前不许提交。
   * 只拦勾了的 —— 什么算关键项由派工人决定,系统不替业务发明规则。
   */
  const tasks = await prisma.quoteComponentTask.findMany({
    where: tenantWhere(session.tenantId, { quoteVersionId: versionId }),
    select: { status: true, required: true },
  });
  const taskCheck = checkTasksBeforeSubmit(
    tasks.map((t) => ({ status: t.status as TaskRow["status"], required: t.required })),
  );
  if (!taskCheck.ok) {
    return { ok: false, code: taskCheck.code, message: taskCheck.message };
  }

  /*
   * R4-8(§30v1/§46):Cost Completeness Gate + 成本证据冻结。
   * 关联 BOM 的行必须有人工成本选择;缺失时按租户配置拦下(默认拦)。
   */
  const bomLineIds = version.lines
    .map((l) => l.bomLineId)
    .filter((v): v is string => !!v);
  let costEvidence: unknown = null;
  if (bomLineIds.length > 0) {
    // 成本证据的两条合法来源:R4-8 成本矩阵选择,或既有采购比价选择已把
    // purchaseCost 写进报价行(quote-from-bom 旧链路)。二者皆无才算缺失。
    const selectedRows = await prisma.bomCostSelection.findMany({
      where: tenantWhere(session.tenantId, { bomLineId: { in: bomLineIds } }),
      select: { bomLineId: true },
    });
    const covered = new Set(selectedRows.map((r) => r.bomLineId));
    for (const l of version.lines) {
      // R0-8:存进库的 0.000000 不算「已有成本证据」 —— 否则缺成本的行
      // 会静默通过提交门禁,而快照里是一行 0 元成本。
      if (l.bomLineId && hasUsableCost(l.purchaseCost)) covered.add(l.bomLineId);
    }
    const missing = bomLineIds.filter((id) => !covered.has(id)).length;
    const selections = covered.size;
    const { settings } = await getTenantSettings(session.tenantId);
    if (missing > 0 && !settings.quoteAllowMissingCost) {
      return {
        ok: false,
        code: "missing_cost",
        message: `成本覆盖 ${selections}/${bomLineIds.length},缺 ${missing} 行成本选择 —— 补齐成本矩阵后再提交(租户可配 quoteAllowMissingCost 放行)`,
      };
    }
    costEvidence = await buildCostEvidenceForQuoteLines(session.tenantId, bomLineIds);
  }

  const summary = summarizeQuote(toCalcLines(version.lines), { currency: version.currency });
  const { doc, docLines } = await buildDocFields(session.tenantId, version);
  const snapshot = buildQuoteSnapshot({
    doc,
    docLines,
    quoteCode: version.quote.code,
    revision: version.revision,
    status: "PENDING_APPROVAL",
    currency: version.currency,
    summary,
    laborTemplate: version.laborRateTemplate,
    frozenById: session.userId,
    frozenAt: new Date().toISOString(),
  });

  await prisma.$transaction(async (tx) => {
    await tx.quoteVersion.updateMany({
      where: tenantWhere(session.tenantId, { id: versionId }),
      data: {
        status: "PENDING_APPROVAL",
        submittedSnapshot: {
          ...(snapshot as object),
          // §46:提交时冻结的采购成本证据(候选/阶梯/Low-High/选中/依据)
          costEvidence,
        } as unknown as Prisma.InputJsonValue,
        submittedAt: new Date(),
      },
    });
    await tx.quoteApproval.create({
      data: tenantData(session.tenantId, {
        quoteVersionId: versionId,
        approverId: session.userId,
        decision: "PENDING",
      }),
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "QUOTE_SUBMIT",
      entityType: "QuoteVersion",
      entityId: versionId,
      before: { status: version.status },
      after: { status: "PENDING_APPROVAL", grandTotal: summary.grandTotal },
    });
  });

  return { ok: true, status: "PENDING_APPROVAL" };
}

/**
 * 审批决定(规则 3 + 6):
 * 通过 → 冻结 approvedSnapshot;退回 → 记原因(改动走新 Revision,本版本不再可改)。
 */
export async function decideQuoteApproval(
  session: SessionRef,
  versionId: string,
  decision: "APPROVED" | "REJECTED",
  comment: string | null,
): Promise<TransitionOutcome> {
  const version = await getQuoteVersion(session, versionId);
  if (!version) return { ok: false, code: "not_found", message: "报价版本不存在或不属于当前租户" };

  const check = checkQuoteTransition({
    from: version.status as QuoteStatusValue,
    to: decision,
    roles: session.roles,
    reason: comment,
  });
  if (!check.ok) return { ok: false, code: check.code, message: check.message };

  const summary = summarizeQuote(toCalcLines(version.lines), { currency: version.currency });
  const docFields =
    decision === "APPROVED" ? await buildDocFields(session.tenantId, version) : null;
  const approvedSnapshot =
    decision === "APPROVED"
      ? buildQuoteSnapshot({
          doc: docFields!.doc,
          docLines: docFields!.docLines,
          quoteCode: version.quote.code,
          revision: version.revision,
          status: "APPROVED",
          currency: version.currency,
          summary,
          laborTemplate: version.laborRateTemplate,
          frozenById: session.userId,
          frozenAt: new Date().toISOString(),
        })
      : null;

  await prisma.$transaction(async (tx) => {
    await tx.quoteVersion.updateMany({
      where: tenantWhere(session.tenantId, { id: versionId }),
      data: {
        status: decision,
        ...(approvedSnapshot
          ? {
              approvedSnapshot: approvedSnapshot as unknown as Prisma.InputJsonValue,
              approvedAt: new Date(),
            }
          : { rejectedReason: comment }),
      },
    });
    const pending = await tx.quoteApproval.findFirst({
      where: tenantWhere(session.tenantId, { quoteVersionId: versionId, decision: ApprovalDecision.PENDING }),
      select: { id: true },
    });
    if (pending) {
      await tx.quoteApproval.updateMany({
        where: tenantWhere(session.tenantId, { id: pending.id }),
        data: { decision, comment, approverId: session.userId, decidedAt: new Date() },
      });
    }
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: decision === "APPROVED" ? "QUOTE_APPROVE" : "QUOTE_REJECT",
      entityType: "QuoteVersion",
      entityId: versionId,
      before: { status: version.status },
      after: { status: decision, comment, grandTotal: summary.grandTotal },
    });
  });

  return { ok: true, status: decision };
}

/**
 * 新建修订版(规则 6):复制源版本的行到 **最大修订号 + 1**,
 * 经 checkRevisionWrite 确认不会覆盖任何既有版本(尤其已批准版本)。
 */
export async function createRevision(
  session: SessionRef,
  sourceVersionId: string,
): Promise<MutationOutcome<{ versionId: string; revision: number }>> {
  const source = await getQuoteVersion(session, sourceVersionId);
  if (!source) return { ok: false, code: "not_found", message: "报价版本不存在或不属于当前租户" };

  const siblings = await prisma.quoteVersion.findMany({
    where: tenantWhere(session.tenantId, { quoteId: source.quoteId }),
    select: { revision: true, status: true },
  });
  const refs = siblings.map((s) => ({ revision: s.revision, status: s.status as QuoteStatusValue }));
  const { nextRevision } = planNextRevision(refs);

  const writeCheck = checkRevisionWrite(nextRevision, refs);
  if (!writeCheck.ok) return { ok: false, code: "frozen", message: writeCheck.message! };

  const created = await prisma.$transaction(async (tx) => {
    const version = await tx.quoteVersion.create({
      data: tenantData(session.tenantId, {
        quoteId: source.quoteId,
        revision: nextRevision,
        status: "DRAFT",
        currency: source.currency,
        laborRateTemplate: source.laborRateTemplate ?? Prisma.JsonNull,
        createdById: session.userId,
      }),
    });
    for (const l of source.lines) {
      await tx.quoteLine.create({
        data: tenantData(session.tenantId, {
          quoteVersionId: version.id,
          lineNo: l.lineNo,
          category: l.category,
          bomLineId: l.bomLineId,
          quotedMfg: l.quotedMfg,
          quotedMpn: l.quotedMpn,
          materialCategory: l.materialCategory,
          // 分类确认不随修订版继承:新版本必须重新人工确认
          categoryConfirmed: false,
          altMfg: l.altMfg,
          altMpn: l.altMpn,
          qty: l.qty,
          purchaseCost: l.purchaseCost,
          markupPct: l.markupPct,
          customerPrice: l.customerPrice,
          note: l.note,
        }),
      });
    }
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "QUOTE_REVISION_CREATE",
      entityType: "QuoteVersion",
      entityId: version.id,
      after: { fromRevision: source.revision, newRevision: nextRevision, lines: source.lines.length },
    });
    return version;
  });

  return { ok: true, data: { versionId: created.id, revision: created.revision } };
}

/** 正式导出的数据来源(规则 5:只用快照) */
export async function getExportSnapshot(
  session: SessionRef,
  versionId: string,
): Promise<{ ok: true; snapshot: QuoteSnapshot; kind: string } | { ok: false; message: string }> {
  const version = await getQuoteVersion(session, versionId);
  if (!version) return { ok: false, message: "报价版本不存在或不属于当前租户" };

  return resolveExportSource({
    status: version.status as QuoteStatusValue,
    approvedSnapshot: version.approvedSnapshot as unknown as QuoteSnapshot | null,
    submittedSnapshot: version.submittedSnapshot as unknown as QuoteSnapshot | null,
  });
}

export { BUILTIN_LABOR_TEMPLATES, type LaborRateTemplate };
