/**
 * F3:免登录确认链路的取数与落库。
 *
 * 公开侧纪律:
 * - 一切读写以 tokenHash 定位,**不吃任何 id 参数**(URL 里只有 token);
 * - 提交用条件更新抢 PENDING→RESPONDED,抢不到 = 已被响应(重放);
 * - 落点复用既有表:PoAcknowledgement(source=LINK)/ OPOReply(replySource=LINK);
 * - F4 联动:ETA 响应后只把 IntegrationSyncRecord 置 PENDING(待回写),不触发同步。
 */
import type { Prisma } from "@prisma/client";
import {
  classifyAccess,
  hashActionToken,
  toAckDecision,
  tokenAuditRef,
  validateCallMaterial,
  validateOpoEta,
  validatePoConfirm,
  validateRfqQuote,
  type CallMaterialResponse,
  type OpoEtaResponse,
  type PoConfirmResponse,
  type RfqQuoteResponse,
} from "@/lib/domain/supplier-action";
import { buildIntegrationKey } from "@/lib/domain/integration-sync";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { resolveErpTarget } from "@/lib/server/repositories/integration-sync";
import type { SessionRef } from "@/lib/server/repositories/rfq";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";

// ============================================================
// 创建(内部,带会话)
// ============================================================

export async function createPoConfirmRequest(
  session: SessionRef,
  input: { poId: string; tokenHash: string; expiresAt: Date },
): Promise<{ ok: true; requestId: string } | { ok: false; reason: string }> {
  const po = await prisma.purchaseOrder.findFirst({
    where: tenantWhere(session.tenantId, { id: input.poId }),
    select: { id: true, poNo: true, status: true, supplierId: true },
  });
  if (!po) return { ok: false, reason: "订单不存在或不属于当前租户" };
  if (po.status !== "APPROVED" && po.status !== "EXPORTED") {
    return { ok: false, reason: "只有已批准的订单可发确认链接(与导出同一门槛)" };
  }

  const req = await prisma.supplierActionRequest.create({
    data: tenantData(session.tenantId, {
      kind: "PO_CONFIRM",
      supplierId: po.supplierId,
      relatedEntityType: "PurchaseOrder",
      relatedEntityId: po.id,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdById: session.userId,
    }),
  });
  await writeAudit(prisma, {
    tenantId: session.tenantId,
    userId: session.userId,
    action: "SUPPLIER_ACTION_CREATED",
    entityType: "SupplierActionRequest",
    entityId: req.id,
    after: { kind: "PO_CONFIRM", poNo: po.poNo, tokenRef: tokenAuditRef(input.tokenHash), expiresAt: input.expiresAt.toISOString() },
  });
  return { ok: true, requestId: req.id };
}

export async function createOpoEtaRequest(
  session: SessionRef,
  input: { supplierId: string; tokenHash: string; expiresAt: Date },
): Promise<{ ok: true; requestId: string; openLines: number } | { ok: false; reason: string }> {
  const supplier = await prisma.supplier.findFirst({
    where: tenantWhere(session.tenantId, { id: input.supplierId }),
    select: { id: true, name: true },
  });
  if (!supplier) return { ok: false, reason: "供应商不存在或不属于当前租户" };
  const openLines = await prisma.oPOLine.count({
    where: tenantWhere(session.tenantId, { supplierId: supplier.id, qtyOpen: { gt: 0 } }),
  });
  if (openLines === 0) return { ok: false, reason: "该供应商没有未交的 OPO 行,无需发确认链接" };

  const req = await prisma.supplierActionRequest.create({
    data: tenantData(session.tenantId, {
      kind: "OPO_ETA",
      supplierId: supplier.id,
      relatedEntityType: "Supplier",
      relatedEntityId: supplier.id,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdById: session.userId,
    }),
  });
  await writeAudit(prisma, {
    tenantId: session.tenantId,
    userId: session.userId,
    action: "SUPPLIER_ACTION_CREATED",
    entityType: "SupplierActionRequest",
    entityId: req.id,
    after: { kind: "OPO_ETA", supplier: supplier.name, openLines, tokenRef: tokenAuditRef(input.tokenHash) },
  });
  return { ok: true, requestId: req.id, openLines };
}

