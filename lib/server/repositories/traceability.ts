/**
 * 批次级追溯数据层。
 *
 * 数据主权与边界:本系统**没有 MES**。批次数据只来自三张导入模板或 ERP 同步,
 * 一期只做到**批次级**,SN 级待数据源接入。
 *
 * 纪律:
 * - 全部经 tenantWhere / tenantData;每个写操作落 AuditLog;
 * - 导入行级校验、行级报错,幂等键防重复导入,**撤销只允许撤未被下游引用的批次**;
 * - 隔离处置**提议与批准分离**,状态区分「本系统已登记」与「外部系统已确认」;
 * - 图边冗余存储,但由导入行**派生**,不接受手工直接写边。
 */
import { createHash } from "crypto";
import { Prisma, type ContainmentKind, type TraceEdgeKind } from "@prisma/client";
import {
  computeBlastRadius,
  makeRef,
  parseRef,
  traceBackward,
  traceForward,
  type BlastRadius,
  type TraceEdgeInput,
} from "@/lib/domain/trace-graph";
import { parseTraceTemplate, type TraceTemplate } from "@/lib/domain/trace-import";
import {
  canQueryFrom,
  scopeDescription,
  scopeEdges,
  type TraceScope,
} from "@/lib/domain/trace-scope";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

export type ImportOutcome =
  | {
      ok: true;
      batchId: string;
      total: number;
      okRows: number;
      errorRows: number;
      errors: { row: number; message: string }[];
      notices: string[];
      duplicated: boolean;
    }
  | { ok: false; reason: string; errors?: { row: number; message: string }[]; notices?: string[] };

function dec(v: string | null | undefined): Prisma.Decimal | null {
  if (!v) return null;
  try {
    return new Prisma.Decimal(v);
  } catch {
    return null;
  }
}

function date(v: string | null | undefined): Date | null {
  if (!v) return null;
  const t = Date.parse(`${v}T00:00:00.000Z`);
  return Number.isFinite(t) ? new Date(t) : null;
}

