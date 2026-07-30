/**
 * 采购订单数据层(客户 xlsx「采购订单全流程创建、审批、跟踪」)。
 *
 * 纪律:
 * - 全部经 tenantWhere / tenantData 守卫(CLAUDE.md 数据访问约定);
 * - 每个写操作落 AuditLog;
 * - 冻结态(待复核/待审批/已批准/已导出/已作废)下任何改行操作必须被拒;
 * - 复核时**固化原始异常集合**(wasFlagged + flagReasons + historySnapshot),
 *   此后不随阈值变化而增减(与比价页同一条铁律);
 * - 审批通过后**一次性**生成 OPOLine 交在途协同,禁止双写。
 */
import {
  Prisma,
  type ApprovalDecision,
  type PoApprovalStage,
  type PurchaseOrderStatus,
  type SourcingMode,
} from "@prisma/client";
import { DEFAULT_MAX_INCREASE_RATE, reviewPoLine, type PriceHistoryPoint, type PoLineReview } from "@/lib/domain/po-price-review";
import { planPoLine } from "@/lib/domain/po-scheduling";
import { checkPoTransition, isPoFrozen, type PoStatusValue } from "@/lib/domain/po-status";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export interface PoLineInput {
  lineNo: number;
  mpn?: string | null;
  manufacturer?: string | null;
  description?: string | null;
  qty: string;
  unitPrice?: string | null;
  currency?: string | null;
  moq?: number | null;
  spq?: number | null;
  leadTimeDays?: number | null;
  requestDate?: string | null;
  sourcingMode?: SourcingMode | null;
}

/** 每租户一条采购策略;缺失时给出未确认的缺省口径 */
async function loadPolicy(tenantId: string) {
  const p = await prisma.procurementPolicy.findFirst({ where: tenantWhere(tenantId, {}) });
  return {
    currency: p?.currency ?? "CNY",
    maxUnitPrice: p?.maxUnitPrice?.toString() ?? null,
    maxLeadTimeDays: p?.maxLeadTimeDays ?? null,
    maxIncreaseRate: DEFAULT_MAX_INCREASE_RATE,
    confirmedByBusiness: p?.confirmedByBusiness ?? false,
  };
}

/**
 * 取某 MPN 的历史成交价 —— 只认**已批准或已导出**的 PO 行。
 * 草稿/待审批的价不算成交价,否则会拿一个还没人批的价当基准。
 */