export async function createCallMaterialRequest(
  session: SessionRef,
  input: { callRecordId: string; tokenHash: string; expiresAt: Date },
): Promise<{ ok: true; requestId: string } | { ok: false; reason: string }> {
  const record = await prisma.callMaterialRecord.findFirst({
    where: tenantWhere(session.tenantId, { id: input.callRecordId }),
    include: { line: { select: { mpn: true } } },
  });
  if (!record) return { ok: false, reason: "Call 料记录不存在或不属于当前租户" };
  if (!record.supplierId) return { ok: false, reason: "该 Call 料记录未指定供应商 —— 先指定供应商再生成链接" };
  if (record.replyAt) return { ok: false, reason: "该 Call 料记录已有供应商回复 —— 如需更新请新建 Call 料记录" };

  const req = await prisma.supplierActionRequest.create({
    data: tenantData(session.tenantId, {
      kind: "CALL_MATERIAL",
      supplierId: record.supplierId,
      relatedEntityType: "CallMaterialRecord",
      relatedEntityId: record.id,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdById: session.userId,
    }),
  });
  await writeAudit(prisma, {
    tenantId: session.tenantId,
    userId: session.userId,
    action: "SUPPLIER_ACTION_CREATED",
    entityType: "SupplierActionRequest",
    entityId: req.id,
    after: { kind: "CALL_MATERIAL", mpn: record.line.mpn, tokenRef: tokenAuditRef(input.tokenHash), expiresAt: input.expiresAt.toISOString() },
  });
  return { ok: true, requestId: req.id };
}

export async function createRfqQuoteRequest(
  session: SessionRef,
  input: { procurementRfqId: string; supplierId: string; tokenHash: string; expiresAt: Date },
): Promise<{ ok: true; requestId: string; mpnCount: number } | { ok: false; reason: string }> {
  const [prfq, supplier] = await Promise.all([
    prisma.procurementRFQ.findFirst({
      where: tenantWhere(session.tenantId, { id: input.procurementRfqId }),
      select: { id: true, code: true, bomVersionIds: true },
    }),
    prisma.supplier.findFirst({
      where: tenantWhere(session.tenantId, { id: input.supplierId }),
      select: { id: true, name: true },
    }),
  ]);
  if (!prfq) return { ok: false, reason: "采购询价单不存在或不属于当前租户" };
  if (!supplier) return { ok: false, reason: "供应商不存在或不属于当前租户" };
  const mpnCount = (await rfqQuoteMpns(session.tenantId, prfq.bomVersionIds)).length;
  if (mpnCount === 0) return { ok: false, reason: "该询价单没有可报价的 MPN(BOM 行为空或未识别型号)" };

  const req = await prisma.supplierActionRequest.create({
    data: tenantData(session.tenantId, {
      kind: "RFQ_QUOTE",
      supplierId: supplier.id,
      relatedEntityType: "ProcurementRFQ",
      relatedEntityId: prfq.id,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      createdById: session.userId,
    }),
  });
  await writeAudit(prisma, {
    tenantId: session.tenantId,
    userId: session.userId,
    action: "SUPPLIER_ACTION_CREATED",
    entityType: "SupplierActionRequest",
    entityId: req.id,
    after: { kind: "RFQ_QUOTE", rfqCode: prfq.code, supplier: supplier.name, mpnCount, tokenRef: tokenAuditRef(input.tokenHash) },
  });
  return { ok: true, requestId: req.id, mpnCount };
}