/** 导入一张模板并派生图边 */
export async function importTraceTemplate(
  session: SessionRef,
  template: TraceTemplate,
  text: string,
  fileName?: string | null,
): Promise<ImportOutcome> {
  const parsed = parseTraceTemplate(template, text);
  if (parsed.rows.length === 0) {
    return { ok: false, reason: "没有可导入的数据行", errors: parsed.errors, notices: parsed.notices };
  }

  const key = createHash("sha256")
    .update(`${template}:${JSON.stringify(parsed.rows)}`)
    .digest("hex")
    .slice(0, 32);

  const existing = await prisma.traceImportBatch.findFirst({
    where: tenantWhere(session.tenantId, { idempotencyKey: key }),
  });
  if (existing) {
    return {
      ok: true,
      batchId: existing.id,
      total: existing.totalRows,
      okRows: existing.okRows,
      errorRows: existing.errorRows,
      errors: (existing.errors as { row: number; message: string }[] | null) ?? [],
      notices: ["相同内容已导入过,已复用既有导入批次(幂等键命中),未重复建数据"],
      duplicated: true,
    };
  }

  const batch = await prisma.$transaction(async (tx) => {
    const b = await tx.traceImportBatch.create({
      data: tenantData(session.tenantId, {
        template,
        fileName: fileName ?? null,
        totalRows: parsed.rows.length + parsed.errors.length,
        okRows: parsed.rows.length,
        errorRows: parsed.errors.length,
        errors: parsed.errors as unknown as Prisma.InputJsonValue,
        idempotencyKey: key,
        createdById: session.userId,
      }),
    });

    const edges: { kind: TraceEdgeKind; fromRef: string; toRef: string; qty: string | null; at: Date | null }[] = [];

    if (template === "RECEIPT") {
      for (const r of parsed.rows) {
        const internalLot = r.internalLot!;
        await tx.receiptLot.upsert({
          where: { tenantId_internalLot: { tenantId: session.tenantId, internalLot } },
          update: {},
          create: tenantData(session.tenantId, {
            importBatchId: b.id,
            poNo: r.poNo,
            poLineNo: r.poLineNo ? Number(r.poLineNo) : null,
            supplierName: r.supplier,
            mpn: r.mpn,
            internalPn: r.internalPn,
            supplierLot: r.supplierLot,
            internalLot,
            receivedQty: dec(r.receivedQty) ?? new Prisma.Decimal(0),
            receivedAt: date(r.receivedAt),
            dateCode: r.dateCode,
            warehouse: r.warehouse,
            location: r.location,
            createdById: session.userId,
          }),
        });
        await tx.materialLot.upsert({
          where: { tenantId_lotNo: { tenantId: session.tenantId, lotNo: internalLot } },
          update: {},
          create: tenantData(session.tenantId, {
            lotNo: internalLot,
            mpn: r.mpn,
            internalPn: r.internalPn,
            receivedQty: dec(r.receivedQty) ?? new Prisma.Decimal(0),
          }),
        });

        const at = date(r.receivedAt);
        if (r.supplier) {
          edges.push({ kind: "PO_TO_RECEIPT", fromRef: makeRef("SUPPLIER", r.supplier), toRef: makeRef("PO", r.poNo ?? "(无PO)"), qty: null, at });
        }
        if (r.poNo) {
          edges.push({ kind: "PO_TO_RECEIPT", fromRef: makeRef("PO", r.poNo), toRef: makeRef("RECEIPT", internalLot), qty: r.receivedQty, at });
        }
        edges.push({ kind: "RECEIPT_TO_LOT", fromRef: makeRef("RECEIPT", internalLot), toRef: makeRef("LOT", internalLot), qty: r.receivedQty, at });
      }
    }

    if (template === "WO_ISSUE") {
      for (const r of parsed.rows) {
        const wo = r.workOrderNo!;
        const lot = r.lotNo!;
        await tx.traceWorkOrder.upsert({
          where: { tenantId_workOrderNo: { tenantId: session.tenantId, workOrderNo: wo } },
          update: { product: r.product ?? undefined, bomVersion: r.bomVersion ?? undefined },
          create: tenantData(session.tenantId, {
            workOrderNo: wo,
            product: r.product,
            bomVersion: r.bomVersion,
            productionLine: r.productionLine,
          }),
        });
        await tx.workOrderMaterialIssue.upsert({
          where: {
            tenantId_workOrderNo_lotNo: { tenantId: session.tenantId, workOrderNo: wo, lotNo: lot },
          },
          update: { issuedQty: dec(r.issuedQty) ?? new Prisma.Decimal(0) },
          create: tenantData(session.tenantId, {
            importBatchId: b.id,
            workOrderNo: wo,
            lotNo: lot,
            mpn: r.mpn,
            issuedQty: dec(r.issuedQty) ?? new Prisma.Decimal(0),
            returnedQty: dec(r.returnedQty),
            issuedAt: date(r.issuedAt),
            operator: r.operator,
          }),
        });
        edges.push({
          kind: "LOT_TO_ISSUE",
          fromRef: makeRef("LOT", lot),
          toRef: makeRef("WO", wo),
          qty: r.issuedQty,
          at: date(r.issuedAt),
        });
      }
    }

    if (template === "SHIPMENT") {
      for (const r of parsed.rows) {
        const fg = r.fgLotNo!;
        const shipmentNo = r.shipmentNo!;
        await tx.finishedGoodsLot.upsert({
          where: { tenantId_fgLotNo: { tenantId: session.tenantId, fgLotNo: fg } },
          update: { workOrderNo: r.workOrderNo ?? undefined },
          create: tenantData(session.tenantId, {
            fgLotNo: fg,
            workOrderNo: r.workOrderNo,
            producedQty: dec(r.shippedQty),
          }),
        });
        const shipment = await tx.traceShipment.upsert({
          where: { tenantId_shipmentNo: { tenantId: session.tenantId, shipmentNo } },
          update: { customerName: r.customer ?? undefined, customerPo: r.customerPo ?? undefined },
          create: tenantData(session.tenantId, {
            shipmentNo,
            customerName: r.customer,
            customerPo: r.customerPo,
            shippedAt: date(r.shippedAt),
          }),
        });
        await tx.traceShipmentLine.upsert({
          where: {
            tenantId_shipmentId_fgLotNo: {
              tenantId: session.tenantId,
              shipmentId: shipment.id,
              fgLotNo: fg,
            },
          },
          update: { shippedQty: dec(r.shippedQty) ?? new Prisma.Decimal(0) },
          create: tenantData(session.tenantId, {
            shipmentId: shipment.id,
            importBatchId: b.id,
            fgLotNo: fg,
            shippedQty: dec(r.shippedQty) ?? new Prisma.Decimal(0),
          }),
        });

        const at = date(r.shippedAt);
        if (r.workOrderNo) {
          edges.push({ kind: "WORK_ORDER_TO_FG_LOT", fromRef: makeRef("WO", r.workOrderNo), toRef: makeRef("FG", fg), qty: r.shippedQty, at });
        }
        edges.push({ kind: "FG_LOT_TO_SHIPMENT", fromRef: makeRef("FG", fg), toRef: makeRef("SHIPMENT", shipmentNo), qty: r.shippedQty, at });
        if (r.customer) {
          edges.push({ kind: "SHIPMENT_TO_CUSTOMER", fromRef: makeRef("SHIPMENT", shipmentNo), toRef: makeRef("CUSTOMER", r.customer), qty: r.shippedQty, at });
        }
      }
    }

    for (const e of edges) {
      await tx.traceEdge.upsert({
        where: {
          tenantId_kind_fromRef_toRef: {
            tenantId: session.tenantId,
            kind: e.kind,
            fromRef: e.fromRef,
            toRef: e.toRef,
          },
        },
        update: { qty: dec(e.qty), occurredAt: e.at },
        create: tenantData(session.tenantId, {
          kind: e.kind,
          fromRef: e.fromRef,
          toRef: e.toRef,
          qty: dec(e.qty),
          occurredAt: e.at,
        }),
      });
    }

    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "TRACE_IMPORT",
      entityType: "TraceImportBatch",
      entityId: b.id,
      after: { template, okRows: parsed.rows.length, errorRows: parsed.errors.length, edges: edges.length },
    });

    return b;
  });

  return {
    ok: true,
    batchId: batch.id,
    total: parsed.rows.length + parsed.errors.length,
    okRows: parsed.rows.length,
    errorRows: parsed.errors.length,
    errors: parsed.errors,
    notices: parsed.notices,
    duplicated: false,
  };
}

