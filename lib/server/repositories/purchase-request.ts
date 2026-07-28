/**
 * PM 端采购申请单(Backlog B1;整合方案 3.2)。
 * GTB 计算全过程落 gtbSnapshot,供审计与复核;同 MPN 呆滞库存一并提示。
 */
import type { Prisma } from "@prisma/client";
import { calculateGtb, type GtbResult } from "@/lib/domain/gtb";
import { writeAudit } from "@/lib/server/audit";
import { prisma } from "@/lib/server/db";
import { tenantData, tenantWhere } from "@/lib/server/tenant-scope";
import type { SessionRef } from "./rfq";

async function nextCode(tenantId: string, now: Date): Promise<string> {
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const prefix = `PR-${stamp}-`;
  const last = await prisma.purchaseRequest.findFirst({
    where: tenantWhere(tenantId, { code: { startsWith: prefix } }),
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const seq = last ? Number(last.code.slice(prefix.length)) : 0;
  return `${prefix}${String((Number.isFinite(seq) ? seq : 0) + 1).padStart(3, "0")}`;
}

export interface CreatePurchaseRequestInput {
  mpn: string;
  demandQty: number;
  scrapRate?: string | null;
  moq?: number | null;
  spq?: number | null;
  note?: string | null;
}

export interface PurchaseRequestPreview {
  gtb: GtbResult;
  /** 同 MPN 呆滞数量提示(整合方案 3.2) */
  slowMovingQty: number | null;
  stockQty: number;
  inTransitQty: number;
}

/** 取库存与在途:ezPLM 为真源,本地是只读缓存 */
export async function previewGtb(
  tenantId: string,
  input: CreatePurchaseRequestInput,
): Promise<PurchaseRequestPreview> {
  const part = await prisma.part.findFirst({
    where: tenantWhere(tenantId, { mpn: input.mpn }),
    select: { id: true },
  });

  const [inv, openPo] = await Promise.all([
    part
      ? prisma.inventorySnapshot.findFirst({
          where: tenantWhere(tenantId, { partId: part.id }),
          orderBy: { fetchedAt: "desc" },
        })
      : null,
    part
      ? prisma.openPOLine.findMany({ where: tenantWhere(tenantId, { partId: part.id }) })
      : [],
  ]);

  const stockQty = inv ? Number(inv.qtyOnHand) : 0;
  const inTransitQty = openPo.reduce((sum, l) => sum + Number(l.qtyOpen), 0);

  return {
    gtb: calculateGtb({
      demandQty: input.demandQty,
      scrapRate: input.scrapRate,
      stockQty,
      inTransitQty,
      moq: input.moq,
      spq: input.spq,
    }),
    slowMovingQty: inv?.qtySlowMoving === null || inv?.qtySlowMoving === undefined ? null : Number(inv.qtySlowMoving),
    stockQty,
    inTransitQty,
  };
}

export async function createPurchaseRequest(
  session: SessionRef,
  input: CreatePurchaseRequestInput,
) {
  const preview = await previewGtb(session.tenantId, input);
  const code = await nextCode(session.tenantId, new Date());

  return prisma.$transaction(async (tx) => {
    const pr = await tx.purchaseRequest.create({
      data: tenantData(session.tenantId, {
        code,
        requestedById: session.userId,
        mpn: input.mpn,
        qty: preview.gtb.purchaseQty,
        gtbSnapshot: {
          input,
          stockQty: preview.stockQty,
          inTransitQty: preview.inTransitQty,
          slowMovingQty: preview.slowMovingQty,
          result: preview.gtb,
        } as unknown as Prisma.InputJsonValue,
        status: "SUBMITTED",
        note: input.note ?? null,
      }),
    });
    await writeAudit(tx, {
      tenantId: session.tenantId,
      userId: session.userId,
      action: "PURCHASE_REQUEST_CREATE",
      entityType: "PurchaseRequest",
      entityId: pr.id,
      after: { code, mpn: input.mpn, qty: preview.gtb.purchaseQty, gtb: preview.gtb },
    });
    return pr;
  });
}

export async function listPurchaseRequests(session: SessionRef) {
  return prisma.purchaseRequest.findMany({
    where: tenantWhere(session.tenantId),
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