/** 询价单可报价 MPN 面(去重;最小字段,无任何价格/目标价) */
async function rfqQuoteMpns(tenantId: string, bomVersionIds: unknown) {
  const versionIds = Array.isArray(bomVersionIds) ? (bomVersionIds as string[]) : [];
  if (versionIds.length === 0) return [];
  const lines = await prisma.bOMLine.findMany({
    where: tenantWhere(tenantId, { bomVersionId: { in: versionIds }, mpn: { not: null } }),
    select: { mpn: true, manufacturer: true, qty: true },
    orderBy: { lineNo: "asc" },
    take: 500,
  });
  const byMpn = new Map<string, { mpn: string; manufacturer: string | null; demandQty: string }>();
  for (const l of lines) {
    if (!l.mpn) continue;
    const key = l.mpn.toUpperCase();
    if (!byMpn.has(key)) {
      byMpn.set(key, { mpn: l.mpn, manufacturer: l.manufacturer, demandQty: l.qty.toString() });
    }
  }
  return [...byMpn.values()];
}

// ============================================================
// 公开读(按 token;最小字段)
// ============================================================

export type PublicView =
  | { access: "not_found" | "expired" | "already_responded"; kind?: string }
  | {
      access: "ok";
      kind: "PO_CONFIRM";
      requestId: string;
      poNo: string;
      supplierName: string;
      expiresAt: string;
      lines: { lineNo: number; mpn: string | null; qty: string; requestDate: string | null }[];
    }
  | {
      access: "ok";
      kind: "OPO_ETA";
      requestId: string;
      supplierName: string;
      expiresAt: string;
      lines: {
        opoLineId: string;
        poNo: string;
        lineNo: number;
        mpn: string | null;
        qtyOpen: string;
        promiseDate: string | null;
      }[];
    }
  | {
      access: "ok";
      kind: "CALL_MATERIAL";
      requestId: string;
      supplierName: string;
      expiresAt: string;
      /// 最小字段:无价格、无库存快照、无内部备注
      mpn: string | null;
      manufacturer: string | null;
      callQty: string;
    }
  | {
      access: "ok";
      kind: "RFQ_QUOTE";
      requestId: string;
      supplierName: string;
      expiresAt: string;
      rfqCode: string;
      /// 最小字段:无目标价、无现价、无其他供应商信息
      mpns: { mpn: string; manufacturer: string | null; demandQty: string }[];
    };

export async function loadPublicView(rawToken: string): Promise<PublicView> {
  const req = await prisma.supplierActionRequest.findUnique({
    where: { tokenHash: hashActionToken(rawToken) },
  });
  const access = classifyAccess(req ? { status: req.status, expiresAt: req.expiresAt } : null);
  if (access !== "ok") return { access, kind: req?.kind };

  const supplier = await prisma.supplier.findFirst({
    where: tenantWhere(req!.tenantId, { id: req!.supplierId }),
    select: { name: true },
  });

  if (req!.kind === "PO_CONFIRM") {
    const po = await prisma.purchaseOrder.findFirst({
      where: tenantWhere(req!.tenantId, { id: req!.relatedEntityId }),
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });
    if (!po) return { access: "not_found" };
    return {
      access: "ok",
      kind: "PO_CONFIRM",
      requestId: req!.id,
      poNo: po.poNo,
      supplierName: supplier?.name ?? "供应商",
      expiresAt: req!.expiresAt.toISOString(),
      // 最小字段:不含单价/金额/内部备注(设计 §5)
      lines: po.lines.map((l) => ({
        lineNo: l.lineNo,
        mpn: l.mpn,
        qty: l.qty.toString(),
        requestDate: l.requestDate ? l.requestDate.toISOString().slice(0, 10) : null,
      })),
    };
  }

  if (req!.kind === "CALL_MATERIAL") {
    const record = await prisma.callMaterialRecord.findFirst({
      where: tenantWhere(req!.tenantId, { id: req!.relatedEntityId }),
      include: { line: { select: { mpn: true, manufacturer: true } } },
    });
    if (!record) return { access: "not_found" };
    return {
      access: "ok",
      kind: "CALL_MATERIAL",
      requestId: req!.id,
      supplierName: supplier?.name ?? "供应商",
      expiresAt: req!.expiresAt.toISOString(),
      mpn: record.line.mpn,
      manufacturer: record.line.manufacturer,
      callQty: record.callQty.toString(),
    };
  }

  if (req!.kind === "RFQ_QUOTE") {
    const prfq = await prisma.procurementRFQ.findFirst({
      where: tenantWhere(req!.tenantId, { id: req!.relatedEntityId }),
      select: { code: true, bomVersionIds: true },
    });
    if (!prfq) return { access: "not_found" };
    return {
      access: "ok",
      kind: "RFQ_QUOTE",
      requestId: req!.id,
      supplierName: supplier?.name ?? "供应商",
      expiresAt: req!.expiresAt.toISOString(),
      rfqCode: prfq.code,
      mpns: await rfqQuoteMpns(req!.tenantId, prfq.bomVersionIds),
    };
  }

  // OPO_ETA:该供应商当前未交行
  const lines = await prisma.oPOLine.findMany({
    where: tenantWhere(req!.tenantId, { supplierId: req!.supplierId, qtyOpen: { gt: 0 } }),
    orderBy: [{ poNo: "asc" }, { lineNo: "asc" }],
    take: 500,
  });
  return {
    access: "ok",
    kind: "OPO_ETA",
    requestId: req!.id,
    supplierName: supplier?.name ?? "供应商",
    expiresAt: req!.expiresAt.toISOString(),
    lines: lines.map((l) => ({
      opoLineId: l.id,
      poNo: l.poNo,
      lineNo: l.lineNo,
      mpn: l.mpn,
      qtyOpen: l.qtyOpen.toString(),
      promiseDate: l.promiseDate ? l.promiseDate.toISOString().slice(0, 10) : null,
    })),
  };
}