/**
 * 解析当前用户的追溯可见范围。
 *
 * SUPPLIER 角色**必须**有 supplierId 归属;没有归属就给一个空范围
 * (ownLotNos=[]),任何查询都会被拒 —— 宁可不给数据,也不给全量。
 */
export async function resolveScope(session: SessionRef): Promise<TraceScope> {
  if (!session.roles.includes("SUPPLIER")) return { role: "INTERNAL" };

  const user = await prisma.user.findFirst({
    where: tenantWhere(session.tenantId, { id: session.userId }),
    select: { supplierId: true },
  });
  if (!user?.supplierId) return { role: "SUPPLIER", supplierKey: null, ownLotNos: [] };

  const supplier = await prisma.supplier.findFirst({
    where: tenantWhere(session.tenantId, { id: user.supplierId }),
    select: { name: true, code: true },
  });
  // 收料表里存的是供应商名称(导入模板给的是名字),按名称与编码两路匹配
  const lots = await prisma.receiptLot.findMany({
    where: tenantWhere(session.tenantId, {
      OR: [
        { supplierId: user.supplierId },
        ...(supplier?.name ? [{ supplierName: supplier.name }] : []),
        ...(supplier?.code ? [{ supplierName: supplier.code }] : []),
      ],
    }),
    select: { internalLot: true },
    take: 5000,
  });

  return {
    role: "SUPPLIER",
    supplierKey: supplier?.name ?? null,
    ownLotNos: lots.map((l) => l.internalLot),
  };
}

