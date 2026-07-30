/**
 * AR/AP 对账数据层。
 *
 * 数据主权(必须反复强调,否则很容易被写成"系统自动对上了 ERP 的出入库"):
 * 本系统**没有**出货/入库/发票模型。我方基准只有两条合法来源:
 * - DERIVED:本系统已批准单据派生 —— AP 用已批准/已导出 PO 行,AR 用已批准报价行;
 * - UPLOADED:由 ERP 导出明细上传。
 *
 * 纪律:全部经 tenantWhere/tenantData;每个写操作落 AuditLog;
 * 匹配结果与汇总在匹配时固化(matchSnapshot),之后改容差不会悄悄改变已对过的账。
 */
import {
  Prisma,
  type PurchaseOrderStatus,
  type QuoteStatus,
  type ReconBaselineSource,
  type ReconciliationKind,
  type ReconLineVerdict,
} from "@prisma/client";
import { computeAging, type AgingResult } from "@/lib/domain/recon-aging";
import {
  matchReconLines,
  type ReconMatchResult,
  type ReconSideLine,
  type ReconVerdict,
} from "@/lib/domain/recon-match";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

/** 领域层用中文 verdict(便于直接展示),落库用枚举 —— 两边一一对应 */
const VERDICT_TO_ENUM: Record<ReconVerdict, ReconLineVerdict> = {
  一致: "CONSISTENT",
  数量差异: "QTY_DIFF",
  单价差异: "PRICE_DIFF",
  金额差异: "AMOUNT_DIFF",
  币种不一致: "CURRENCY_MISMATCH",
  仅对方有: "ONLY_THEIRS",
  仅我方有: "ONLY_OURS",
};

export const ENUM_TO_VERDICT: Record<ReconLineVerdict, ReconVerdict> = {
  CONSISTENT: "一致",
  QTY_DIFF: "数量差异",
  PRICE_DIFF: "单价差异",
  AMOUNT_DIFF: "金额差异",
  CURRENCY_MISMATCH: "币种不一致",
  ONLY_THEIRS: "仅对方有",
  ONLY_OURS: "仅我方有",
};

/** 需人工查清的判定(台账未处理数按这些算) */
export const NEEDS_ATTENTION: readonly ReconLineVerdict[] = [
  "QTY_DIFF",
  "PRICE_DIFF",
  "AMOUNT_DIFF",
  "CURRENCY_MISMATCH",
  "ONLY_THEIRS",
  "ONLY_OURS",
];

export interface CreateStatementInput {
  kind: ReconciliationKind;
  code: string;
  customerId?: string | null;
  supplierId?: string | null;
  currency?: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  amountTolerance?: string | null;
}

export async function createStatement(session: SessionRef, input: CreateStatementInput) {
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.reconciliationStatement.create({
      data: tenantData(session.tenantId, {
        kind: input.kind,
        code: input.code,
        customerId: input.kind === "AR" ? (input.customerId ?? null) : null,
        supplierId: input.kind === "AP" ? (input.supplierId ?? null) : null,
        currency: input.currency ?? "CNY",
        periodFrom: input.periodFrom ? new Date(input.periodFrom) : null,
        periodTo: input.periodTo ? new Date(input.periodTo) : null,
        amountTolerance: new Prisma.Decimal(input.amountTolerance ?? "0.01"),
        createdById: session.userId,
      }),
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "RECON_CREATE",
      entityType: "ReconciliationStatement",
      entityId: row.id,
      after: { kind: input.kind, code: input.code },
    });
    return row;
  });
  return created;
}

/**
 * 从本系统已批准单据派生我方基准。
 *
 * - AP(应付):已批准/已导出的 PO 行 —— 这是本系统真正拥有的应付依据;
 * - AR(应收):已批准报价版本的行 —— 本系统拥有的应收依据。
 *
 * **到期日一律为空**:本系统没有账期字段,也没有发票日期。
 * 账龄因此会落到「到期日未知」,由 UI 如实提示,而不是拿创建日期冒充到期日。
 */