// ============================================================
// 公开写(按 token;条件更新防重放)
// ============================================================

/** 抢占:PENDING→RESPONDED。返回抢到的请求或 null(重放/不存在) */
async function claimRequest(
  rawToken: string,
  kind: "PO_CONFIRM" | "OPO_ETA" | "CALL_MATERIAL" | "RFQ_QUOTE",
) {
  const hash = hashActionToken(rawToken);
  const req = await prisma.supplierActionRequest.findUnique({ where: { tokenHash: hash } });
  const access = classifyAccess(req ? { status: req.status, expiresAt: req.expiresAt } : null);
  if (access !== "ok" || req!.kind !== kind) return { access: access === "ok" ? ("not_found" as const) : access, req: null };

  const claimed = await prisma.supplierActionRequest.updateMany({
    where: { id: req!.id, status: "PENDING" },
    data: { status: "RESPONDED", respondedAt: new Date() },
  });
  if (claimed.count === 0) return { access: "already_responded" as const, req: null };
  return { access: "ok" as const, req: req! };
}

export async function respondPoConfirm(
  rawToken: string,
  input: PoConfirmResponse,
  meta: { ip: string | null; ua: string | null },
): Promise<{ ok: true } | { ok: false; code: string; reason: string }> {
  const invalid = validatePoConfirm(input);
  if (invalid) return { ok: false, code: "invalid", reason: invalid };

  const { access, req } = await claimRequest(rawToken, "PO_CONFIRM");
  if (access !== "ok" || !req) return { ok: false, code: access, reason: accessReason(access) };

  const po = await prisma.purchaseOrder.findFirst({
    where: tenantWhere(req.tenantId, { id: req.relatedEntityId }),
    select: { id: true, poNo: true, supplierId: true },
  });
  if (!po) return { ok: false, code: "not_found", reason: accessReason("not_found") };

  await prisma.$transaction(async (tx) => {
    await tx.supplierActionRequest.update({
      where: { id: req.id },
      data: {
        respondedByName: input.respondedByName,
        respondedByEmail: input.respondedByEmail,
        responsePayload: input as unknown as Prisma.InputJsonValue,
        responseIp: meta.ip,
        responseUa: meta.ua?.slice(0, 300) ?? null,
      },
    });
    // 落既有 PoAcknowledgement(唯一键 tenantId+poNo+supplierId → upsert)
    await tx.poAcknowledgement.upsert({
      where: {
        tenantId_poNo_supplierId: { tenantId: req.tenantId, poNo: po.poNo, supplierId: po.supplierId },
      },
      update: {
        decision: toAckDecision(input.decision),
        note: input.supplierNote,
        source: "LINK",
        recordedById: req.createdById,
        recordedAt: new Date(),
      },
      create: tenantData(req.tenantId, {
        poNo: po.poNo,
        supplierId: po.supplierId,
        decision: toAckDecision(input.decision),
        note: input.supplierNote,
        source: "LINK",
        recordedById: req.createdById,
      }),
    });
    await writeAudit(tx, {
      tenantId: req.tenantId,
      userId: req.createdById, // 关联内部责任人 = 链接创建人;实际操作者见 actor*(R3-1)
      actorType: "SUPPLIER_LINK",
      actorId: req.id,
      actorDisplay: input.respondedByName,
      action: "SUPPLIER_ACTION_RESPONDED",
      entityType: "SupplierActionRequest",
      entityId: req.id,
      after: {
        respondedVia: "SUPPLIER_LINK",
        kind: "PO_CONFIRM",
        decision: input.decision,
        respondedByName: input.respondedByName,
        respondedByEmail: input.respondedByEmail,
        ip: meta.ip,
        ua: meta.ua?.slice(0, 120) ?? null,
        changedLines: input.lines.filter((l) => l.confirmedQty ?? l.confirmedEta).length,
      },
    });
  });
  return { ok: true };
}