/** 取全部图边(一期数据量小,一次load;大了再按需分片) */
export async function loadEdges(session: SessionRef): Promise<TraceEdgeInput[]> {
  const rows = await prisma.traceEdge.findMany({
    where: tenantWhere(session.tenantId),
    take: 20000,
  });
  return rows.map((e) => ({
    fromRef: e.fromRef,
    toRef: e.toRef,
    kind: e.kind,
    qty: e.qty?.toString() ?? null,
    occurredAt: e.occurredAt?.toISOString().slice(0, 10) ?? null,
  }));
}

/** 把用户输入解析成节点引用:支持批次/工单/成品/出货/PO/客户 */
export async function resolveQuery(session: SessionRef, q: string): Promise<string[]> {
  const key = q.trim();
  if (!key) return [];
  const hits: string[] = [];

  const [lot, wo, fg, shipment, receipt] = await Promise.all([
    prisma.materialLot.findFirst({ where: tenantWhere(session.tenantId, { lotNo: key }), select: { lotNo: true } }),
    prisma.traceWorkOrder.findFirst({ where: tenantWhere(session.tenantId, { workOrderNo: key }), select: { workOrderNo: true } }),
    prisma.finishedGoodsLot.findFirst({ where: tenantWhere(session.tenantId, { fgLotNo: key }), select: { fgLotNo: true } }),
    prisma.traceShipment.findFirst({ where: tenantWhere(session.tenantId, { shipmentNo: key }), select: { shipmentNo: true } }),
    prisma.receiptLot.findFirst({
      where: tenantWhere(session.tenantId, { OR: [{ poNo: key }, { supplierLot: key }, { mpn: key }] }),
      select: { internalLot: true, poNo: true },
    }),
  ]);

  if (lot) hits.push(makeRef("LOT", lot.lotNo));
  if (wo) hits.push(makeRef("WO", wo.workOrderNo));
  if (fg) hits.push(makeRef("FG", fg.fgLotNo));
  if (shipment) hits.push(makeRef("SHIPMENT", shipment.shipmentNo));
  if (receipt) {
    hits.push(makeRef("LOT", receipt.internalLot));
    if (receipt.poNo === key) hits.push(makeRef("PO", receipt.poNo));
  }
  return [...new Set(hits)];
}

export interface TraceQueryResult {
  sourceRef: string;
  /** 视图边界说明(内部视图 / 供应商受限视图) */
  scopeNote: string;
  /** 因越权被裁掉的关系数;>0 时 UI 必须提示"隐藏 ≠ 没有影响" */
  truncatedEdges: number;
  truncatedNotice: string | null;
  forward: { layers: string[][]; edges: TraceEdgeInput[] };
  backward: { layers: string[][]; edges: TraceEdgeInput[] };
  blastRadius: BlastRadius;
}

export type QueryOutcome =
  | { ok: true; result: TraceQueryResult }
  | { ok: false; reason: string };

export async function queryTraceScoped(
  session: SessionRef,
  sourceRef: string,
): Promise<QueryOutcome> {
  const scope = await resolveScope(session);
  const gate = canQueryFrom(sourceRef, scope);
  if (!gate.allowed) return { ok: false, reason: gate.reason ?? "无权查询该对象" };
  return { ok: true, result: await queryTrace(session, sourceRef, scope) };
}