async function loadPriceHistory(
  tenantId: string,
  mpn: string | null,
  excludePoId: string,
): Promise<PriceHistoryPoint[]> {
  if (!mpn) return [];
  // 只认已批准/已导出的成交价;枚举数组要显式收窄类型,
  // 否则 Prisma 的重载匹配不上、select 被忽略、下面全退化成 any
  const settled: PurchaseOrderStatus[] = ["APPROVED", "EXPORTED"];
  const rows = await prisma.purchaseOrderLine.findMany({
    where: tenantWhere(tenantId, {
      mpn,
      purchaseOrderId: { not: excludePoId },
      unitPrice: { not: null },
      purchaseOrder: { status: { in: settled } },
    }),
    select: {
      unitPrice: true,
      currency: true,
      purchaseOrder: { select: { poNo: true, supplierId: true, updatedAt: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  return rows.map((r) => ({
    unitPrice: r.unitPrice!.toString(),
    currency: r.currency,
    supplierId: r.purchaseOrder.supplierId,
    poNo: r.purchaseOrder.poNo,
    approvedAt: r.purchaseOrder.updatedAt.toISOString(),
  }));
}

export async function createPurchaseOrder(
  session: SessionRef,
  input: {
    poNo: string;
    supplierId: string;
    currency?: string;
    procurementRfqId?: string | null;
    purchaseRequestId?: string | null;
    lines?: PoLineInput[];
  },
) {
  const po = await prisma.$transaction(async (tx) => {
    const created = await tx.purchaseOrder.create({
      data: tenantData(session.tenantId, {
        poNo: input.poNo,
        supplierId: input.supplierId,
        currency: input.currency ?? "CNY",
        procurementRfqId: input.procurementRfqId ?? null,
        purchaseRequestId: input.purchaseRequestId ?? null,
        createdById: session.userId,
      }),
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "PO_CREATE",
      entityType: "PurchaseOrder",
      entityId: created.id,
      after: { poNo: input.poNo, supplierId: input.supplierId },
    });
    return created;
  });

  if (input.lines?.length) {
    await replaceLines(session, po.id, input.lines);
  }
  return po;
}

/**
 * 整份替换行项(批量录入走这条路)。
 * 冻结态必须被拒 —— 这是"审批中不得改价"的落地点。
 */
export async function replaceLines(
  session: SessionRef,
  poId: string,
  lines: PoLineInput[],
): Promise<{ ok: true; count: number } | { ok: false; reason: string }> {
  const po = await prisma.purchaseOrder.findFirst({
    where: tenantWhere(session.tenantId, { id: poId }),
    select: { id: true, status: true, currency: true },
  });
  if (!po) return { ok: false, reason: "订单不存在或不属于当前租户" };
  if (isPoFrozen(po.status as PoStatusValue)) {
    return { ok: false, reason: `订单处于「${po.status}」,行项已冻结,不可修改` };
  }

  const today = new Date().toISOString();

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrderLine.deleteMany({ where: tenantWhere(session.tenantId, { purchaseOrderId: poId }) });
    for (const l of lines) {
      // 需求日 + 交期 → 建议下单日与圆整数量;交期未知时 orderByDate 留空(不猜)
      const plan = l.requestDate
        ? planPoLine({
            requestDate: l.requestDate,
            leadTimeDays: l.leadTimeDays ?? null,
            demandQty: Number(l.qty),
            moq: l.moq,
            spq: l.spq,
            today,
          })
        : null;

      await tx.purchaseOrderLine.create({
        data: tenantData(session.tenantId, {
          purchaseOrderId: poId,
          lineNo: l.lineNo,
          mpn: l.mpn ?? null,
          manufacturer: l.manufacturer ?? null,
          description: l.description ?? null,
          qty: new Prisma.Decimal(l.qty),
          unitPrice: l.unitPrice ? new Prisma.Decimal(l.unitPrice) : null,
          currency: l.currency ?? po.currency,
          moq: l.moq ?? null,
          spq: l.spq ?? null,
          leadTimeDays: l.leadTimeDays ?? null,
          requestDate: l.requestDate ? new Date(l.requestDate) : null,
          orderByDate: plan?.orderByDate ? new Date(plan.orderByDate) : null,
          sourcingMode: l.sourcingMode ?? plan?.suggestedMode ?? "FUTURES",
        }),
      });
    }
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "PO_LINES_REPLACE",
      entityType: "PurchaseOrder",
      entityId: poId,
      after: { count: lines.length },
    });
  });

  return { ok: true, count: lines.length };
}

export interface PoLineWithReview {
  id: string;
  lineNo: number;
  mpn: string | null;
  manufacturer: string | null;
  qty: string;
  unitPrice: string | null;
  currency: string;
  moq: number | null;
  spq: number | null;
  leadTimeDays: number | null;
  requestDate: string | null;
  orderByDate: string | null;
  sourcingMode: SourcingMode;
  wasFlagged: boolean;
  resolution: string | null;
  resolutionNote: string | null;
  /** 实时复核结论(草稿态用它)或已固化的快照(冻结态用它) */
  review: PoLineReview | null;
  frozenFlagReasons: unknown;
  frozenHistory: unknown;
}

/**
 * 取订单详情。
 *
 * 冻结态返回**固化快照**(复核时存下的),草稿态实时算 ——
 * 否则阈值一改,已提交单据上的异常集合就会变,复核人看到的和当初提交的不是一回事。
 */
export async function getPurchaseOrder(session: SessionRef, poId: string) {
  const po = await prisma.purchaseOrder.findFirst({
    where: tenantWhere(session.tenantId, { id: poId }),
    include: {
      lines: { orderBy: { lineNo: "asc" } },
      approvals: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!po) return null;

  const policy = await loadPolicy(session.tenantId);
  const frozen = isPoFrozen(po.status as PoStatusValue);

  const lines: PoLineWithReview[] = [];
  for (const l of po.lines) {
    let review: PoLineReview | null = null;
    if (!frozen) {
      const history = await loadPriceHistory(session.tenantId, l.mpn, po.id);
      review = reviewPoLine(
        {
          lineNo: l.lineNo,
          quote: {
            supplierId: po.supplierId,
            unitPrice: l.unitPrice?.toString() ?? "",
            currency: l.currency,
            moq: l.moq,
            spq: l.spq,
            leadTimeDays: l.leadTimeDays,
            quotedAt: l.updatedAt.toISOString(),
          },
          history,
        },
        policy,
      );
    }
    lines.push({
      id: l.id,
      lineNo: l.lineNo,
      mpn: l.mpn,
      manufacturer: l.manufacturer,
      qty: l.qty.toString(),
      unitPrice: l.unitPrice?.toString() ?? null,
      currency: l.currency,
      moq: l.moq,
      spq: l.spq,
      leadTimeDays: l.leadTimeDays,
      requestDate: l.requestDate?.toISOString() ?? null,
      orderByDate: l.orderByDate?.toISOString() ?? null,
      sourcingMode: l.sourcingMode,
      wasFlagged: l.wasFlagged,
      resolution: l.resolution,
      resolutionNote: l.resolutionNote,
      review,
      frozenFlagReasons: l.flagReasons,
      frozenHistory: l.historySnapshot,
    });
  }

  return {
    id: po.id,
    poNo: po.poNo,
    supplierId: po.supplierId,
    currency: po.currency,
    status: po.status as PoStatusValue,
    rejectReason: po.rejectReason,
    cancelReason: po.cancelReason,
    erpExportedAt: po.erpExportedAt?.toISOString() ?? null,
    createdAt: po.createdAt.toISOString(),
    frozen,
    policyConfirmed: policy.confirmedByBusiness,
    maxIncreaseRate: policy.maxIncreaseRate,
    lines,
    approvals: po.approvals.map((a) => ({
      id: a.id,
      stage: a.stage,
      decision: a.decision,
      comment: a.comment,
      decidedAt: a.decidedAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export type PoTransitionOutcome =
  | { ok: true; status: PoStatusValue }
  | { ok: false; code: string; message: string; unresolvedLines?: number[] };

/**
 * 状态流转的唯一入口。提交复核时顺带**固化原始异常集合**。
 */
export async function transitionPurchaseOrder(
  session: SessionRef,
  poId: string,
  to: PoStatusValue,
  opts: { reason?: string | null } = {},
): Promise<PoTransitionOutcome> {
  const po = await prisma.purchaseOrder.findFirst({
    where: tenantWhere(session.tenantId, { id: poId }),
    include: { lines: { orderBy: { lineNo: "asc" } } },
  });
  if (!po) return { ok: false, code: "not_found", message: "订单不存在或不属于当前租户" };

  const from = po.status as PoStatusValue;
  const policy = await loadPolicy(session.tenantId);

  // 提交复核前先算一遍:哪些行有未处理的 error 级异常
  const reviews = new Map<number, PoLineReview>();
  if (to === "PENDING_PRICE_REVIEW") {
    for (const l of po.lines) {
      const history = await loadPriceHistory(session.tenantId, l.mpn, po.id);
      reviews.set(
        l.lineNo,
        reviewPoLine(
          {
            lineNo: l.lineNo,
            quote: {
              supplierId: po.supplierId,
              unitPrice: l.unitPrice?.toString() ?? "",
              currency: l.currency,
              moq: l.moq,
              spq: l.spq,
              leadTimeDays: l.leadTimeDays,
              quotedAt: l.updatedAt.toISOString(),
            },
            history,
          },
          policy,
        ),
      );
    }
  }

  const check = checkPoTransition({
    from,
    to,
    roles: session.roles,
    reason: opts.reason,
    lines: po.lines.map((l) => ({
      lineNo: l.lineNo,
      // 有 error 级异常且未给出处理结论 → 未处理
      hasUnresolvedFlag: Boolean(reviews.get(l.lineNo)?.hasError) && !l.resolution,
    })),
  });
  if (!check.ok) {
    return {
      ok: false,
      code: check.code,
      message: check.message,
      unresolvedLines: "unresolvedLines" in check ? check.unresolvedLines : undefined,
    };
  }

  await prisma.$transaction(async (tx) => {
    if (to === "PENDING_PRICE_REVIEW") {
      // 固化原始异常集合:此后不随阈值变化而增减
      for (const l of po.lines) {
        const r = reviews.get(l.lineNo);
        await tx.purchaseOrderLine.update({
          where: { id: l.id },
          data: {
            wasFlagged: Boolean(r?.hasError),
            flagReasons: (r?.flags ?? []) as unknown as Prisma.InputJsonValue,
            historySnapshot: (r?.history ?? null) as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }

    if (to === "PENDING_PRICE_REVIEW" || to === "PENDING_APPROVAL") {
      await tx.purchaseOrderApproval.create({
        data: tenantData(session.tenantId, {
          purchaseOrderId: poId,
          stage: to === "PENDING_PRICE_REVIEW" ? "PRICE_REVIEW" : "FINAL",
          approverId: session.userId,
          decision: "PENDING",
        }),
      });
    }

    if (to === "APPROVED" || to === "REJECTED") {
      const stage: PoApprovalStage = from === "PENDING_PRICE_REVIEW" ? "PRICE_REVIEW" : "FINAL";
      const pending = await tx.purchaseOrderApproval.findFirst({
        where: tenantWhere(session.tenantId, {
          purchaseOrderId: poId,
          stage,
          decision: "PENDING" satisfies ApprovalDecision as ApprovalDecision,
        }),
        orderBy: { createdAt: "desc" },
      });
      if (pending) {
        await tx.purchaseOrderApproval.update({
          where: { id: pending.id },
          data: {
            approverId: session.userId,
            decision: to === "APPROVED" ? "APPROVED" : "REJECTED",
            comment: opts.reason ?? null,
            decidedAt: new Date(),
          },
        });
      }
    }

    await tx.purchaseOrder.update({
      where: { id: poId },
      data: {
        status: to as PurchaseOrderStatus,
        rejectReason: to === "REJECTED" ? (opts.reason ?? null) : po.rejectReason,
        cancelReason: to === "CANCELLED" ? (opts.reason ?? null) : po.cancelReason,
        reviewSnapshot:
          to === "PENDING_PRICE_REVIEW"
            ? ([...reviews.values()] as unknown as Prisma.InputJsonValue)
            : undefined,
        approvedSnapshot:
          to === "APPROVED"
            ? (po.lines.map((l) => ({
                lineNo: l.lineNo,
                mpn: l.mpn,
                qty: l.qty.toString(),
                unitPrice: l.unitPrice?.toString() ?? null,
                currency: l.currency,
              })) as unknown as Prisma.InputJsonValue)
            : undefined,
      },
    });

    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: `PO_${to}`,
      entityType: "PurchaseOrder",
      entityId: poId,
      before: { status: from },
      after: { status: to, reason: opts.reason ?? null },
    });
  });

  return { ok: true, status: to };
}

/** 逐项人工处理异常(结论默认空,系统不预设) */
export async function resolvePoLineFlag(
  session: SessionRef,
  lineId: string,
  resolution: string,
  note?: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const line = await prisma.purchaseOrderLine.findFirst({
    where: tenantWhere(session.tenantId, { id: lineId }),
    select: { id: true, purchaseOrderId: true, purchaseOrder: { select: { status: true } } },
  });
  if (!line) return { ok: false, reason: "行不存在或不属于当前租户" };
  if (isPoFrozen(line.purchaseOrder.status as PoStatusValue)) {
    return { ok: false, reason: "订单已冻结,不可再改处理结论" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrderLine.update({
      where: { id: lineId },
      data: { resolution, resolutionNote: note ?? null },
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "PO_LINE_RESOLVE",
      entityType: "PurchaseOrderLine",
      entityId: lineId,
      after: { resolution, note: note ?? null },
    });
  });
  return { ok: true };
}

/**
 * 已审批 → 生成在途行(OPOLine)并标记已导出。
 *
 * 数据主权:OPOLine 是**在途协同**的唯一真源,这里只写入一次;
 * 之后的 ETA 回复只落在 OPO 侧,不回写 PO 行(禁止双写)。
 */
export async function materializeToOpo(
  session: SessionRef,
  poId: string,
): Promise<{ ok: true; created: number } | { ok: false; reason: string }> {
  const po = await prisma.purchaseOrder.findFirst({
    where: tenantWhere(session.tenantId, { id: poId }),
    include: { lines: { orderBy: { lineNo: "asc" } } },
  });
  if (!po) return { ok: false, reason: "订单不存在或不属于当前租户" };
  if (po.status !== "APPROVED" && po.status !== "EXPORTED") {
    return { ok: false, reason: "只有已审批的订单才能生成在途行" };
  }

  const existing = await prisma.oPOLine.count({
    where: tenantWhere(session.tenantId, { poNo: po.poNo }),
  });
  if (existing > 0) return { ok: false, reason: "该单号的在途行已存在,不重复生成(禁止双写)" };

  await prisma.$transaction(async (tx) => {
    for (const l of po.lines) {
      await tx.oPOLine.create({
        data: tenantData(session.tenantId, {
          poNo: po.poNo,
          lineNo: l.lineNo,
          supplierId: po.supplierId,
          mpn: l.mpn ?? null,
          qtyOrdered: l.qty,
          qtyOpen: l.qty,
          unitPrice: l.unitPrice ?? null,
          currency: l.currency,
          needDate: l.requestDate ?? null,
        }),
      });
    }
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "PO_MATERIALIZE_OPO",
      entityType: "PurchaseOrder",
      entityId: poId,
      after: { poNo: po.poNo, lines: po.lines.length },
    });
  });

  return { ok: true, created: po.lines.length };
}

/** 台账:行级派生,不落冗余计数 */
export async function listPurchaseOrders(
  session: SessionRef,
  filter: { status?: PoStatusValue | null; supplierId?: string | null; from?: string | null; to?: string | null } = {},
) {
  const where: Record<string, unknown> = {};
  if (filter.status) where.status = filter.status;
  if (filter.supplierId) where.supplierId = filter.supplierId;
  if (filter.from || filter.to) {
    where.createdAt = {
      ...(filter.from ? { gte: new Date(filter.from) } : {}),
      ...(filter.to ? { lte: new Date(filter.to) } : {}),
    };
  }

  const rows = await prisma.purchaseOrder.findMany({
    where: tenantWhere(session.tenantId, where),
    include: {
      lines: {
        select: { qty: true, unitPrice: true, currency: true, wasFlagged: true, resolution: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return rows.map((po) => {
    // 金额只在**同币种**内合计;出现异币种则标注不可比,不做换算(全局规则)
    const currencies = new Set(po.lines.map((l) => l.currency.toUpperCase()));
    currencies.add(po.currency.toUpperCase());
    const mixedCurrency = currencies.size > 1;
    let amount = new Prisma.Decimal(0);
    for (const l of po.lines) {
      if (l.unitPrice && l.currency.toUpperCase() === po.currency.toUpperCase()) {
        amount = amount.add(l.unitPrice.mul(l.qty));
      }
    }
    const flagged = po.lines.filter((l) => l.wasFlagged).length;
    const unresolved = po.lines.filter((l) => l.wasFlagged && !l.resolution).length;
    return {
      id: po.id,
      poNo: po.poNo,
      supplierId: po.supplierId,
      currency: po.currency,
      status: po.status as PoStatusValue,
      lineCount: po.lines.length,
      amount: amount.toFixed(),
      mixedCurrency,
      flaggedLines: flagged,
      unresolvedLines: unresolved,
      erpExportedAt: po.erpExportedAt?.toISOString() ?? null,
      createdAt: po.createdAt.toISOString(),
    };
  });
}

export async function markErpExported(
  session: SessionRef,
  poId: string,
  integrationJobId: string | null,
) {
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id: poId },
      data: { erpExportedAt: new Date(), erpIntegrationJobId: integrationJobId },
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "PO_ERP_EXPORT",
      entityType: "PurchaseOrder",
      entityId: poId,
      after: { integrationJobId },
    });
  });
}