export async function respondOpoEta(
  rawToken: string,
  input: OpoEtaResponse,
  meta: { ip: string | null; ua: string | null },
): Promise<{ ok: true; savedLines: number } | { ok: false; code: string; reason: string }> {
  const invalid = validateOpoEta(input);
  if (invalid) return { ok: false, code: "invalid", reason: invalid };

  const { access, req } = await claimRequest(rawToken, "OPO_ETA");
  if (access !== "ok" || !req) return { ok: false, code: access, reason: accessReason(access) };

  // 只接受**该供应商自己的**行 —— 别人的行 id 混进来一律丢弃并如实计数
  const lines = await prisma.oPOLine.findMany({
    where: tenantWhere(req.tenantId, {
      id: { in: input.lines.map((l) => l.opoLineId) },
      supplierId: req.supplierId,
    }),
    select: { id: true },
  });
  const validIds = new Set(lines.map((l) => l.id));
  const accepted = input.lines.filter(
    (l) => validIds.has(l.opoLineId) && (l.replyEta || l.replyQty || l.replyNote),
  );

  const erpTarget = await resolveErpTarget(req.tenantId);
  const providerName = erpTarget.kind === "NONE" ? "NONE" : erpTarget.kind;

  await prisma.$transaction(async (tx) => {
    await tx.supplierActionRequest.update({
      where: { id: req.id },
      data: {
        respondedByName: input.respondedByName,
        respondedByEmail: input.respondedByEmail,
        responsePayload: input as unknown as Prisma.InputJsonValue,
        responseIp: meta.ip,
        responseUa: meta.ua?.slice(0, 300) ?? null,
      },
    });
    for (const l of accepted) {
      await tx.oPOReply.create({
        data: tenantData(req.tenantId, {
          opoLineId: l.opoLineId,
          replyEta: l.replyEta ? new Date(l.replyEta) : null,
          replyQty: l.replyQty,
          replyNote: l.replyNote,
          replyAt: new Date(),
          replySource: "LINK",
        }),
      });
      // F4 联动:仅标记「待回写 ERP」,不自动触发同步(设计 §6)
      await tx.integrationSyncRecord.upsert({
        where: {
          tenantId_provider_entityType_entityId_direction: {
            tenantId: req.tenantId,
            provider: providerName,
            entityType: "ETA_WRITEBACK",
            entityId: l.opoLineId,
            direction: "EZPLM_TO_ERP",
          },
        },
        update: {
          state: providerName === "NONE" ? "NOT_CONFIGURED" : "PENDING",
          note: "供应商经确认链接更新交期 —— 待人工/调度回写 ERP,不自动触发",
        },
        create: tenantData(req.tenantId, {
          provider: providerName,
          entityType: "ETA_WRITEBACK",
          entityId: l.opoLineId,
          direction: "EZPLM_TO_ERP",
          state: providerName === "NONE" ? "NOT_CONFIGURED" : "PENDING",
          idempotencyKey: buildIntegrationKey({
            tenantId: req.tenantId,
            entityType: "ETA_WRITEBACK",
            entityId: l.opoLineId,
          }),
          note: "供应商经确认链接更新交期 —— 待人工/调度回写 ERP,不自动触发",
        }),
      });
    }
    await writeAudit(tx, {
      tenantId: req.tenantId,
      userId: req.createdById, // 同上:实际操作者见 actor*
      actorType: "SUPPLIER_LINK",
      actorId: req.id,
      actorDisplay: input.respondedByName,
      action: "SUPPLIER_ACTION_RESPONDED",
      entityType: "SupplierActionRequest",
      entityId: req.id,
      after: {
        respondedVia: "SUPPLIER_LINK",
        kind: "OPO_ETA",
        respondedByName: input.respondedByName,
        respondedByEmail: input.respondedByEmail,
        ip: meta.ip,
        ua: meta.ua?.slice(0, 120) ?? null,
        savedLines: accepted.length,
        droppedLines: input.lines.length - accepted.length,
      },
    });
  });
  return { ok: true, savedLines: accepted.length };
}