export async function queryTrace(
  session: SessionRef,
  sourceRef: string,
  scope: TraceScope = { role: "INTERNAL" },
): Promise<TraceQueryResult> {
  const allEdges = await loadEdges(session);
  const scoped = scopeEdges(allEdges, scope);
  const edges = scoped.edges;

  // 数量口径:出货量按成品批次汇总;在库量 = 收料量 − 已发料量(**没有数据的批次不参与**)
  const [shipLines, issues, lots, wos, shipments] = await Promise.all([
    prisma.traceShipmentLine.findMany({ where: tenantWhere(session.tenantId), select: { fgLotNo: true, shippedQty: true } }),
    prisma.workOrderMaterialIssue.findMany({ where: tenantWhere(session.tenantId), select: { lotNo: true, issuedQty: true } }),
    prisma.materialLot.findMany({ where: tenantWhere(session.tenantId), select: { lotNo: true, receivedQty: true } }),
    prisma.traceWorkOrder.findMany({ where: tenantWhere(session.tenantId), select: { workOrderNo: true, status: true } }),
    prisma.traceShipment.findMany({ where: tenantWhere(session.tenantId), select: { shipmentNo: true, customerName: true } }),
  ]);

  const shippedQtyByFgLot: Record<string, string> = {};
  for (const l of shipLines) {
    const prev = Number(shippedQtyByFgLot[l.fgLotNo] ?? "0");
    shippedQtyByFgLot[l.fgLotNo] = String(prev + Number(l.shippedQty));
  }
  const issuedByLot = new Map<string, number>();
  for (const i of issues) issuedByLot.set(i.lotNo, (issuedByLot.get(i.lotNo) ?? 0) + Number(i.issuedQty));
  const onHandQtyByLot: Record<string, string> = {};
  for (const l of lots) {
    onHandQtyByLot[l.lotNo] = String(Math.max(0, Number(l.receivedQty) - (issuedByLot.get(l.lotNo) ?? 0)));
  }
  const customerByShipment: Record<string, string> = {};
  for (const s of shipments) if (s.customerName) customerByShipment[s.shipmentNo] = s.customerName;

  const fwd = traceForward(sourceRef, edges);
  const bwd = traceBackward(sourceRef, edges);

  return {
    sourceRef,
    scopeNote: scopeDescription(scope),
    truncatedEdges: scoped.truncatedEdges,
    truncatedNotice: scoped.notice,
    forward: { layers: fwd.layers, edges: fwd.edges },
    backward: { layers: bwd.layers, edges: bwd.edges },
    blastRadius: computeBlastRadius({
      sourceRef,
      edges,
      shippedQtyByFgLot,
      onHandQtyByLot,
      wipWorkOrders: wos.filter((w) => w.status && /进行|WIP|RUNNING/i.test(w.status)).map((w) => w.workOrderNo),
      customerByShipment,
    }),
  };
}

/* ---------------- 质量事件与处置 ---------------- */

export async function createIncident(
  session: SessionRef,
  input: { code: string; title: string; sourceRef: string; description?: string | null; severity?: string | null },
) {
  const blast = await queryTrace(session, input.sourceRef);
  const created = await prisma.$transaction(async (tx) => {
    const inc = await tx.qualityIncident.create({
      data: tenantData(session.tenantId, {
        code: input.code,
        title: input.title,
        sourceRef: input.sourceRef,
        description: input.description ?? null,
        severity: input.severity ?? null,
        // 影响面算出来即固化,便于事后复盘"当时判断的依据"
        impactSnapshot: blast.blastRadius as unknown as Prisma.InputJsonValue,
        reportedById: session.userId,
      }),
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "TRACE_INCIDENT_CREATE",
      entityType: "QualityIncident",
      entityId: inc.id,
      after: { code: input.code, sourceRef: input.sourceRef },
    });
    return inc;
  });
  return created;
}

/**
 * 提议处置动作。**只登记建议,不执行任何操作。**
 * 需要 trace.containment.propose 权限(在路由层校验)。
 */
export async function proposeContainment(
  session: SessionRef,
  incidentId: string,
  actions: { kind: ContainmentKind; targetRef: string; note?: string | null }[],
) {
  return prisma.$transaction(async (tx) => {
    const created: string[] = [];
    for (const a of actions) {
      const row = await tx.containmentAction.create({
        data: tenantData(session.tenantId, {
          incidentId,
          kind: a.kind,
          targetRef: a.targetRef,
          state: "PENDING_APPROVAL",
          proposedById: session.userId,
          note: a.note ?? null,
        }),
      });
      created.push(row.id);
    }
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "TRACE_CONTAINMENT_PROPOSE",
      entityType: "QualityIncident",
      entityId: incidentId,
      after: { count: actions.length, kinds: actions.map((a) => a.kind) },
    });
    return created;
  });
}