export async function deriveBaseline(
  session: SessionRef,
  opts: {
    kind: ReconciliationKind;
    customerId?: string | null;
    supplierId?: string | null;
    periodFrom?: Date | null;
    periodTo?: Date | null;
  },
): Promise<ReconSideLine[]> {
  const period =
    opts.periodFrom || opts.periodTo
      ? {
          ...(opts.periodFrom ? { gte: opts.periodFrom } : {}),
          ...(opts.periodTo ? { lte: opts.periodTo } : {}),
        }
      : undefined;

  if (opts.kind === "AP") {
    const settled: PurchaseOrderStatus[] = ["APPROVED", "EXPORTED"];
    const rows = await prisma.purchaseOrderLine.findMany({
      where: tenantWhere(session.tenantId, {
        purchaseOrder: {
          status: { in: settled },
          ...(opts.supplierId ? { supplierId: opts.supplierId } : {}),
          ...(period ? { updatedAt: period } : {}),
        },
      }),
      select: {
        lineNo: true,
        mpn: true,
        qty: true,
        unitPrice: true,
        currency: true,
        purchaseOrder: { select: { poNo: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 2000,
    });
    return rows.map((r) => ({
      docNo: r.purchaseOrder.poNo,
      docLineNo: r.lineNo,
      mpn: r.mpn,
      qty: r.qty.toString(),
      unitPrice: r.unitPrice?.toString() ?? null,
      amount: null,
      currency: r.currency,
      dueDate: null,
    }));
  }

  const approved: QuoteStatus[] = ["APPROVED"];
  const rows = await prisma.quoteLine.findMany({
    where: tenantWhere(session.tenantId, {
      quoteVersion: {
        status: { in: approved },
        ...(period ? { updatedAt: period } : {}),
        ...(opts.customerId ? { quote: { customerId: opts.customerId } } : {}),
      },
    }),
    select: {
      lineNo: true,
      quotedMpn: true,
      qty: true,
      customerPrice: true,
      quoteVersion: { select: { revision: true, quote: { select: { code: true } } } },
    },
    orderBy: { createdAt: "asc" },
    take: 2000,
  });
  return rows.map((r) => ({
    docNo: `${r.quoteVersion.quote.code}-R${r.quoteVersion.revision}`,
    docLineNo: r.lineNo,
    mpn: r.quotedMpn,
    qty: r.qty?.toString() ?? null,
    unitPrice: r.customerPrice?.toString() ?? null,
    amount: null,
    currency: "CNY",
    dueDate: null,
  }));
}

/**
 * 执行匹配并整份落库(重跑会覆盖上一次结果 —— 对账是"这一版对到什么程度"的快照,
 * 不做增量合并,否则人分不清哪条结论属于哪一次对账)。
 */
export async function runMatch(
  session: SessionRef,
  statementId: string,
  theirs: ReconSideLine[],
  ours: ReconSideLine[],
  baselineSource: ReconBaselineSource,
): Promise<{ ok: true; result: ReconMatchResult } | { ok: false; reason: string }> {
  const st = await prisma.reconciliationStatement.findFirst({
    where: tenantWhere(session.tenantId, { id: statementId }),
  });
  if (!st) return { ok: false, reason: "对账单不存在或不属于当前租户" };
  if (st.status === "CLOSED") return { ok: false, reason: "对账单已关闭,不可重新匹配" };

  const result = matchReconLines(theirs, ours, {
    amountTolerance: st.amountTolerance.toString(),
    baseCurrency: st.currency,
  });

  await prisma.$transaction(async (tx) => {
    await tx.reconciliationLine.deleteMany({
      where: tenantWhere(session.tenantId, { statementId }),
    });
    for (const l of result.lines) {
      await tx.reconciliationLine.create({
        data: tenantData(session.tenantId, {
          statementId,
          lineNo: l.lineNo,
          matchKey: l.key,
          docNo: l.theirs?.docNo ?? l.ours?.docNo ?? null,
          docLineNo: l.theirs?.docLineNo ?? l.ours?.docLineNo ?? null,
          mpn: l.theirs?.mpn ?? l.ours?.mpn ?? null,
          theirQty: l.theirs?.qty ? new Prisma.Decimal(l.theirs.qty) : null,
          theirUnitPrice: l.theirs?.unitPrice ? new Prisma.Decimal(l.theirs.unitPrice) : null,
          theirAmount: l.theirs?.amount ? new Prisma.Decimal(l.theirs.amount) : null,
          theirCurrency: l.theirs?.currency ?? null,
          ourQty: l.ours?.qty ? new Prisma.Decimal(l.ours.qty) : null,
          ourUnitPrice: l.ours?.unitPrice ? new Prisma.Decimal(l.ours.unitPrice) : null,
          ourAmount: l.ours?.amount ? new Prisma.Decimal(l.ours.amount) : null,
          ourCurrency: l.ours?.currency ?? null,
          verdict: VERDICT_TO_ENUM[l.verdict],
          diffAmount: l.diffAmount ? new Prisma.Decimal(l.diffAmount) : null,
          severity: l.severity,
          details: l.details as unknown as Prisma.InputJsonValue,
          dueDate: l.dueDate ? new Date(l.dueDate) : null,
        }),
      });
    }
    await tx.reconciliationStatement.update({
      where: { id: statementId },
      data: {
        status: "MATCHED",
        baselineSource,
        matchedAt: new Date(),
        matchSnapshot: result.summary as unknown as Prisma.InputJsonValue,
      },
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "RECON_MATCH",
      entityType: "ReconciliationStatement",
      entityId: statementId,
      after: { baselineSource, ...result.summary },
    });
  });

  return { ok: true, result };
}

export async function resolveReconLine(
  session: SessionRef,
  lineId: string,
  resolution: string,
  note?: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const line = await prisma.reconciliationLine.findFirst({
    where: tenantWhere(session.tenantId, { id: lineId }),
    select: { id: true, statement: { select: { status: true } } },
  });
  if (!line) return { ok: false, reason: "对账行不存在或不属于当前租户" };
  if (line.statement.status === "CLOSED") {
    return { ok: false, reason: "对账单已关闭,不可再改处理结论" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.reconciliationLine.update({
      where: { id: lineId },
      data: { resolution, resolutionNote: note ?? null },
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "RECON_LINE_RESOLVE",
      entityType: "ReconciliationLine",
      entityId: lineId,
      after: { resolution, note: note ?? null },
    });
  });
  return { ok: true };
}

export interface ReconLineView {
  id: string;
  lineNo: number;
  matchKey: string;
  docNo: string | null;
  docLineNo: number | null;
  mpn: string | null;
  theirQty: string | null;
  theirUnitPrice: string | null;
  theirAmount: string | null;
  theirCurrency: string | null;
  ourQty: string | null;
  ourUnitPrice: string | null;
  ourAmount: string | null;
  ourCurrency: string | null;
  verdict: ReconVerdict;
  diffAmount: string | null;
  severity: string;
  details: string[];
  dueDate: string | null;
  resolution: string | null;
  resolutionNote: string | null;
}

export async function getStatement(session: SessionRef, id: string) {
  const st = await prisma.reconciliationStatement.findFirst({
    where: tenantWhere(session.tenantId, { id }),
    include: { lines: { orderBy: { lineNo: "asc" } } },
  });
  if (!st) return null;

  const lines: ReconLineView[] = st.lines.map((l) => ({
    id: l.id,
    lineNo: l.lineNo,
    matchKey: l.matchKey,
    docNo: l.docNo,
    docLineNo: l.docLineNo,
    mpn: l.mpn,
    theirQty: l.theirQty?.toString() ?? null,
    theirUnitPrice: l.theirUnitPrice?.toString() ?? null,
    theirAmount: l.theirAmount?.toString() ?? null,
    theirCurrency: l.theirCurrency,
    ourQty: l.ourQty?.toString() ?? null,
    ourUnitPrice: l.ourUnitPrice?.toString() ?? null,
    ourAmount: l.ourAmount?.toString() ?? null,
    ourCurrency: l.ourCurrency,
    verdict: ENUM_TO_VERDICT[l.verdict],
    diffAmount: l.diffAmount?.toString() ?? null,
    severity: l.severity,
    details: Array.isArray(l.details) ? (l.details as string[]) : [],
    dueDate: l.dueDate?.toISOString() ?? null,
    resolution: l.resolution,
    resolutionNote: l.resolutionNote,
  }));

  // 账龄按**对方对账单金额**算(应收/应付的口径是对方账上的数);缺金额的行不参与
  const aging: AgingResult = computeAging(
    lines
      .filter((l) => l.theirAmount !== null)
      .map((l) => ({ amount: l.theirAmount!, dueDate: l.dueDate })),
    new Date().toISOString(),
    st.currency,
  );

  return {
    id: st.id,
    kind: st.kind,
    code: st.code,
    customerId: st.customerId,
    supplierId: st.supplierId,
    currency: st.currency,
    status: st.status,
    baselineSource: st.baselineSource,
    amountTolerance: st.amountTolerance.toString(),
    matchedAt: st.matchedAt?.toISOString() ?? null,
    lastPreviewAt: st.lastPreviewAt?.toISOString() ?? null,
    periodFrom: st.periodFrom?.toISOString() ?? null,
    periodTo: st.periodTo?.toISOString() ?? null,
    summary: st.matchSnapshot as unknown,
    lines,
    aging,
    unresolved: st.lines.filter(
      (l) => NEEDS_ATTENTION.includes(l.verdict) && !l.resolution,
    ).length,
  };
}

export async function listStatements(session: SessionRef, kind: ReconciliationKind) {
  const rows = await prisma.reconciliationStatement.findMany({
    where: tenantWhere(session.tenantId, { kind }),
    include: { lines: { select: { verdict: true, resolution: true, diffAmount: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((st) => {
    const needAttention = st.lines.filter((l) => NEEDS_ATTENTION.includes(l.verdict));
    let diff = new Prisma.Decimal(0);
    for (const l of st.lines) if (l.diffAmount) diff = diff.add(l.diffAmount);
    return {
      id: st.id,
      code: st.code,
      kind: st.kind,
      customerId: st.customerId,
      supplierId: st.supplierId,
      currency: st.currency,
      status: st.status,
      baselineSource: st.baselineSource,
      lineCount: st.lines.length,
      diffLines: needAttention.length,
      unresolved: needAttention.filter((l) => !l.resolution).length,
      diffTotal: diff.toFixed(),
      matchedAt: st.matchedAt?.toISOString() ?? null,
      createdAt: st.createdAt.toISOString(),
    };
  });
}

/** 记一次"对账单预览" —— 邮件通道未接入,只能预览/模拟,不得声称已发送 */
export async function markPreviewed(session: SessionRef, id: string) {
  await prisma.$transaction(async (tx) => {
    await tx.reconciliationStatement.update({
      where: { id },
      data: { lastPreviewAt: new Date() },
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "RECON_PREVIEW",
      entityType: "ReconciliationStatement",
      entityId: id,
      after: { note: "生成对账单预览;邮件通道未接入,未发送" },
    });
  });
}