export async function respondCallMaterial(
  rawToken: string,
  input: CallMaterialResponse,
  meta: { ip: string | null; ua: string | null },
): Promise<{ ok: true } | { ok: false; code: string; reason: string }> {
  const invalid = validateCallMaterial(input);
  if (invalid) return { ok: false, code: "invalid", reason: invalid };

  const { access, req } = await claimRequest(rawToken, "CALL_MATERIAL");
  if (access !== "ok" || !req) return { ok: false, code: access, reason: accessReason(access) };

  const record = await prisma.callMaterialRecord.findFirst({
    where: tenantWhere(req.tenantId, { id: req.relatedEntityId }),
    select: { id: true, replyAt: true },
  });
  if (!record) return { ok: false, code: "not_found", reason: accessReason("not_found") };

  await prisma.$transaction(async (tx) => {
    await tx.supplierActionRequest.update({
      where: { id: req.id },
      data: {
        respondedByName: input.respondedByName,
        respondedByEmail: input.respondedByEmail,
        responsePayload: input as unknown as Prisma.InputJsonValue,
        responseIp: meta.ip,
        responseUa: meta.ua?.slice(0, 300) ?? null,
      },
    });
    // 回填既有 CallMaterialRecord(不建平行模型);邮件状态与回复状态互不推导
    await tx.callMaterialRecord.update({
      where: { id: record.id },
      data: {
        replyCanSupply: input.canSupply,
        replyQty: input.canSupply ? input.replyQty : null,
        replyEta: input.canSupply && input.replyEta ? new Date(input.replyEta) : null,
        replyNote: input.replyNote,
        replyAt: new Date(),
        replySource: "LINK",
      },
    });
    await writeAudit(tx, {
      tenantId: req.tenantId,
      userId: req.createdById, // 关联内部责任人 = 链接创建人;实际操作者见 actor*
      actorType: "SUPPLIER_LINK",
      actorId: req.id,
      actorDisplay: input.respondedByName,
      action: "SUPPLIER_ACTION_RESPONDED",
      entityType: "SupplierActionRequest",
      entityId: req.id,
      after: {
        respondedVia: "SUPPLIER_LINK",
        kind: "CALL_MATERIAL",
        canSupply: input.canSupply,
        respondedByName: input.respondedByName,
        respondedByEmail: input.respondedByEmail,
        ip: meta.ip,
        ua: meta.ua?.slice(0, 120) ?? null,
      },
    });
  });
  return { ok: true };
}

export async function respondRfqQuote(
  rawToken: string,
  input: RfqQuoteResponse,
  meta: { ip: string | null; ua: string | null },
): Promise<
  { ok: true; savedLines: number; droppedLines: number } | { ok: false; code: string; reason: string }