/**
 * 批准处置。
 *
 * **批准后只到「本系统已登记」**:冻结批次/暂停工单在本系统落标记,
 * 外部 ERP/MES 的执行状态另计 —— 未接通时停在 PENDING_EXTERNAL,
 * 绝不显示「ERP 已冻结」。
 */
export async function approveContainment(
  session: SessionRef,
  actionId: string,
  decision: "APPROVE" | "REJECT",
  reason?: string | null,
): Promise<{ ok: true; state: string } | { ok: false; reason: string }> {
  const action = await prisma.containmentAction.findFirst({
    where: tenantWhere(session.tenantId, { id: actionId }),
  });
  if (!action) return { ok: false, reason: "处置动作不存在或不属于当前租户" };
  if (action.state !== "PENDING_APPROVAL") {
    return { ok: false, reason: `当前状态为「${action.state}」,不可再审批` };
  }
  if (action.proposedById === session.userId) {
    return { ok: false, reason: "提议人不能批准自己提的动作 —— 提议与批准必须分离" };
  }
  if (decision === "REJECT" && !reason?.trim()) {
    return { ok: false, reason: "驳回必须填写原因" };
  }

  const nextState = decision === "REJECT" ? "REJECTED" : "REGISTERED_LOCALLY";

  await prisma.$transaction(async (tx) => {
    await tx.containmentAction.update({
      where: { id: actionId },
      data: {
        state: nextState,
        approvedById: session.userId,
        approvedAt: new Date(),
        rejectReason: decision === "REJECT" ? (reason ?? null) : null,
        // 需要外部系统执行的动作,标记为待外部执行(未接通即停在这里)
        externalNote:
          decision === "APPROVE" && (action.kind === "FREEZE_LOT" || action.kind === "PAUSE_WORK_ORDER")
            ? "ERP/WMS 回写待执行;MES 联动未接入"
            : null,
      },
    });

    if (decision === "APPROVE") {
      const parsedRef = parseRef(action.targetRef);
      if (action.kind === "FREEZE_LOT" && parsedRef?.kind === "LOT") {
        await tx.materialLot.updateMany({
          where: tenantWhere(session.tenantId, { lotNo: parsedRef.key }),
          data: { frozenAt: new Date(), frozenById: session.userId, frozenReason: action.note ?? null },
        });
      }
      if (action.kind === "PAUSE_WORK_ORDER" && parsedRef?.kind === "WO") {
        await tx.traceWorkOrder.updateMany({
          where: tenantWhere(session.tenantId, { workOrderNo: parsedRef.key }),
          data: { pausedAt: new Date(), pausedById: session.userId, pausedReason: action.note ?? null },
        });
      }
    }

    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: decision === "APPROVE" ? "TRACE_CONTAINMENT_APPROVE" : "TRACE_CONTAINMENT_REJECT",
      entityType: "ContainmentAction",
      entityId: actionId,
      before: { state: action.state },
      after: { state: nextState, reason: reason ?? null },
    });
  });

  return { ok: true, state: nextState };
}

export async function listIncidents(session: SessionRef) {
  const rows = await prisma.qualityIncident.findMany({
    where: tenantWhere(session.tenantId),
    include: { actions: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((i) => ({
    id: i.id,
    code: i.code,
    title: i.title,
    sourceRef: i.sourceRef,
    status: i.status,
    severity: i.severity,
    createdAt: i.createdAt.toISOString(),
    actions: i.actions.map((a) => ({
      id: a.id,
      kind: a.kind,
      targetRef: a.targetRef,
      state: a.state,
      note: a.note,
      externalNote: a.externalNote,
      rejectReason: a.rejectReason,
    })),
  }));
}

export async function listImportBatches(session: SessionRef) {
  const rows = await prisma.traceImportBatch.findMany({
    where: tenantWhere(session.tenantId),
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map((b) => ({
    id: b.id,
    template: b.template,
    fileName: b.fileName,
    totalRows: b.totalRows,
    okRows: b.okRows,
    errorRows: b.errorRows,
    revokedAt: b.revokedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
  }));
}