> {
  const invalid = validateRfqQuote(input);
  if (invalid) return { ok: false, code: "invalid", reason: invalid };

  const { access, req } = await claimRequest(rawToken, "RFQ_QUOTE");
  if (access !== "ok" || !req) return { ok: false, code: access, reason: accessReason(access) };

  const prfq = await prisma.procurementRFQ.findFirst({
    where: tenantWhere(req.tenantId, { id: req.relatedEntityId }),
    select: { id: true, code: true, bomVersionIds: true },
  });
  if (!prfq) return { ok: false, code: "not_found", reason: accessReason("not_found") };

  // 只接受**该询价单里的** MPN —— 混进来的一律丢弃并如实计数(与 OPO 行同纪律)
  const allowed = new Set(
    (await rfqQuoteMpns(req.tenantId, prfq.bomVersionIds)).map((m) => m.mpn.toUpperCase()),
  );
  const accepted = input.lines.filter((l) => allowed.has(l.mpn.toUpperCase()));

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.supplierActionRequest.update({
      where: { id: req.id },
      data: {
        respondedByName: input.respondedByName,
        respondedByEmail: input.respondedByEmail,
        responsePayload: input as unknown as Prisma.InputJsonValue,
        responseIp: meta.ip,
        responseUa: meta.ua?.slice(0, 300) ?? null,
      },
    });
    // 落既有 SupplierOffer + PriceBreak(provider=OFFLINE 线下报价池)。
    // 这是**原始报价数据**,不做任何自动选择 —— 正式比价/选择仍走采购人工流程
    // (CLAUDE.md 约束 3;阶梯价按 MOQ 起步单价一档,多档报价走线下 Excel 导入)。
    for (const l of accepted) {
      const offer = await tx.supplierOffer.create({
        data: tenantData(req.tenantId, {
          provider: "OFFLINE",
          supplierId: req.supplierId,
          mpn: l.mpn,
          currency: input.currency,
          moq: l.moq,
          spq: l.spq,
          leadTimeDays: l.leadTimeDays,
          validUntil: l.validUntil ? new Date(l.validUntil) : null,
          supplierNote: l.note,
          sourceUpdatedAt: now,
        }),
      });
      await tx.priceBreak.create({
        data: tenantData(req.tenantId, {
          supplierOfferId: offer.id,
          minQty: l.moq ?? "1",
          unitPrice: l.unitPrice,
        }),
      });
    }
    await writeAudit(tx, {
      tenantId: req.tenantId,
      userId: req.createdById, // 同上:实际操作者见 actor*
      actorType: "SUPPLIER_LINK",
      actorId: req.id,
      actorDisplay: input.respondedByName,
      action: "SUPPLIER_ACTION_RESPONDED",
      entityType: "SupplierActionRequest",
      entityId: req.id,
      after: {
        respondedVia: "SUPPLIER_LINK",
        kind: "RFQ_QUOTE",
        rfqCode: prfq.code,
        currency: input.currency,
        respondedByName: input.respondedByName,
        respondedByEmail: input.respondedByEmail,
        ip: meta.ip,
        ua: meta.ua?.slice(0, 120) ?? null,
        savedLines: accepted.length,
        droppedLines: input.lines.length - accepted.length,
      },
    });
  });
  return { ok: true, savedLines: accepted.length, droppedLines: input.lines.length - accepted.length };
}

function accessReason(access: "not_found" | "expired" | "already_responded"): string {
  switch (access) {
    case "not_found":
      return "链接无效";
    case "expired":
      return "链接已过期,请联系采购重新发送";
    case "already_responded":
      return "该链接已确认过";
  }
}

/** PO 详情页显示「Supplier Confirmed via Link」的依据 */
export async function linkConfirmStateForPo(tenantId: string, poNo: string, supplierId: string) {
  const ack = await prisma.poAcknowledgement.findFirst({
    where: tenantWhere(tenantId, { poNo, supplierId, source: "LINK" }),
  });
  const pending = await prisma.supplierActionRequest.findFirst({
    where: tenantWhere(tenantId, {
      kind: "PO_CONFIRM" as const,
      supplierId,
      status: "PENDING" as const,
      expiresAt: { gt: new Date() },
    }),
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, expiresAt: true },
  });
  return { ack, pendingLink: pending };
}
